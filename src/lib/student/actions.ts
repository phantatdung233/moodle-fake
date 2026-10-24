"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getQuizBySlug } from "@/lib/quiz/repository";
import {
  answerQuestion,
  getSummaryForStudent,
  resumeOrStartAttempt,
  revealQuestion,
  submitAttempt,
  submitExpiredIfDue,
  type AttemptSummary,
  type AttemptView,
  type RevealFeedback,
} from "@/lib/quiz/attempt-repository";
import type { AttemptResult } from "@/lib/quiz/attempt.model";
import {
  clearedStudentSessionCookie,
  createStudentSessionCookie,
  readStudentSession,
  STUDENT_SESSION_COOKIE,
  type StudentIdentity,
} from "@/lib/student/session";

/**
 * Student-facing server actions.
 *
 * The cookie says "this browser is MSSV X (họ tên Y)" — identity, not a
 * particular Attempt. Each call looks the Attempt up by MSSV and Quiz, and the
 * data layer re-checks that it belongs to X, so a stale or forged value buys
 * nothing. That is what lets one identity span every Quiz: opening `/q/<slug>`
 * resumes or starts *that* Quiz's paper without touching the others.
 */

const NO_IDENTITY = "Bạn cần nhập MSSV và họ tên trước khi làm bài.";
const SESSION_SECRET_MISSING = "Chưa cấu hình SESSION_SECRET trên máy chủ.";

async function currentIdentity(): Promise<StudentIdentity | null> {
  const cookieStore = await cookies();
  return readStudentSession(
    cookieStore.get(STUDENT_SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET,
  );
}

async function saveIdentity(identity: StudentIdentity) {
  const cookie = await createStudentSessionCookie(identity, process.env.SESSION_SECRET);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
}

function normaliseIdentity(input: { studentId: string; studentName: string }) {
  const studentId = input.studentId.trim().toUpperCase();
  const studentName = input.studentName.trim().replace(/\s+/g, " ");
  if (studentId === "") return { ok: false as const, error: "Vui lòng nhập MSSV." };
  if (studentId.length > 30) return { ok: false as const, error: "MSSV quá dài." };
  if (studentName === "") return { ok: false as const, error: "Vui lòng nhập họ tên." };
  if (studentName.length > 100) return { ok: false as const, error: "Họ tên quá dài." };
  return { ok: true as const, studentId, studentName };
}

/** The identity this browser signed in with, for headers and forms. */
export async function loadStudent(): Promise<StudentIdentity | null> {
  return currentIdentity();
}

/**
 * The student's own Attempt of every Quiz, keyed by quiz id, for the home list:
 * a card can then say how many questions are answered or offer "Làm tiếp".
 * One read per Quiz, only for the Quizzes actually on the page.
 */
export async function loadHomeSummaries(
  quizIds: readonly string[],
): Promise<Record<string, AttemptSummary>> {
  const identity = await currentIdentity();
  if (!identity) return {};

  const entries = await Promise.all(
    quizIds.map(async (quizId) => {
      const summary = await getSummaryForStudent(quizId, identity.studentId);
      return summary ? ([quizId, summary] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

/**
 * Home page: remember who this browser is and stay here. Every Quiz then opens
 * for this student without asking again; "Đổi MSSV" clears it.
 */
export async function signInStudent(input: {
  studentId: string;
  studentName: string;
}): Promise<{ ok: false; error: string } | void> {
  if (!process.env.SESSION_SECRET) return { ok: false, error: SESSION_SECRET_MISSING };

  const identity = normaliseIdentity(input);
  if (!identity.ok) return identity;

  await saveIdentity({ studentId: identity.studentId, studentName: identity.studentName });
  revalidatePath("/", "layout");
}

export type BeginAttemptInput = {
  slug: string;
  studentId: string;
  studentName: string;
};

export type BeginAttemptError = { ok: false; error: string };

/**
 * A Quiz page opened without an identity (a direct link): sign in and start or
 * resume that Quiz's Attempt in one step, then land on the quiz screen.
 */
export async function beginAttempt(input: BeginAttemptInput): Promise<BeginAttemptError | void> {
  if (!process.env.SESSION_SECRET) return { ok: false, error: SESSION_SECRET_MISSING };

  const identity = normaliseIdentity(input);
  if (!identity.ok) return identity;

  const quiz = await getQuizBySlug(input.slug);
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };

  const result = await resumeOrStartAttempt({
    quizId: quiz.id,
    studentId: identity.studentId,
    studentName: identity.studentName,
  });
  if (!result.ok) return result;

  await saveIdentity({ studentId: identity.studentId, studentName: identity.studentName });
  redirect(`/q/${quiz.slug}`);
}

/**
 * "Làm lại": opens a *new* Attempt for this Quiz.
 *
 * It cannot be a link to `/q/<slug>`, because that page resumes the Attempt
 * still in progress — the retry would bounce straight back to the paper it came
 * from. Submitting that paper first keeps one open Attempt per Quiz; the
 * published state and the attempt limit are still enforced by
 * `resumeOrStartAttempt`.
 */
export async function startNewAttempt(input: {
  slug: string;
}): Promise<{ ok: false; error: string } | void> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const quiz = await getQuizBySlug(input.slug);
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };

  const summary = await getSummaryForStudent(quiz.id, identity.studentId);
  const open = summary?.inProgress ?? null;
  if (open) {
    const closed = await submitAttempt({ attemptId: open.id, studentId: identity.studentId });
    if (!closed.ok) return closed;
  }

  // Refused when the Quiz closed or its attempt limit is used up.
  const result = await resumeOrStartAttempt({
    quizId: quiz.id,
    studentId: identity.studentId,
    studentName: identity.studentName,
  });
  if (!result.ok) return result;

  revalidatePath("/", "layout");
  redirect(`/q/${quiz.slug}`);
}

/**
 * The "Làm lại" work with no redirect or revalidation attached — both are
 * illegal while a page renders (Next rejects them). `/q/<slug>/lam-moi` calls
 * this and then redirects itself; `startNewAttempt` is the form-action wrapper.
 */
export async function retryAttempt(input: {
  slug: string;
}): Promise<{ ok: false; error: string } | void> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const quiz = await getQuizBySlug(input.slug).catch(() => null);
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };

  const summary = await getSummaryForStudent(quiz.id, identity.studentId);
  const open = summary?.inProgress ?? null;
  if (open) {
    const closed = await submitAttempt({ attemptId: open.id, studentId: identity.studentId });
    if (!closed.ok) return closed;
  }

  // Refused when the Quiz closed or its attempt limit is used up.
  const result = await resumeOrStartAttempt({
    quizId: quiz.id,
    studentId: identity.studentId,
    studentName: identity.studentName,
  });
  if (!result.ok) return result;
}

/**
 * Opens (or resumes) this Quiz's Attempt for the signed-in student. The quiz
 * page calls it when the browser already has an identity — returned by
 * `POST /` or by the identity form — so entering MSSV once on the home page
 * opens every Quiz without asking again. It is the same `resumeOrStartAttempt`
 * the form uses, so the published check and the exam limit still apply.
 */
export async function startAttempt(input: {
  slug: string;
}): Promise<{ ok: false; error: string } | { ok: true }> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const quiz = await getQuizBySlug(input.slug).catch(() => null);
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };

  const result = await resumeOrStartAttempt({
    quizId: quiz.id,
    studentId: identity.studentId,
    studentName: identity.studentName,
  });
  return result.ok ? { ok: true } : result;
}

