import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { STUDENT_SESSION_COOKIE } from "@/lib/student/session";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** The student cookie the current request carries; swapped between "browsers". */
const studentCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
const redirectTarget = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === STUDENT_SESSION_COOKIE && studentCookie.value
        ? { name, value: studentCookie.value }
        : undefined,
    // The action's own write: record it so the test can act as the browser.
    set: (name: string, value: string) => {
      if (name === STUDENT_SESSION_COOKIE) studentCookie.value = value || undefined;
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

const { beginAttempt, loadAttempt, saveAnswer, revealAnswer } = await import("./actions");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedQuiz(): Promise<string> {
  const { parseQuizJson } = await import("@/lib/quiz/parser");
  const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: "python-co-ban",
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions,
  });
  if (!created.ok) throw new Error(created.error);
  // Only a published Quiz accepts Attempts (ticket #8).
  const { publishQuiz } = await import("@/lib/quiz/lifecycle-repository");
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

async function signInAsCookie(studentId: string, attemptId: string): Promise<void> {
  const { createStudentSessionCookie } = await import("@/lib/student/session");
  studentCookie.value = (
    await createStudentSessionCookie({ studentId, attemptId }, process.env.SESSION_SECRET)
  ).value;
}

describe("student server actions", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_student_actions_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    studentCookie.value = undefined;
    redirectTarget.value = undefined;
    await seedQuiz();
  });

  it("beginAttempt signs the identity cookie and sends the sinh viên to the quiz", async () => {
    await expect(
      beginAttempt({ slug: "python-co-ban", studentId: " b2012345 ", studentName: "Nguyễn Văn An" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectTarget.value).toBe("/q/python-co-ban");
    expect(studentCookie.value).toBeTruthy();
    const { readStudentSession } = await import("@/lib/student/session");
    expect(await readStudentSession(studentCookie.value, process.env.SESSION_SECRET)).toMatchObject({
      studentId: "B2012345",
    });
  });

  it("beginAttempt refuses an unknown quiz or a blank name without setting a cookie", async () => {
    expect(await beginAttempt({ slug: "khong-ton-tai", studentId: "B1", studentName: "An" })).toMatchObject({
      ok: false,
    });
    expect(
      await beginAttempt({ slug: "python-co-ban", studentId: "B1", studentName: "  " }),
    ).toMatchObject({ ok: false, error: "Vui lòng nhập họ tên." });
    expect(studentCookie.value).toBeUndefined();
  });

  it("loadAttempt returns the Attempt only to the browser holding its cookie", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const { readStudentSession } = await import("@/lib/student/session");
    const identity = await readStudentSession(studentCookie.value, process.env.SESSION_SECRET);
    if (!identity) throw new Error("no cookie");

    const mine = await loadAttempt({ slug: "python-co-ban" });
    expect(mine).toMatchObject({ id: identity.attemptId, studentId: "B2012345" });

    // Another browser: no cookie at all, and a cookie for a different student.
    studentCookie.value = undefined;
    expect(await loadAttempt({ slug: "python-co-ban" })).toBeNull();

    await signInAsCookie("B9999999", identity.attemptId);
    expect(await loadAttempt({ slug: "python-co-ban" })).toBeNull();
  });

  it("saveAnswer persists every answer and revealAnswer locks the Question", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});

    expect(
      await saveAnswer({ questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [] }),
    ).toEqual({ ok: true });

    const revealed = await revealAnswer({ questionId: "Q001" });
    expect(revealed).toMatchObject({ ok: true, feedback: { correct: true } });

    expect(
      await saveAnswer({ questionId: "Q001", selectedOptionKeys: ["a"], blankValues: [] }),
    ).toEqual({ ok: false, error: "Câu này đã khoá sau khi xem đáp án nên không sửa được nữa." });
  });

  it("beginAttempt resumes the same in-progress Attempt on a second visit", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const { readStudentSession } = await import("@/lib/student/session");
    const first = await readStudentSession(studentCookie.value, process.env.SESSION_SECRET);
    if (!first) throw new Error("no cookie");

    await saveAnswer({ questionId: "Q031", selectedOptionKeys: [], blankValues: ["a", "b"] });
    // Same browser (cookie forgotten → the form shows again), then the form again.
    studentCookie.value = undefined;
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const second = await readStudentSession(studentCookie.value, process.env.SESSION_SECRET);

    expect(second?.attemptId).toBe(first.attemptId);
    expect((await loadAttempt({ slug: "python-co-ban" }))?.answers[0]).toMatchObject({
      questionId: "Q031",
      blankValues: ["a", "b"],
    });
    const { Attempt } = await import("@/lib/quiz/attempt.model");
    expect(await Attempt.countDocuments({ studentId: "B2012345" })).toBe(1);
  });

  it("saveAnswer and revealAnswer refuse a browser without the attempt's cookie", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const { readStudentSession } = await import("@/lib/student/session");
    const identity = await readStudentSession(studentCookie.value, process.env.SESSION_SECRET);
    if (!identity) throw new Error("no cookie");

    await signInAsCookie("B9999999", identity.attemptId);

    expect(
      await saveAnswer({ questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [] }),
    ).toEqual({ ok: false, error: "Bạn không có quyền làm bài này." });
    expect(await revealAnswer({ questionId: "Q001" })).toEqual({
      ok: false,
      error: "Bạn không có quyền làm bài này.",
    });

    // The rightful owner still sees the untouched Attempt.
    await signInAsCookie("B2012345", identity.attemptId);
    expect((await loadAttempt({ slug: "python-co-ban" }))?.answers).toEqual([]);
  });
});
