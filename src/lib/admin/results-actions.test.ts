/**
 * Seam: the reset button' server action. Like the other admin actions it
 * checks the session itself; the tests run it exactly as a browser would post
 * it and then read the results table.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { ADMIN_SESSION_COOKIE, createAdminSessionCookie } from "@/lib/admin/session";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import { resumeOrStartAttempt, submitAttempt } from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const jar = vi.hoisted(() => ({ admin: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ADMIN_SESSION_COOKIE && jar.admin ? { name, value: jar.admin } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

const revalidated = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.paths.push(path);
  },
}));

const { resetStudentAttemptsAction } = await import("./results-actions");
const { listResults } = await import("./results-repository");

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

async function takeAttempt(quizId: string, studentId: string): Promise<void> {
  const started = await resumeOrStartAttempt({ quizId, studentId, studentName: studentId });
  if (!started.ok) throw new Error(started.error);
  await submitAttempt({ attemptId: started.attempt.id, studentId });
}

describe("resetStudentAttemptsAction", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_actions_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.admin = undefined;
    revalidated.paths = [];
    quizId = await seedPublishedQuiz("python-co-ban", "Python cơ bản");
  });

  it("từ chối khi chưa đăng nhập admin và không xoá gì", async () => {
    await takeAttempt(quizId, "B2012345");

    expect(await resetStudentAttemptsAction({ quizId, studentId: "B2012345" })).toEqual({
      ok: false,
      error: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.",
    });
    expect((await listResults({})).totalRows).toBe(1);
  });

  it("xoá đúng lượt của sinh viên trong đề và làm mới trang kết quả", async () => {
    await takeAttempt(quizId, "B2012345");
    await takeAttempt(quizId, "B9999999");
    jar.admin = (await createAdminSessionCookie()).value;

    const result = await resetStudentAttemptsAction({ quizId, studentId: "b2012345" });

    expect(result).toEqual({ ok: true, deletedCount: 1 });
    expect((await listResults({})).rows.map((row) => row.studentId)).toEqual(["B9999999"]);
    expect(revalidated.paths).toContain("/admin/results");
  });

  it("báo lỗi tiếng Việt khi không có lượt nào để reset", async () => {
    jar.admin = (await createAdminSessionCookie()).value;

    expect(await resetStudentAttemptsAction({ quizId, studentId: "B404" })).toEqual({
      ok: false,
      error: "Không có lượt làm nào của B404 trong đề này.",
    });
  });
});
