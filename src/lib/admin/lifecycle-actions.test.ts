import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session";
import { STUDENT_SESSION_COOKIE } from "@/lib/student/session";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** Both cookies the current request carries, swapped between tests as "browsers". */
const jar = vi.hoisted(() => ({
  admin: undefined as string | undefined,
  student: undefined as string | undefined,
  setAdmin: undefined as string | undefined,
}));
const redirectTarget = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value =
        name === ADMIN_SESSION_COOKIE ? jar.admin : name === STUDENT_SESSION_COOKIE ? jar.student : undefined;
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      if (name === ADMIN_SESSION_COOKIE) {
        jar.admin = value || undefined;
        jar.setAdmin = value || undefined;
      }
      if (name === STUDENT_SESSION_COOKIE) jar.student = value || undefined;
    },
    delete: vi.fn(),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectTarget.value = url;
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { createAdminSessionCookie } = await import("@/lib/admin/session");
const { createStudentSessionCookie } = await import("@/lib/student/session");
const { transitionToStatus } = await import("./test-helpers");
const adminActions = await import("./lifecycle-actions");
const studentActions = await import("@/lib/student/actions");
const { Quiz } = await import("@/lib/quiz/quiz.model");
const { Attempt } = await import("@/lib/quiz/attempt.model");
const { parseQuizJson } = await import("@/lib/quiz/parser");
const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
const { resumeOrStartAttempt } = await import("@/lib/quiz/attempt-repository");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function signInAsAdmin(): Promise<void> {
  jar.admin = (await createAdminSessionCookie()).value;
}

async function signInAsStudent(studentId: string, attemptId: string): Promise<void> {
  jar.student = (
    await createStudentSessionCookie({ studentId, attemptId }, process.env.SESSION_SECRET)
  ).value;
}

async function seedQuiz(slug = "python-co-ban"): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 5),
  });
  if (!created.ok) throw new Error(created.error);
  return created.quizId;
}

describe("admin lifecycle actions", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_actions_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.admin = undefined;
    jar.student = undefined;
    jar.setAdmin = undefined;
  });

  it("từ chối mọi thao tác khi chưa có phiên admin", async () => {
    const quizId = await seedQuiz();
    const noSession = { ok: false, error: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại." };

    expect(await adminActions.publishQuizAction(quizId)).toEqual(noSession);
    expect(await adminActions.archiveQuizAction(quizId)).toEqual(noSession);
    expect(await adminActions.unpublishQuizAction(quizId)).toEqual(noSession);
    expect(await adminActions.toggleQuestion(quizId, "Q001", false)).toEqual(noSession);
    expect(await adminActions.deleteQuizAction(quizId)).toEqual(noSession);
    expect(
      await adminActions.saveQuizSettings(quizId, {
        title: "Đổi",
        slug: "doi",
        mode: "practice",
        timeLimit: null,
        maxAttempts: null,
      }),
    ).toEqual(noSession);

    expect((await Quiz.findById(quizId).lean())?.status).toBe("draft");
  });

  it("publish qua action với phiên admin hợp lệ", async () => {
    const quizId = await seedQuiz();
    await signInAsAdmin();

    expect(await adminActions.publishQuizAction(quizId)).toMatchObject({ ok: true });

    expect((await Quiz.findById(quizId).lean())?.status).toBe("published");
  });

  it("xoá đề nháp qua action, nhưng không xoá được đề đã publish", async () => {
    const quizId = await seedQuiz();
    await signInAsAdmin();

    expect(await adminActions.deleteQuizAction(quizId)).toEqual({ ok: true });
    expect(await Quiz.findById(quizId).lean()).toBeNull();

    const publishedId = await seedQuiz("da-publish");
    expect(await adminActions.publishQuizAction(publishedId)).toMatchObject({ ok: true });
    expect(await adminActions.deleteQuizAction(publishedId)).toEqual({
      ok: false,
      error: "Chỉ xoá được đề nháp. Đề đã publish hoặc đã lưu trữ phải giữ lại để lượt làm cũ còn đọc được.",
    });
    expect(await Quiz.findById(publishedId).lean()).not.toBeNull();
  });
});

describe("student submit action", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_submit_actions_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.admin = undefined;
    jar.student = undefined;
    quizId = await seedQuiz();
    await transitionToStatus(quizId, "published");
  });

  it("nộp bài qua action, rồi trang tổng kết đọc đúng lượt của mình", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await signInAsStudent("B2012345", started.attempt.id);

    const submitted = await studentActions.submitMyAttempt();
    expect(submitted).toMatchObject({ ok: true, status: "submitted" });

    const summary = await studentActions.loadSummary({ quizId });
    expect(summary?.latest).toMatchObject({ id: started.attempt.id, status: "submitted" });
    expect(summary?.attemptCount).toBe(1);
    expect(summary?.canStartNew).toBe(true);
  });

  it("không lộ lượt làm của sinh viên khác", async () => {
    const mine = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    const theirs = await resumeOrStartAttempt({ quizId, studentId: "B9999999", studentName: "Bình" });
    if (!mine.ok || !theirs.ok) throw new Error("start failed");

    await signInAsStudent("B2012345", mine.attempt.id);
    await studentActions.submitMyAttempt();

    const summary = await studentActions.loadSummary({ quizId });
    expect(summary?.history.map((attempt) => attempt.id)).toEqual([mine.attempt.id]);
    expect(summary?.history.some((attempt) => attempt.id === theirs.attempt.id)).toBe(false);
    // The cookie points at my Attempt; another attempt id in the URL buys nothing.
    const other = await studentActions.loadOwnedAttempt({ slug: "python-co-ban" });
    expect(other?.id).toBe(mine.attempt.id);
    expect(await Attempt.countDocuments({ studentId: "B9999999" })).toBe(1);
  });

  it("không nộp được khi chưa có danh tính sinh viên", async () => {
    expect(await studentActions.submitMyAttempt()).toEqual({
      ok: false,
      error: "Bạn cần nhập MSSV và họ tên trước khi làm bài.",
    });
  });
});
