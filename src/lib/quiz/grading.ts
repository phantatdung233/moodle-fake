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
  /** The giảng viên's accepted answer, so the UI can show what was expected. */
  acceptedAnswer: string;
  /** What the sinh viên typed, verbatim (empty when left blank). */
  value: string;
  correct: boolean;
};

/** The shape Attempt.answers stores for one Question; later tickets must reuse it. */
export type AttemptAnswer = {
  questionId: string;
  selectedOptionKeys: string[];
  /** By position, aligned with Question.blanks (blankValues[0] answers blanks[0]). */
  blankValues: string[];
};

export type AnswerGrade = {
  correct: boolean;
  /** 1/0 for a multichoice Question, correctBlanks / totalBlanks for a multianswer. */
  score: number;
  /** Every blank of a multianswer Question, right or wrong; absent for multichoice. */
  perBlank?: BlankGrade[];
};

export type QuestionGrade = {
  questionId: string;
  score: number;
  correct: boolean;
  perBlank?: BlankGrade[];
};

export type AttemptGrade = {
  /** sum(score) / questionCount × 100, one decimal place. */
  total: number;
  perQuestion: QuestionGrade[];
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
  const perBlank: BlankGrade[] = question.blanks.map((blank, index) => {
    const value = blankValues[index] ?? "";
    return {
      name: blank.name,
      acceptedAnswer: blank.acceptedAnswer,
      value,
      correct: normalizeBlank(value) === normalizeBlank(blank.acceptedAnswer),
    };
  });
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

/**
 * Grades a whole paper from its Questions alone. An Attempt passes its frozen
 * `questionsSnapshot` here, so grading never reads the live Quiz (which may
 * have been republished since the sinh viên started).
 */
export function gradeAttempt(
  paper: readonly QuizQuestion[],
  answers: readonly AttemptAnswer[],
): AttemptGrade {
  const answersByQuestion = new Map(
    (Array.isArray(answers) ? answers : []).map((answer) => [answer.questionId, answer]),
  );

  // Every enabled Question counts, answered or not: leaving a Question blank
  // costs its points but still shows up as 0 in the results.
  const questions = paper.filter((question) => question.enabled);
  const perQuestion: QuestionGrade[] = questions.map((question) => {
    const { score, correct, perBlank } = gradeAnswer(question, answersByQuestion.get(question.id));
    return perBlank
      ? { questionId: question.id, score, correct, perBlank }
      : { questionId: question.id, score, correct };
  });

  const questionCount = perQuestion.length;
  const sum = perQuestion.reduce((total, question) => total + question.score, 0);
  const total = questionCount === 0 ? 0 : roundTo((sum / questionCount) * 100, 1);

  return { total, perQuestion };
}

/**
 * Trim, gộp mọi khoảng trắng liên tiếp thành 1, lowercase. Không bỏ dấu tiếng Việt
 * (đáp án đa số là code Python, nên "Đúng" và "dung" là hai đáp án khác nhau).
 */
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
