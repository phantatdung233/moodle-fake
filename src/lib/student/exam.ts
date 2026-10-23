/**
 * Pure helpers for the exam-mode UI and the summary page — no React, no DB, so
 * the countdown format and the đúng/sai/bỏ trống counts are testable on their
 * own (the server remains the authority: `submitAttempt` grades and stores).
 */
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import type { AttemptView } from "@/lib/quiz/attempt-repository";

/** Milliseconds left before `deadline`; `null` when the Attempt has no time limit. */
export function remainingMs(deadline: Date | undefined, now: Date): number | null {
  if (!deadline) return null;
  return Math.max(0, deadline.getTime() - now.getTime());
}

export function isExpired(deadline: Date | undefined, now: Date): boolean {
  return deadline !== undefined && deadline.getTime() <= now.getTime();
}

/** `45:00`, `01:01`, or `1:30:00` past an hour — never negative. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export type SummaryCounts = {
  total: number;
  correct: number;
  incorrect: number;
  /** Questions with nothing answered; a partly answered multianswer counts as incorrect. */
  blank: number;
  scorePercent: number;
};

function answered(attempt: AttemptView, questionId: string): boolean {
  const answer = attempt.answers.find((entry) => entry.questionId === questionId);
  if (!answer) return false;
  return (
    answer.selectedOptionKeys.length > 0 ||
    answer.blankValues.some((value) => value.trim() !== "")
  );
}

/** Đúng / sai / bỏ trống for the summary page, from the stored `result`. */
export function summaryCounts(attempt: AttemptView): SummaryCounts {
  const perQuestion: AttemptQuestionResult[] = attempt.result?.perQuestion ?? [];
  let correct = 0;
  let incorrect = 0;
  let blank = 0;
  for (const entry of perQuestion) {
    if (entry.correct) correct += 1;
    else if (answered(attempt, entry.questionId)) incorrect += 1;
    else blank += 1;
  }
  return {
    total: perQuestion.length,
    correct,
    incorrect,
    blank,
    scorePercent: attempt.result?.total ?? 0,
  };
}
