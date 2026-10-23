/**
 * Chấm điểm — module thuần, không DB/HTTP/UI.
 *
 * Dùng chung cho phản hồi tức thì ở chế độ luyện tập và điểm cuối cùng khi nộp
 * bài (Spec, "Chấm điểm"): `gradeAnswer` chấm một Question, `gradeAttempt` chấm
 * cả lượt làm thành %.
 */
import type { QuizQuestion } from "./quiz.model";

/** One blank inside a multianswer Question, so the UI can highlight the wrong ones. */
export type BlankGrade = {
  name: string;
  correct: boolean;
};

export type AnswerGrade = {
  correct: boolean;
  /** 1/0 for a multichoice Question, correctBlanks / totalBlanks for a multianswer. */
  score: number;
  /** Every blank of a multianswer Question, right or wrong; absent for multichoice. */
  perBlank?: BlankGrade[];
};

function correctOptionKeys(question: QuizQuestion): Set<string> {
  return new Set(
    question.options.filter((option) => option.correct).map((option) => option.key),
  );
}

/** Tập key được chọn phải trùng khít tập key đúng; thứ tự và trùng lặp không tính. */
function gradeMultichoice(question: QuizQuestion, selectedOptionKeys: readonly string[]): AnswerGrade {
  const picked = new Set(selectedOptionKeys);
  const correct = correctOptionKeys(question);
  const exact =
    picked.size === correct.size && [...picked].every((key) => correct.has(key));
  return { correct: exact, score: exact ? 1 : 0 };
}

function gradeMultianswer(question: QuizQuestion, blankValues: readonly string[]): AnswerGrade {
  const total = question.blanks.length;
  const perBlank: BlankGrade[] = question.blanks.map((blank, index) => ({
    name: blank.name,
    correct: normalizeBlank(blankValues[index] ?? "") === normalizeBlank(blank.acceptedAnswer),
  }));
  const correctCount = perBlank.filter((blank) => blank.correct).length;
  const score = total === 0 ? 0 : roundTo(correctCount / total, 2);
  return { correct: total > 0 && correctCount === total, score, perBlank };
}

export function gradeAnswer(question: QuizQuestion, answer: unknown): AnswerGrade {
  const picked = readAnswer(answer);
  if (question.type === "multianswer") {
    return gradeMultianswer(question, picked.blankValues);
  }
  return gradeMultichoice(question, picked.selectedOptionKeys);
}

/** Trim, gộp mọi khoảng trắng liên tiếp thành 1, lowercase. Không bỏ dấu tiếng Việt. */
export function normalizeBlank(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

type GradedAnswer = {
  selectedOptionKeys: readonly string[];
  blankValues: readonly string[];
};

/** A missing or malformed answer is the same as an empty one: it scores 0, never throws. */
function readAnswer(answer: unknown): GradedAnswer {
  if (typeof answer !== "object" || answer === null) {
    return { selectedOptionKeys: [], blankValues: [] };
  }
  const { selectedOptionKeys, blankValues } = answer as Record<string, unknown>;
  return {
    selectedOptionKeys: Array.isArray(selectedOptionKeys)
      ? selectedOptionKeys.filter((key): key is string => typeof key === "string")
      : [],
    blankValues: Array.isArray(blankValues)
      ? blankValues.map((value) => (typeof value === "string" ? value : ""))
      : [],
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
