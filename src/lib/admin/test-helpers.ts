/**
 * Test-only helpers shared by the action tests. Not imported by the app.
 */
import { Attempt } from "@/lib/quiz/attempt.model";
import { Quiz, type QuizStatus } from "@/lib/quiz/quiz.model";

/**
 * Moves a Quiz to `status` through the data layer's own transitions
 * (`publish → archive`), so a test never writes a state the app could not
 * reach. `draft` and `published` are one call away from a fresh draft.
 */
export async function transitionToStatus(quizId: string, status: QuizStatus): Promise<void> {
  const lifecycle = await import("@/lib/quiz/lifecycle-repository");
  const quiz = await Quiz.findById(quizId).lean();
  if (!quiz) throw new Error("Quiz không tồn tại");

  if (quiz.status === status) return;
  if (status === "published") {
    const published = await lifecycle.publishQuiz(quizId);
    if (!published.ok) throw new Error(published.error);
    return;
  }
  if (status === "draft") {
    const unpublished = await lifecycle.unpublishQuiz(quizId);
    if (!unpublished.ok) throw new Error(unpublished.error);
    return;
  }

  await transitionToStatus(quizId, "published");
  const archived = await lifecycle.archiveQuiz(quizId);
  if (!archived.ok) throw new Error(archived.error);
}

/** Clears every Attempt of a Quiz, so a test can unpublish it. */
export async function resetAttempts(quizId: string): Promise<void> {
  await Attempt.deleteMany({ quizId });
}
