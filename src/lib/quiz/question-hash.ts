/**
 * Hash of the parts of a Question that matter for grading and explanations:
 * content + options + blanks. The giảng viên changes an answer → hash changes →
 * a stored explanation no longer applies. The parser
 * stamps it at upload; the review page recomputes it after every edit.
 */
import { createHash } from "node:crypto";
import type { QuizBlank, QuizOption, QuizQuestion } from "./quiz.model";

export function hashQuestionAnswers(
  content: string,
  options: readonly QuizOption[],
  blanks: readonly QuizBlank[],
): string {
  const payload = JSON.stringify({
    content,
    options: options.map((option) => ({
      key: option.key,
      text: option.text,
      correct: option.correct,
    })),
    blanks: blanks.map((blank) => ({ name: blank.name, acceptedAnswer: blank.acceptedAnswer })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** The Question with its `hash` brought back in line with its current answers. */
export function withRecomputedHash(question: QuizQuestion): QuizQuestion {
  return {
    ...question,
    hash: hashQuestionAnswers(question.content, question.options, question.blanks),
  };
}
