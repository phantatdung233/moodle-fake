/**
 * Page seam: `/admin/quizzes/[id]/review` as the giảng viên receives it. The
 * Question text, the answer form, and story 21's explanation block: the cached
 * text arrives pre-rendered, the button is the only thing that wakes Gemini.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { getQuizForReview } from "@/lib/quiz/review-repository";
import { saveExplanation } from "@/lib/gemini/cache";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: ReviewPage } = await import("./page");

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
    // Client components render only in the browser (hooks): keep them as
    // markers so the test asserts on the props the server hands them.
    if (name.startsWith("ReviewQuestion") || name.startsWith("AdminExplanation")) {
      return { ...rebuilt, type: `client:${name}` };
    }
    return resolveTree(await (element.type as (props: unknown) => unknown)(rebuilt.props));
  }
  return rebuilt;
}

function findClient(node: unknown, name: string): Record<string, unknown> | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findClient(entry, name);
      if (found) return found;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === `client:${name}`) return element.props ?? {};
  return findClient(element.props?.children, name);
}

async function tree(quizId: string, questionId?: string): Promise<unknown> {
  const page = await ReviewPage({
    params: Promise.resolve({ id: quizId }),
    searchParams: Promise.resolve(questionId ? { q: questionId } : {}),
  });
  return resolveTree(page);
}

describe("/admin/quizzes/[id]/review", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_review_page_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    const created = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      // The whole file: real Questions that still need an answer (Q046 first).
      questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions,
    });
    if (!created.ok) throw new Error(created.error);
    quizId = created.quizId;
  });

  /** The Question the page shows first, and its hash for seeding the cache. */
  async function firstQuestion(): Promise<{ id: string; hash: string }> {
    const quiz = await getQuizForReview(quizId);
    const id = quiz!.reviewQueue[0];
    const { getQuestionForReview } = await import("@/lib/quiz/review-repository");
    const question = await getQuestionForReview(quizId, id);
    if (!question) throw new Error("thiếu câu cần duyệt");
    return { id, hash: question.hash };
  }

  it("câu chưa có giải thích: nút 'Giải thích bằng AI', không tự gọi model", async () => {
    const review = findClient(await tree(quizId), "ReviewQuestion");

    expect(review?.cachedExplanation).toBeNull();
  });

  it("đã có giải thích trong cache: hiện ngay văn bản và dấu 'đã có sẵn'", async () => {
    const { id, hash } = await firstQuestion();
    await saveExplanation({
      questionHash: hash,
      questionId: id,
      text: "Đáp án ghi nhận là sort(); các lựa chọn khác không phải hàm của Numpy.",
    });

    const review = findClient(await tree(quizId), "ReviewQuestion");

    expect(review?.question).toMatchObject({ id });
    expect(review?.cachedExplanation).toBe(
      "Đáp án ghi nhận là sort(); các lựa chọn khác không phải hàm của Numpy.",
    );
  });

  it("giải thích của câu khác không bị hiện nhầm", async () => {
    const { id, hash } = await firstQuestion();
    await saveExplanation({ questionHash: hash, questionId: id, text: "Giải thích của câu đầu." });

    const quiz = await getQuizForReview(quizId);
    const other = quiz!.reviewQueue.find((candidate) => candidate !== id);
    if (!other) throw new Error("cần ít nhất hai câu cần duyệt");
    const review = findClient(await tree(quizId, other), "ReviewQuestion");

    expect(review?.question).toMatchObject({ id: other });
    expect(review?.cachedExplanation).toBeNull();
  });

  it("ReviewQuestion nhận quizId của đề đang duyệt, để nút gọi đúng đề", async () => {
    const review = findClient(await tree(quizId), "ReviewQuestion");

    expect(review?.done).toMatchObject({ quizId });
  });
});
