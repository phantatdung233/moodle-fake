/**
 * Page seam: `/admin/results/[attemptId]` as the giảng viên receives it — the
 * snapshot Question text, the sinh viên's picks, the correct answer and the
 * score. Explanations are not stored: the page never shows one from before.
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

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: AttemptDetailPage } = await import("@/app/admin/results/[attemptId]/page");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

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
    // Client components render only in the browser (hooks).
    if (name.startsWith("ExplanationPanel")) return { ...rebuilt, type: `client:${name}` };
    return resolveTree(await (element.type as (props: unknown) => unknown)(rebuilt.props));
  }
  return rebuilt;
}

async function html(attemptId: string): Promise<string> {
  const page = await AttemptDetailPage({ params: Promise.resolve({ attemptId }) });
  return renderToStaticMarkup((await resolveTree(page)) as ReactElement);
}

describe("/admin/results/[attemptId]", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_attempt_detail_page_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    const created = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 3),
    });
    if (!created.ok) throw new Error(created.error);
    const published = await publishQuiz(created.quizId);
    if (!published.ok) throw new Error(published.error);
    quizId = created.quizId;
  });

  it("hiện từng câu: câu trả lời của sinh viên, đáp án đúng và điểm", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["e"],
      blankValues: [],
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });

    const markup = await html(started.attempt.id);

    expect(markup).toContain("B2012345");
    expect(markup).toContain("Python cơ bản");
    expect(markup).toContain("Câu 1");
    expect(markup).toContain("Câu 3");
    expect(markup).toContain("đáp án đúng");
    expect(markup).toContain("bạn chọn");
    expect(markup).toContain("Điểm: 33,3%");
    expect(markup).toContain("1 điểm");
  });

  it("không hiện giải thích nào đã lưu: chi tiết lượt làm chỉ có phần chấm", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });

    const markup = await html(started.attempt.id);

    expect(markup).toContain("Giải thích");
    expect(markup).toContain("Chưa có giải thích");
  });

  it("báo chưa có bài khi id không tồn tại", async () => {
    await expect(html("6a1b2c3d4e5f60718293a4b5")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
