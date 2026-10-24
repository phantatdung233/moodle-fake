/**
 * Page seam: `/admin/results` as a browser receives it. The page is an async
 * server component, so awaiting it runs the real query; only the cookie is
 * faked, and the reset button is a client component left for the browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import {
  answerQuestion,
  resumeOrStartAttempt,
  submitAttempt,
} from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";
import { RESULTS_PAGE_SIZE } from "@/lib/admin/results-repository";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: ResultsPage } = await import("@/app/admin/results/page");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedPublishedQuiz(slug: string, title: string): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title,
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 3),
  });
  if (!created.ok) throw new Error(created.error);
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

async function takeAttempt(quizId: string, studentId: string, studentName: string): Promise<void> {
  const started = await resumeOrStartAttempt({ quizId, studentId, studentName });
  if (!started.ok) throw new Error(started.error);
  await answerQuestion({
    attemptId: started.attempt.id,
    studentId,
    questionId: "Q001",
    selectedOptionKeys: ["e"],
    blankValues: [],
  });
  await submitAttempt({ attemptId: started.attempt.id, studentId });
}

/** Client components under test are left for the browser, as in other page tests. */
async function resolveTree(node: unknown): Promise<unknown> {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map((entry) => resolveTree(entry)));
  const element = node as { type: unknown; props: Record<string, unknown> };
  const props = element.props ?? {};
  const children = "children" in props ? await resolveTree(props.children) : props.children;
  const rebuilt = { ...element, props: { ...props, children } } as Record<string, unknown>;
  Object.setPrototypeOf(rebuilt, Object.getPrototypeOf(element));
  if (typeof element.type === "function") {
    const name = element.type.name ?? "";
    if (name.startsWith("ResetAttemptsButton")) return { ...rebuilt, type: `client:${name}` };
    return resolveTree(await (element.type as (props: unknown) => unknown)(rebuilt.props));
  }
  return rebuilt;
}

async function html(searchParams: Record<string, string> = {}): Promise<string> {
  const page = await ResultsPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup((await resolveTree(page)) as ReactElement);
}

describe("/admin/results", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_page_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz("python-co-ban", "Python cơ bản");
  });

  it("hiện bảng kết quả với MSSV, tên, đề, lượt, % điểm, thời gian và trạng thái", async () => {
    await takeAttempt(quizId, "B2012345", "Nguyễn Văn An");

    const markup = await html();

    expect(markup).toContain("B2012345");
    expect(markup).toContain("Nguyễn Văn An");
    expect(markup).toContain("Python cơ bản");
    expect(markup).toContain("33,3%");
    expect(markup).toContain("Đã nộp");
    // The attempt-detail link is how the giảng viên opens one lượt.
    expect(markup).toMatch(/href="\/admin\/results\/[a-f0-9]{24}"/);
  });

  it("lọc theo MSSV qua query string và hiện nút xoá lọc", async () => {
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(quizId, "B9999999", "Bình");

    const markup = await html({ studentId: "2012345" });

    expect(markup).toContain("B2012345");
    expect(markup).not.toContain("B9999999");
    expect(markup).toContain("Xoá lọc");
    expect(markup).toContain('value="2012345"');
  });

  it("hiện trạng thái rỗng khi chưa ai làm bài", async () => {
    const markup = await html();

    expect(markup).toContain("Chưa có lượt làm nào");
  });

  it("giữ bộ lọc đang bật trong link export CSV", async () => {
    const markup = await html({ quizId, studentId: "B2012345" });

    expect(markup).toContain(
      `href="/admin/results/export.csv?quizId=${quizId}&amp;studentId=B2012345"`,
    );
  });

  it("hiện 'Trang sau' mang theo bộ lọc, và 'Trang đầu' khi đang ở trang sau", async () => {
    // One more Attempt than a page holds, so the first page has a successor.
    for (let index = 0; index <= RESULTS_PAGE_SIZE; index += 1) {
      await takeAttempt(quizId, `B${index}`, `Sinh viên ${index}`);
    }

    const first = await html();
    expect(first).toContain("Trang sau");
    expect(first).not.toContain("Trang đầu");

    const cursor = /href="\/admin\/results\?cursor=([^"]+)"/.exec(first)?.[1];
    expect(cursor).toBeDefined();

    const second = await html({ cursor: decodeURIComponent(cursor ?? "") });
    expect(second).toContain("Trang đầu");
    expect(second).toContain("Hết danh sách");
    // An unreadable cursor shows the first page instead of an error.
    expect(await html({ cursor: "rác" })).toContain("Trang sau");
  });
});
