/**
 * Server-side resolution of "which Question is the browser asking about".
 *
 * The route never accepts a `Question.hash` from the client: the hash is the
 * cache key and decides *which* explanation text is served, so it has to come
 * from the Attempt the student cookie owns. That also keeps one sinh viên from
 * reading another's paper through the explanation endpoint.
 */
import { getAttemptForStudent } from "@/lib/quiz/attempt-repository";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";

export type ExplanationQuestion = {
  question: QuizQuestion;
  studentAnswer: { selectedOptionKeys: string[]; blankValues: string[] };
};

/**
 * The Question as snapshotted in this Attempt, plus the answer already saved
 * for it. `null` when the id is bad, the Attempt belongs to someone else, or
 * the Question is not part of that paper.
 */
export async function questionForExplanation(input: {
  attemptId: string;
  studentId: string;
  questionId: string;
}): Promise<ExplanationQuestion | null> {
  const attempt = await getAttemptForStudent(input.attemptId, input.studentId);
  if (!attempt) return null;

  const question = attempt.questionsSnapshot.find((candidate) => candidate.id === input.questionId);
  if (!question) return null;

  const answer = attempt.answers.find((candidate) => candidate.questionId === input.questionId);
  return {
    question,
    studentAnswer: {
      selectedOptionKeys: [...(answer?.selectedOptionKeys ?? [])],
      blankValues: [...(answer?.blankValues ?? [])],
    },
  };
}

/** The hash a client received at render time still matches this Attempt's snapshot. */
export function hashMatches(question: QuizQuestion, hash: string | undefined): boolean {
  return hash === undefined || hash === "" || hash === question.hash;
}
