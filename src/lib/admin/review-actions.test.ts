import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "@/lib/quiz/quiz.model";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { parseQuizJson } from "@/lib/quiz/parser";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** The admin session cookie the current request carries; set per test. */
const sessionCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ADMIN_SESSION_COOKIE && sessionCookie.value
        ? { name, value: sessionCookie.value }
        : undefined,
  }),
}));

/** `revalidatePath` needs Next's request store; tests only care that it runs. */
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const { reviewAnswer, reviewRemoveQuestion } = await import("@/lib/admin/review-actions");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedDraftQuiz(): Promise<string> {
  const { questions } = parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8")));
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: "python-co-ban",
    questions,
  });
  if (!created.ok) throw new Error(created.error);
  return created.quizId;
}

async function signIn(): Promise<void> {
  const { createAdminSessionCookie } = await import("@/lib/admin/session");
  sessionCookie.value = (await createAdminSessionCookie()).value;
}

async function storedQuestion(quizId: string, questionId: string) {
  const quiz = await Quiz.findById(quizId).lean();
  return quiz?.questions.find((question) => question.id === questionId);
}

describe("review server actions", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_review_actions_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
    sessionCookie.value = undefined;
    revalidatePath.mockClear();
  });

  it("không có phiên admin: từ chối lưu đáp án và xoá câu", async () => {
    const quizId = await seedDraftQuiz();

    const saved = await reviewAnswer(quizId, "Q046", { selectedOptionKeys: ["a"] });
    const removed = await reviewRemoveQuestion(quizId, "Q046");

    const expired = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.";
    expect(saved).toEqual({ ok: false, error: expired });
    expect(removed).toEqual({ ok: false, error: expired });
    expect((await storedQuestion(quizId, "Q046"))?.status).toBe("needs_review");
    expect((await storedQuestion(quizId, "Q046"))?.enabled).toBe(true);
  });

  it("có phiên admin: lưu đáp án, trả câu kế tiếp và revalidate trang duyệt + trang chi tiết", async () => {
    await signIn();
    const quizId = await seedDraftQuiz();

    const result = await reviewAnswer(quizId, "Q046", { selectedOptionKeys: ["b"] });

    expect(result.ok).toBe(true);
    expect((await storedQuestion(quizId, "Q046"))?.status).toBe("ready");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/quizzes/${quizId}/review`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/quizzes/${quizId}`);
  });

  it("có phiên admin: lỗi validate trả thông báo và không revalidate", async () => {
    await signIn();
    const quizId = await seedDraftQuiz();

    const result = await reviewAnswer(quizId, "Q046", { selectedOptionKeys: [] });

    expect(result).toEqual({ ok: false, error: "Hãy chọn ít nhất một đáp án đúng." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("có phiên admin: xoá câu khỏi đề", async () => {
    await signIn();
    const quizId = await seedDraftQuiz();

    const result = await reviewRemoveQuestion(quizId, "Q046");

    expect(result.ok).toBe(true);
    expect((await storedQuestion(quizId, "Q046"))?.enabled).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/quizzes/${quizId}/review`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/quizzes/${quizId}`);
  });

  it("đề đã publish: action trả lỗi thay vì ghi", async () => {
    await signIn();
    const quizId = await seedDraftQuiz();
    await Quiz.updateOne({ _id: quizId }, { $set: { status: "published" } });

    const result = await reviewAnswer(quizId, "Q046", { selectedOptionKeys: ["a"] });

    expect(result.ok).toBe(false);
    expect((await storedQuestion(quizId, "Q046"))?.status).toBe("needs_review");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
