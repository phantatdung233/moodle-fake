"use server";

/**
 * Server actions behind the Quiz settings / publish / archive card on
 * `/admin/quizzes/[id]`. Each one goes through `withAdminAction`, which checks the
 * admin session itself (middleware is a UX gate, not a security boundary), and
 * lets the data layer enforce the state machine, so a posted action cannot skip
 * a hidden button.
 */
import { revalidatePath } from "next/cache";
import { withAdminAction } from "@/lib/admin/with-admin";
import {
  archiveQuiz,
  deleteDraftQuiz,
  publishQuiz,
  saveQuestionSelection,
  unpublishQuiz,
  updateQuizSettings,
  QUIZ_NOT_FOUND_ERROR,
} from "@/lib/quiz/lifecycle-repository";
import type { QuizMode } from "@/lib/quiz/quiz.model";

export type LifecycleActionResult =
  | { ok: true; publishedCount?: number; droppedCount?: number }
  | { ok: false; error: string };

function revalidateQuiz(quizId: string): void {
  revalidatePath(`/admin/quizzes/${quizId}`);
  revalidatePath("/admin");
  revalidatePath("/");
}

function readOptionalPositiveInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type QuizSettingsPayload = {
  title: string;
  slug: string;
  mode: QuizMode;
  timeLimit: number | string | null;
  maxAttempts: number | string | null;
};

/** Title, slug, mode, timeLimit and maxAttempts — draft only. */
export const saveQuizSettings = withAdminAction(async function saveQuizSettings(
  quizId: string,
  payload: QuizSettingsPayload,
): Promise<LifecycleActionResult> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Dữ liệu không hợp lệ." };
  }

  const timeLimit = readOptionalPositiveInt(payload.timeLimit);
  const maxAttempts = readOptionalPositiveInt(payload.maxAttempts);
  if (timeLimit === undefined) return { ok: false, error: "Thời gian làm bài phải là số phút." };
  if (maxAttempts === undefined) return { ok: false, error: "Số lần làm phải là số nguyên." };

  const result = await updateQuizSettings(quizId, {
    title: String(payload.title ?? ""),
    slug: String(payload.slug ?? ""),
    mode: payload.mode,
    timeLimit,
    maxAttempts,
  });
  if (result.ok) revalidateQuiz(quizId);
  return result;
});

/** Turns one Question on/off in a draft Quiz. */
export const toggleQuestion = withAdminAction(async function toggleQuestion(
  quizId: string,
  questionId: string,
  enabled: boolean,
): Promise<LifecycleActionResult> {
  if (typeof quizId !== "string" || typeof questionId !== "string") {
    return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  }

  const result = await saveQuestionSelection(quizId, questionId, enabled === true);
  if (result.ok) revalidateQuiz(quizId);
  return result;
});

/** Confirmed publish: drops non-ready Questions and freezes the Quiz. */
export const publishQuizAction = withAdminAction(async function publishQuizAction(
  quizId: string,
): Promise<LifecycleActionResult> {
  const result = await publishQuiz(quizId);
  if (result.ok) revalidateQuiz(quizId);
  return result;
});

/** `published → draft`, refused once any Attempt exists. */
export const unpublishQuizAction = withAdminAction(async function unpublishQuizAction(
  quizId: string,
): Promise<LifecycleActionResult> {
  const result = await unpublishQuiz(quizId);
  if (result.ok) revalidateQuiz(quizId);
  return result;
});

/** `published → archived`, the terminal state. */
export const archiveQuizAction = withAdminAction(async function archiveQuizAction(
  quizId: string,
): Promise<LifecycleActionResult> {
  const result = await archiveQuiz(quizId);
  if (result.ok) revalidateQuiz(quizId);
  return result;
});

/**
 * Deletes a draft Quiz, then sends the giảng viên back to the list: the page
 * they were on no longer exists. Published / archived Quizzes are refused by
 * the data layer.
 */
export const deleteQuizAction = withAdminAction(async function deleteQuizAction(
  quizId: string,
): Promise<LifecycleActionResult> {
  const result = await deleteDraftQuiz(quizId);
  if (!result.ok) return result;

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
});
