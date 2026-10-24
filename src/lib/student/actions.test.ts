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

const {
  beginAttempt,
  loadAttempt,
  loadOwnedAttempt,
  loadStudent,
  saveAnswer,
  revealAnswer,
  signInStudent,
  startNewAttempt,
} = await import("./actions");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedQuiz(
  slug = "python-co-ban",
  options: { mode?: "practice" | "exam"; maxAttempts?: number } = {},
): Promise<string> {
  const { parseQuizJson } = await import("@/lib/quiz/parser");
  const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
  const { updateQuizSettings, publishQuiz } = await import("@/lib/quiz/lifecycle-repository");
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions,
  });
  if (!created.ok) throw new Error(created.error);
  if (options.mode === "exam") {
    const saved = await updateQuizSettings(created.quizId, {
      title: "Python cơ bản",
      slug,
      mode: "exam",
      timeLimit: 20,
      maxAttempts: options.maxAttempts ?? 1,
    });
    if (!saved.ok) throw new Error(saved.error);
  }
  // Only a published Quiz accepts Attempts (ticket #8).
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

/** Removes every Quiz so a test can seed one with different settings. */
async function clearSeedQuiz(): Promise<void> {
  const { clearTestDatabase } = await import("@/test/mongo");
  await clearTestDatabase();
}

async function signInAsCookie(studentId: string, studentName = "An"): Promise<void> {
  const { createStudentSessionCookie } = await import("@/lib/student/session");
  studentCookie.value = (
    await createStudentSessionCookie({ studentId, studentName }, process.env.SESSION_SECRET)
  ).value;
}

