import type { BlankGrade } from "@/lib/quiz/grading";

/**
 * Turns a reveal result into the sentences the feedback panel shows. Pure so
 * the Vietnamese wording is testable without rendering React.
 */

export type FeedbackInput = {
  correct: boolean;
  score: number;
  correctOptionKeys?: string[];
  perBlank?: BlankGrade[];
};

export type WrongBlank = { name: string; typed: string; expected: string };

export type FeedbackSummary = {
  headline: string;
  tone: "correct" | "wrong";
  /** Correct option keys, for a multichoice Question. */
  accepted: string[];
  /** Only present when at least one blank of a multianswer was wrong. */
  wrongBlanks?: WrongBlank[];
};

export function describeFeedback(feedback: FeedbackInput): FeedbackSummary {
  const tone = feedback.correct ? "correct" : "wrong";

  if (feedback.perBlank) {
    const total = feedback.perBlank.length;
    const correctCount = feedback.perBlank.filter((blank) => blank.correct).length;
    const wrongBlanks = feedback.perBlank
      .filter((blank) => !blank.correct)
      .map((blank) => ({ name: blank.name, typed: blank.value, expected: blank.acceptedAnswer }));

    return {
      headline: feedback.correct
        ? `Chính xác! ${correctCount}/${total} ô đúng.`
        : `Đúng ${correctCount}/${total} ô.`,
      tone,
      accepted: [],
      wrongBlanks,
    };
  }

  return {
    headline: feedback.correct ? "Chính xác!" : "Chưa đúng.",
    tone,
    accepted: feedback.correctOptionKeys ?? [],
  };
}
