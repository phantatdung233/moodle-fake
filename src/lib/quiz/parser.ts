/**
 * Moodle export → normalized Questions.
 *
 * Pure and infrastructure-free on purpose: it takes an already `JSON.parse`d
 * value (no fs, no env, no DB) so the upload action, the review page, the seed
 * CLI and the tests all share one seam.
 */
import { createHash } from "node:crypto";
import type {
  QuestionStatus,
  QuestionType,
  QuizBlank,
  QuizOption,
  QuizQuestion,
} from "./quiz.model";

export type MoodleQuestionError = {
  questionId: string;
  reason: string;
};

export type QuizParseStats = {
  total: number;
  byType: Record<QuestionType, number>;
  /** Questions the giảng viên still has to give a correct answer to. */
  needsReview: number;
  /** Questions Moodle exported with at least one blank that has no answer. */
  emptyAnswers: number;
};

export type ParseQuizJsonResult = {
  questions: QuizQuestion[];
  stats: QuizParseStats;
  errors: MoodleQuestionError[];
};

const QUESTION_TYPES: readonly QuestionType[] = ["multichoice", "multianswer"];

/**
 * Moodle pumped wrong answers into these multianswer Questions (Q143 answers
 * `fruits[0]`, Q179 answers `d` while its content asks for `fruits[1]`). Per the
 * spec we never invent an answer, so they always go back to the giảng viên.
 */
export const KNOWN_BAD_ANSWER_QUESTION_IDS: readonly string[] = ["Q143", "Q179"];

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Input: the parsed Moodle export (an array of Questions).
 * Output: every Question normalized, plus counters and per-Question errors.
 * A single malformed Question becomes an `errors` entry, not a thrown error;
 * a top-level value that is not an array is rejected loudly.
 */
export function parseQuizJson(rawJson: unknown): ParseQuizJsonResult {
  if (!Array.isArray(rawJson)) {
    throw new TypeError(
      "File JSON phải là một mảng câu hỏi ở cấp cao nhất, không phải object",
    );
  }

  const questions: QuizQuestion[] = [];
  const errors: MoodleQuestionError[] = [];

  rawJson.forEach((entry, index) => {
    const no = index + 1;
    const id = isRecord(entry) && typeof entry.id === "string" ? entry.id : `#${no}`;
    const type = isRecord(entry) ? entry.type : undefined;

    if (!isRecord(entry)) {
      errors.push({ questionId: id, reason: `Câu thứ ${no}: không phải object` });
      return;
    }
    if (!QUESTION_TYPES.includes(type as QuestionType)) {
      errors.push({
        questionId: id,
        reason: `Loại câu "${String(type)}" không được hỗ trợ (chỉ nhận multichoice và multianswer)`,
      });
      return;
    }

    questions.push(normalizeQuestion(entry, id, no, type as QuestionType, errors));
  });

  return { questions, stats: countStats(questions), errors };
}

function normalizeQuestion(
  entry: RawRecord,
  id: string,
  no: number,
  type: QuestionType,
  errors: MoodleQuestionError[],
): QuizQuestion {
  const content = typeof entry.question === "string" ? entry.question : "";
  const images = Array.isArray(entry.images)
    ? entry.images.filter((url): url is string => typeof url === "string" && url !== "")
    : [];

  const options: QuizOption[] = Array.isArray(entry.options)
    ? entry.options.filter(isRecord).map((option) => ({
        key: String(option.key ?? ""),
        text: typeof option.text === "string" ? option.text : "",
        correct: option.selected === true,
      }))
    : [];

  const blanks: QuizBlank[] = Array.isArray(entry.blanks)
    ? entry.blanks.filter(isRecord).map((blank) => ({
        name: String(blank.name ?? ""),
        acceptedAnswer: typeof blank.value === "string" ? blank.value : "",
      }))
    : [];

  if (type === "multichoice" && options.length === 0) {
    errors.push({ questionId: id, reason: "Câu multichoice không có lựa chọn nào" });
  }
  if (type === "multichoice" && !options.some((option) => option.correct)) {
    errors.push({
      questionId: id,
      reason: "Câu multichoice không có đáp án đúng nào được chọn (selected)",
    });
  }
  if (type === "multianswer" && blanks.length === 0) {
    errors.push({ questionId: id, reason: "Câu multianswer không có ô trống nào" });
  }

  const status = initialStatus(id, type, options, blanks);
  const question: QuizQuestion = {
    id,
    no: typeof entry.no === "number" ? entry.no : no,
    type,
    content,
    options,
    blanks,
    images,
    enabled: true,
    status,
    hash: hashQuestion(content, options, blanks),
  };
  return question;
}

function initialStatus(
  id: string,
  type: QuestionType,
  options: QuizOption[],
  blanks: QuizBlank[],
): QuestionStatus {
  const isReady =
    type === "multichoice"
      ? options.some((option) => option.correct)
      : blanks.length > 0 && blanks.every((blank) => blank.acceptedAnswer.trim() !== "");

  if (isReady && !KNOWN_BAD_ANSWER_QUESTION_IDS.includes(id)) {
    return "ready";
  }
  return "needs_review";
}

/** Stable hash of content + answers; the giảng viên sửa đáp án → hash đổi → giải thích mới. */
function hashQuestion(
  content: string,
  options: QuizOption[],
  blanks: QuizBlank[],
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

function countStats(questions: QuizQuestion[]): QuizParseStats {
  const byType: Record<QuestionType, number> = { multichoice: 0, multianswer: 0 };
  let emptyAnswers = 0;
  for (const question of questions) {
    byType[question.type] += 1;
    if (question.blanks.some((blank) => blank.acceptedAnswer.trim() === "")) {
      emptyAnswers += 1;
    }
  }
  return {
    total: questions.length,
    byType,
    needsReview: questions.filter((question) => question.status === "needs_review").length,
    emptyAnswers,
  };
}
