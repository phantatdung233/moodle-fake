/**
 * Pure helpers shared by the quiz-taking UI. Answers keep exactly the
 * `AttemptAnswer` shape from grading.ts; these only compute what the panel and
 * the inputs show, so their behaviour is testable without rendering React.
 */
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import type { BlankGrade } from "@/lib/quiz/grading";

/** Picks or unpicks one option, keeping the order options were chosen in. */
export function toggleOptionKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}

/** What the sinh viên typed on one Question; what `saveAnswer` receives. */
export type Draft = { selectedOptionKeys: string[]; blankValues: string[] };

export function emptyDraft(): Draft {
  return { selectedOptionKeys: [], blankValues: [] };
}

/** The saved answer to seed the inputs with, or an empty draft. */
export function draftFromAttempt(questionId: string, attempt: AttemptView): Draft {
  const answer = attempt.answers.find((entry) => entry.questionId === questionId);
  return answer
    ? { selectedOptionKeys: [...answer.selectedOptionKeys], blankValues: [...answer.blankValues] }
    : emptyDraft();
}

export type QuestionStatus = "revealed" | "answered" | "unanswered";

/** Drives the jump panel's colours: locked beats answered, empty counts as unanswered. */
export function questionStatus(questionId: string, attempt: AttemptView): QuestionStatus {
  const answer = attempt.answers.find((entry) => entry.questionId === questionId);
  if (!answer) return "unanswered";
  if (answer.revealed) return "revealed";
  const hasAnswer =
    answer.selectedOptionKeys.length > 0 || answer.blankValues.some((value) => value.trim() !== "");
  return hasAnswer ? "answered" : "unanswered";
}

export function isRevealed(attempt: AttemptView, questionId: string): boolean {
  return attempt.answers.find((answer) => answer.questionId === questionId)?.revealed === true;
}

export function gradesOf(attempt: AttemptView, questionId: string) {
  const graded = attempt.answers.find((answer) => answer.questionId === questionId)?.graded;
  if (!graded) return null;
  return graded;
}

/**
 * The marker name is the number inside `[[n]]`, i.e. the trailing number of the
 * blank's name (`Q031_blank2` → 2), so a Question's blanks map to its markers
 * regardless of their order in the document.
 */
export function blankNumber(name: string, index: number): string {
  const match = /(\d+)\s*$/.exec(name);
  return match ? match[1] : String(index + 1);
}

/** Marker number → position in `question.blanks`, which is what `blankValues` indexes. */
export function blankIndexByName(blanks: readonly { name: string }[]): Map<string, number> {
  return new Map(blanks.map((blank, index) => [blankNumber(blank.name, index), index]));
}

/**
 * Optimistic local view of a saved answer. A revealed Question cannot be
 * answered again, so `graded` is only ever kept from the existing record.
 */
export function withAnswer(attempt: AttemptView, questionId: string, draft: Draft): AttemptView {
  const existing = attempt.answers.find((answer) => answer.questionId === questionId);
  return {
    ...attempt,
    answers: [
      ...attempt.answers.filter((answer) => answer.questionId !== questionId),
      {
        questionId,
        selectedOptionKeys: [...draft.selectedOptionKeys],
        blankValues: [...draft.blankValues],
        revealed: existing?.revealed ?? false,
        ...(existing?.graded ? { graded: existing.graded } : {}),
      },
    ],
  };
}

/** After a reveal: the answer as saved, plus the lock. */
export function markRevealed(
  attempt: AttemptView,
  questionId: string,
  draft: Draft,
): AttemptView {
  const answered = withAnswer(attempt, questionId, draft);
  return {
    ...answered,
    answers: answered.answers.map((answer) =>
      answer.questionId === questionId ? { ...answer, revealed: true } : answer,
    ),
  };
}

/** How the feedback panel colours each blank: correct, wrong, or not graded yet. */
export function blankTone(
  grade: BlankGrade | undefined,
): "correct" | "wrong" | undefined {
  if (!grade) return undefined;
  return grade.correct ? "correct" : "wrong";
}