/** The Attempt ids this MSSV owns, newest last. */
async function attemptIdsOf(studentId: string): Promise<string[]> {
  const { Attempt } = await import("@/lib/quiz/attempt.model");
  const docs = await Attempt.find({ studentId }).sort({ createdAt: 1 }).lean();
  return docs.map((doc) => String(doc._id));
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
      studentName: "Nguyễn Văn An",
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

  it("signInStudent remembers the identity without opening an Attempt", async () => {
    expect(await signInStudent({ studentId: "b2012345", studentName: "  Nguyễn   Văn  An " })).toBeUndefined();

    expect(await loadStudent()).toEqual({
      studentId: "B2012345",
      studentName: "Nguyễn Văn An",
    });
    // Nothing was started: the home page only remembers who is browsing.
    expect(await attemptIdsOf("B2012345")).toEqual([]);
  });

  it("signInStudent rejects blank fields and leaves no cookie", async () => {
    expect(await signInStudent({ studentId: "  ", studentName: "An" })).toMatchObject({
      ok: false,
      error: "Vui lòng nhập MSSV.",
    });
    expect(await signInStudent({ studentId: "B1", studentName: " " })).toMatchObject({
      ok: false,
      error: "Vui lòng nhập họ tên.",
    });
    expect(studentCookie.value).toBeUndefined();
  });

  it("loadAttempt returns the Attempt only to the browser holding its identity", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const [attemptId] = await attemptIdsOf("B2012345");

    expect(await loadAttempt({ slug: "python-co-ban" })).toMatchObject({
      id: attemptId,
      studentId: "B2012345",
    });

    // Another browser: no cookie at all, and a cookie for a different student.
    studentCookie.value = undefined;
    expect(await loadAttempt({ slug: "python-co-ban" })).toBeNull();

    await signInAsCookie("B9999999");
    expect(await loadAttempt({ slug: "python-co-ban" })).toBeNull();
  });

  it("one identity serves every Quiz, each keeping its own open Attempt", async () => {
    const secondId = await seedQuiz("python-nang-cao");
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const first = await loadAttempt({ slug: "python-co-ban" });
    if (!first) throw new Error("no first attempt");

    // A direct link to another Quiz with the same cookie: no re-typed name.
    await expect(loadAttempt({ slug: "python-nang-cao" })).resolves.toBeNull();
    await signInAsCookie("B2012345", "An");
    await beginAttempt({ slug: "python-nang-cao", studentId: "B2012345", studentName: "An" }).catch(() => {});

    const second = await loadAttempt({ slug: "python-nang-cao" });
    expect(second?.id).toBeTruthy();
    expect(second?.id).not.toBe(first.id);
    expect(second).toMatchObject({ quizId: secondId, studentId: "B2012345" });

    // The first paper is untouched and still open.
    expect(await loadAttempt({ slug: "python-co-ban" })).toMatchObject({ id: first.id });
  });

  it("saveAnswer persists every answer and revealAnswer locks the Question", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const [attemptId] = await attemptIdsOf("B2012345");

    expect(
      await saveAnswer({ attemptId, questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [] }),
    ).toEqual({ ok: true });

    const revealed = await revealAnswer({ attemptId, questionId: "Q001" });
    expect(revealed).toMatchObject({ ok: true, feedback: { correct: true } });

    expect(
      await saveAnswer({ attemptId, questionId: "Q001", selectedOptionKeys: ["a"], blankValues: [] }),
    ).toEqual({ ok: false, error: "Câu này đã khoá sau khi xem đáp án nên không sửa được nữa." });
  });

  it("beginAttempt resumes the same in-progress Attempt on a second visit", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const first = await loadAttempt({ slug: "python-co-ban" });
    if (!first) throw new Error("no attempt");

    await saveAnswer({ attemptId: first.id, questionId: "Q031", selectedOptionKeys: [], blankValues: ["a", "b"] });
    // Same browser (cookie forgotten → the form shows again), then the form again.
    studentCookie.value = undefined;
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});

    expect((await loadAttempt({ slug: "python-co-ban" }))?.id).toBe(first.id);
    expect((await loadAttempt({ slug: "python-co-ban" }))?.answers[0]).toMatchObject({
      questionId: "Q031",
      blankValues: ["a", "b"],
    });
    expect(await attemptIdsOf("B2012345")).toHaveLength(1);
  });

  it("startNewAttempt closes the open paper and opens a fresh one", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const first = await loadAttempt({ slug: "python-co-ban" });
    if (!first) throw new Error("no attempt");
    await saveAnswer({ attemptId: first.id, questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [] });

    // This is what the "Làm lại" link does; `/q/<slug>` would have resumed `first`.
    await expect(startNewAttempt({ slug: "python-co-ban" })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget.value).toBe("/q/python-co-ban");

    const fresh = await loadAttempt({ slug: "python-co-ban" });
    expect(fresh?.id).toBeTruthy();
    expect(fresh?.id).not.toBe(first.id);
    // A new paper starts blank, not with the previous answers.
    expect(fresh?.answers).toEqual([]);

    // The old one is closed, so the history has both.
    const { Attempt } = await import("@/lib/quiz/attempt.model");
    const firstDoc = await Attempt.findById(first.id).lean();
    expect(firstDoc?.status).toBe("submitted");
  });

  it("startNewAttempt refuses without an identity or an unknown Quiz", async () => {
    expect(await startNewAttempt({ slug: "python-co-ban" })).toMatchObject({
      ok: false,
      error: "Bạn cần nhập MSSV và họ tên trước khi làm bài.",
    });

    await signInAsCookie("B2012345");
    expect(await startNewAttempt({ slug: "khong-ton-tai" })).toMatchObject({ ok: false });
    expect(redirectTarget.value).toBeUndefined();
  });

  it("startNewAttempt honours an exam's attempt limit", async () => {
    // A one-attempt exam: the seeded practice Quiz would allow a retry.
    await clearSeedQuiz();
    await seedQuiz("python-co-ban", { mode: "exam", maxAttempts: 1 });
    await signInAsCookie("B2012345");
    await startNewAttempt({ slug: "python-co-ban" }).catch(() => {});
    // That one attempt is open; making another would exceed the limit.
    expect(await startNewAttempt({ slug: "python-co-ban" })).toMatchObject({
      ok: false,
      error: "Bạn đã hết 1 lần làm đề này.",
    });
  });

  it("loadOwnedAttempt sends a submitted paper to its summary", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const attempt = await loadAttempt({ slug: "python-co-ban" });
    if (!attempt) throw new Error("no attempt");
    const { submitAttempt } = await import("@/lib/quiz/attempt-repository");
    await submitAttempt({ attemptId: attempt.id, studentId: "B2012345" });

    expect(await loadAttempt({ slug: "python-co-ban" })).toBeNull();
    expect(await loadOwnedAttempt({ slug: "python-co-ban" })).toMatchObject({
      id: attempt.id,
      status: "submitted",
    });
  });

  it("saveAnswer and revealAnswer refuse a browser without the attempt's identity", async () => {
    await beginAttempt({ slug: "python-co-ban", studentId: "B2012345", studentName: "An" }).catch(() => {});
    const [attemptId] = await attemptIdsOf("B2012345");

    await signInAsCookie("B9999999", "Kẻ khác");

    expect(
      await saveAnswer({ attemptId, questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [] }),
    ).toEqual({ ok: false, error: "Bạn không có quyền làm bài này." });
    expect(await revealAnswer({ attemptId, questionId: "Q001" })).toEqual({
      ok: false,
      error: "Bạn không có quyền làm bài này.",
    });

    // The rightful owner still sees the untouched Attempt.
    await signInAsCookie("B2012345");
    expect((await loadAttempt({ slug: "python-co-ban" }))?.answers).toEqual([]);
  });
});
