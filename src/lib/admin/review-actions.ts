"use server";

/**
 * Server actions behind the answer-review page. Each one goes through
 * `withAdminAction` (middleware is a UX gate, not a security boundary), validates its
 * input and, only after a write, revalidates the review and detail pages.
 */
import { revalidatePath } from "next/cache";
import { INVALID_ANSWER_ERROR } from "@/lib/admin/review-messages";
import { withAdminAction } from "@/lib/admin/with-admin";
import {
  removeQuestionFromQuiz,
  saveQuestionAnswer,
  type ReviewAnswerInput,
} from "@/lib/quiz/review-repository";

export type ReviewActionResult =
  | { ok: true; nextQuestionId: string | null }
  | { ok: false; error: string };

/**
 * Validates the answer a client form sends. Options arrive as a list of keys
 * (possibly repeated, possibly empty); blanks arrive as strings in Question
 * order. Validation beyond this (which keys exist, every blank non-empty) is
 * the repository's job, next to the Question it belongs to.
 */
function validateAnswer(answer: unknown): ReviewAnswerInput | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { selectedOptionKeys, blankAnswers } = answer as Record<string, unknown>;

  if (Array.isArray(selectedOptionKeys)) {
    if (!selectedOptionKeys.every((key): key is string => typeof key === "string")) {
      return null;
    }
    return { selectedOptionKeys: [...new Set(selectedOptionKeys)] };
  }
  if (Array.isArray(blankAnswers)) {
    if (!blankAnswers.every((value): value is string => typeof value === "string")) {
      return null;
    }
    return { blankAnswers };
  }
  return null;
}

function revalidateReview(quizId: string): void {
  revalidatePath(`/admin/quizzes/${quizId}/review`);
  revalidatePath(`/admin/quizzes/${quizId}`);
}

/** Records the giảng viên's answer and hands back the next Question to review. */
export const reviewAnswer = withAdminAction(async function reviewAnswer(
  quizId: string,
  questionId: string,
  answer: unknown,
): Promise<ReviewActionResult> {
  const input = validateAnswer(answer);
  if (!input) return { ok: false, error: INVALID_ANSWER_ERROR };

  const result = await saveQuestionAnswer(quizId, questionId, input);
  if (!result.ok) return result;

  revalidateReview(quizId);
  return result;
});

/** Soft-removes a Question from the Quiz (`enabled: false`, history kept). */
export const reviewRemoveQuestion = withAdminAction(async function reviewRemoveQuestion(
  quizId: string,
  questionId: string,
): Promise<ReviewActionResult> {
  if (typeof questionId !== "string" || questionId === "") {
    return { ok: false, error: "Không tìm thấy câu hỏi này trong đề." };
  }

  const result = await removeQuestionFromQuiz(quizId, questionId);
  if (!result.ok) return result;

  revalidateReview(quizId);
  return result;
});