/**
 * The Attempt this browser is working on for the Quiz, or `null`. An exam
 * Attempt past its deadline is auto-submitted here, before the page decides
 * between the runner and the summary (Spec, "Làm bài").
 *
 * Pure read: it never opens an Attempt. A first visit is started by
 * `startAttempt`, so merely rendering a page cannot consume an exam attempt.
 */
export async function loadAttempt(input: { slug: string }): Promise<AttemptView | null> {
  const identity = await currentIdentity();
  if (!identity) return null;

  const quiz = await getQuizBySlug(input.slug);
  if (!quiz) return null;

  const summary = await getSummaryForStudent(quiz.id, identity.studentId);
  const open = summary?.inProgress ?? null;
  if (!open) return null;

  const attempt = await submitExpiredIfDue({
    attemptId: open.id,
    studentId: identity.studentId,
  });
  if (!attempt || attempt.quizSlug !== input.slug || attempt.status !== "in_progress") return null;
  return attempt;
}

/**
 * The Attempt this student owns for the Quiz, in any state (`null` when they
 * never opened it). Used to send a submitted paper to its summary.
 */
export async function loadOwnedAttempt(input: { slug: string }): Promise<AttemptView | null> {
  const identity = await currentIdentity();
  if (!identity) return null;

  const quiz = await getQuizBySlug(input.slug);
  if (!quiz) return null;

  const summary = await getSummaryForStudent(quiz.id, identity.studentId);
  const attempt = summary?.latest ?? null;
  if (!attempt) return null;

  // A finished exam past its deadline becomes `expired` on read.
  return submitExpiredIfDue({ attemptId: attempt.id, studentId: identity.studentId });
}

/**
 * The summary page's data: only this MSSV's Attempts for the Quiz. `latest` is
 * the Attempt named in the URL, else the newest finished one.
 */
export async function loadSummary(input: {
  quizId: string;
  attemptId?: string;
}): Promise<AttemptSummary | null> {
  const identity = await currentIdentity();
  if (!identity) return null;
  return getSummaryForStudent(input.quizId, identity.studentId, input.attemptId);
}

export type SaveAnswerInput = {
  /** The Attempt on screen; the data layer checks it belongs to this MSSV. */
  attemptId: string;
  questionId: string;
  selectedOptionKeys: string[];
  blankValues: string[];
};

export type SaveAnswerResult = { ok: true } | { ok: false; error: string };

/** Called on every choice/keystroke; the client debounces text input itself. */
export async function saveAnswer(input: SaveAnswerInput): Promise<SaveAnswerResult> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  return answerQuestion({
    attemptId: input.attemptId,
    studentId: identity.studentId,
    questionId: input.questionId,
    selectedOptionKeys: input.selectedOptionKeys,
    blankValues: input.blankValues,
  });
}

export type RevealAnswerResult = { ok: true; feedback: RevealFeedback } | { ok: false; error: string };

/** Practice only: grades + locks the Question and returns what to show. */
export async function revealAnswer(input: {
  attemptId: string;
  questionId: string;
}): Promise<RevealAnswerResult> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const result = await revealQuestion({
    attemptId: input.attemptId,
    studentId: identity.studentId,
    questionId: input.questionId,
  });
  if (result.ok) revalidatePath("/q", "layout");
  return result;
}

export type SubmitAttemptResult =
  | { ok: true; status: "submitted" | "expired"; result: AttemptResult }
  | { ok: false; error: string };

/** "Nộp bài" after the confirm dialog; practice and exam alike. */
export async function submitMyAttempt(input: { attemptId: string }): Promise<SubmitAttemptResult> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const result = await submitAttempt({
    attemptId: input.attemptId,
    studentId: identity.studentId,
  });
  if (result.ok) {
    revalidatePath("/q", "layout");
    revalidatePath("/");
  }
  return result;
}

/** Forgets this browser's student identity (switching sinh viên on a shared phone). */
export async function forgetStudent(): Promise<void> {
  const cookie = clearedStudentSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
  redirect("/");
}
