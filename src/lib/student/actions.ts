"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getQuizBySlug } from "@/lib/quiz/repository";
import {
  answerQuestion,
  getAttemptForStudent,
  resumeOrStartAttempt,
  revealQuestion,
  type AttemptView,
  type RevealFeedback,
} from "@/lib/quiz/attempt-repository";
import {
  clearedStudentSessionCookie,
  createStudentSessionCookie,
  readStudentSession,
  STUDENT_SESSION_COOKIE,
} from "@/lib/student/session";

/**
 * Student-facing server actions. The cookie only says "this browser claims to
 * be MSSV X working on Attempt Y"; every call below re-checks with the data
 * layer that Attempt Y belongs to MSSV X, so a stolen attempt id buys nothing.
 */

const NO_IDENTITY = "Bạn cần nhập MSSV và họ tên trước khi làm bài.";
const SESSION_SECRET_MISSING = "Chưa cấu hình SESSION_SECRET trên máy chủ.";

export type BeginAttemptInput = {
  slug: string;
  studentId: string;
  studentName: string;
};

export type BeginAttemptError = { ok: false; error: string };

async function currentIdentity() {
  const cookieStore = await cookies();
  return readStudentSession(
    cookieStore.get(STUDENT_SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET,
  );
}

/** Identity form: resumes or starts the Attempt, then lands on the quiz screen. */
export async function beginAttempt(input: BeginAttemptInput): Promise<BeginAttemptError | void> {
  if (!process.env.SESSION_SECRET) return { ok: false, error: SESSION_SECRET_MISSING };

  const quiz = await getQuizBySlug(input.slug);
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };

  const result = await resumeOrStartAttempt({
    quizId: quiz.id,
    studentId: input.studentId,
    studentName: input.studentName,
  });
  if (!result.ok) return result;

  const cookie = await createStudentSessionCookie(
    { studentId: result.attempt.studentId, attemptId: result.attempt.id },
    process.env.SESSION_SECRET,
  );
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);

  redirect(`/q/${quiz.slug}`);
}

/** The Attempt this browser is working on for the Quiz, or `null` (identity form). */
export async function loadAttempt(input: { slug: string }): Promise<AttemptView | null> {
  const identity = await currentIdentity();
  if (!identity) return null;

  const attempt = await getAttemptForStudent(identity.attemptId, identity.studentId);
  if (!attempt || attempt.quizSlug !== input.slug || attempt.status !== "in_progress") return null;
  return attempt;
}

export type SaveAnswerInput = {
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
    attemptId: identity.attemptId,
    studentId: identity.studentId,
    questionId: input.questionId,
    selectedOptionKeys: input.selectedOptionKeys,
    blankValues: input.blankValues,
  });
}

export type RevealAnswerResult = { ok: true; feedback: RevealFeedback } | { ok: false; error: string };

/** Practice only: grades + locks the Question and returns what to show. */
export async function revealAnswer(input: { questionId: string }): Promise<RevealAnswerResult> {
  const identity = await currentIdentity();
  if (!identity) return { ok: false, error: NO_IDENTITY };

  const result = await revealQuestion({
    attemptId: identity.attemptId,
    studentId: identity.studentId,
    questionId: input.questionId,
  });
  if (result.ok) revalidatePath("/q", "layout");
  return result;
}

/** Forgets this browser's student identity (switching sinh viên on a shared phone). */
export async function forgetStudent(): Promise<void> {
  const cookie = clearedStudentSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
  redirect("/");
}
