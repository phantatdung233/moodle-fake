/**
 * Data layer for the answer-review page (`/admin/quizzes/[id]/review`).
 *
 * Same seam as `repository.ts`: plain values in and out (no Mongoose
 * documents), so tests, server actions and server components share it. Every
 * write here refuses a Quiz that is not a draft — publishing freezes answers
 * (Spec, "Publish state machine").
 */
import mongoose from "mongoose";
import { Quiz, type QuizDocument, type QuizQuestion } from "./quiz.model";
import { withRecomputedHash } from "./question-hash";
import { connectToDatabase } from "@/lib/db";

/**
 * Tests connect Mongoose to mongodb-memory-server themselves, so a live
 * connection is reused as-is; only a cold process reads MONGODB_URI.
 */
async function ensureConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await connectToDatabase();
}

/**
 * The next Question the giảng viên still has to answer, in Moodle order
 * (`no`): the first enabled `needs_review` Question that is not `afterId`.
 * `null` when the queue is empty, so the page can show "đã duyệt xong".
 */
export async function findNextQuestionToReview(
  quizId: string,
  afterId?: string,
): Promise<string | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("questions.id questions.no questions.enabled questions.status").lean();
  if (!quiz) return null;

  const queue = (quiz.questions ?? [])
    .filter((question) => question.enabled && question.status === "needs_review")
    .sort((a, b) => a.no - b.no);

  const next = queue.find((question) => question.id !== afterId) ?? null;
  return next?.id ?? null;
}

export type AnswerReviewQuiz = {
  id: string;
  title: string;
  slug: string;
  status: QuizDocument["status"];
  /** Every enabled Question — the N of "X/N câu đã có đáp án". */
  totalCount: number;
  /** Enabled Questions that are `ready` (the X). */
  answeredCount: number;
  /** Enabled `needs_review` Question ids, in Moodle order. */
  reviewQueue: string[];
  /** Enabled `ready` question ids, in Moodle order, for the "Xem lại đáp án" list. */
  readyQuestionIds: string[];
};

/** Header counters for the review page; `null` for a missing or malformed id. */
export async function getQuizForReview(quizId: string): Promise<AnswerReviewQuiz | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;

  await ensureConnection();

  const quiz = await Quiz.findById(quizId)
    .select("title slug status questions.id questions.no questions.enabled questions.status")
    .lean();
  if (!quiz) return null;

  const enabled = (quiz.questions ?? [])
    .filter((question) => question.enabled)
    .sort((a, b) => a.no - b.no);

  return {
    id: String(quiz._id),
    title: quiz.title,
    slug: quiz.slug,
    status: quiz.status,
    totalCount: enabled.length,
    answeredCount: enabled.filter((question) => question.status === "ready").length,
    reviewQueue: enabled
      .filter((question) => question.status === "needs_review")
      .map((question) => question.id),
    readyQuestionIds: enabled
      .filter((question) => question.status === "ready")
      .map((question) => question.id),
  };
}

/**
 * One enabled Question as the review page renders it: plain values only, so
 * the client component can receive it as props. A Question the giảng viên
 * removed (`enabled: false`) is not reviewable anymore → `null`.
 */
export async function getQuestionForReview(
  quizId: string,
  questionId: string,
): Promise<QuizQuestion | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("questions").lean();
  const question = (quiz?.questions ?? []).find((item) => item.id === questionId);
  return question?.enabled ? toPlainQuestion(question) : null;
}

/** Strips Mongoose subdocument methods and `_id`s so the value is serialisable to a client. */
function toPlainQuestion(question: QuizQuestion): QuizQuestion {
  const plain: QuizQuestion = {
    id: question.id,
    no: question.no,
    type: question.type,
    content: question.content,
    options: question.options.map((option) => ({
      key: option.key,
      text: option.text,
      correct: option.correct,
    })),
    blanks: question.blanks.map((blank) => ({
      name: blank.name,
      acceptedAnswer: blank.acceptedAnswer,
    })),
    images: [...question.images],
    enabled: question.enabled,
    status: question.status,
    hash: question.hash,
  };
  if (question.explanation !== undefined) plain.explanation = question.explanation;
  return plain;
}

export type ReviewAnswerInput =  | { selectedOptionKeys: string[] }
  | { blankAnswers: string[] };

export const NOT_DRAFT_ERROR =
  "Đề đã publish nên không sửa được đáp án. Hãy huỷ publish nếu cần sửa.";
export const QUESTION_NOT_FOUND_ERROR = "Không tìm thấy câu hỏi này trong đề.";
export const NO_CORRECT_OPTION_ERROR = "Hãy chọn ít nhất một đáp án đúng.";
export const BLANK_REQUIRED_ERROR = "Hãy điền đáp án cho tất cả các ô trống.";
export const UNKNOWN_OPTION_ERROR = "Đáp án chọn không nằm trong các lựa chọn của câu hỏi.";
export const BLANK_COUNT_MISMATCH_ERROR = "Số ô trống không khớp với câu hỏi.";

export type SaveQuestionAnswerResult =
  | { ok: true; nextQuestionId: string | null }
  | { ok: false; error: string };

/**
 * Records the giảng viên's answer for one Question, marks it `ready`,
 * recomputes its hash (the cached Gemini explanation is now stale) and returns
 * the next Question to review so the page can advance.
 *
 * Rejects a Quiz that is not a draft, an unknown Question, an empty selection
 * and an empty blank — with a Vietnamese message and nothing written. A
 * `ready` Question can be saved again while the Quiz is still a draft.
 */
export async function saveQuestionAnswer(
  quizId: string,
  questionId: string,
  answer: ReviewAnswerInput,
): Promise<SaveQuestionAnswerResult> {
  if (!mongoose.isValidObjectId(quizId)) {
    return { ok: false, error: "Không tìm thấy đề." };
  }

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("status questions").lean();
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };
  if (quiz.status !== "draft") return { ok: false, error: NOT_DRAFT_ERROR };

  const question = (quiz.questions ?? []).find((item) => item.id === questionId);
  if (!question) return { ok: false, error: QUESTION_NOT_FOUND_ERROR };

  const updated = applyAnswer(question, answer);
  if ("error" in updated) return { ok: false, error: updated.error };

  // Written as a positional update rather than re-saving the whole document:
  // two giảng viên (or two tabs) editing different Questions cannot clobber
  // each other's answers.
  await Quiz.updateOne(
    { _id: quizId },
    {
      $set: {
        "questions.$[question].options": updated.question.options,
        "questions.$[question].blanks": updated.question.blanks,
        "questions.$[question].status": "ready",
        "questions.$[question].hash": withRecomputedHash(updated.question).hash,
      },
    },
    { arrayFilters: [{ "question.id": questionId }] },
  );

  return { ok: true, nextQuestionId: await findNextQuestionToReview(quizId, questionId) };
}

export type RemoveQuestionResult =
  | { ok: true; nextQuestionId: string | null }
  | { ok: false; error: string };

/**
 * Takes a Question out of the Quiz the soft way: `enabled: false`, the row
 * (content, answers, hash) stays so Attempts and history keep pointing at it.
 * It leaves the review queue and the "X/N" denominator, so 180 Questions become
 * a 179-Question Quiz. Rejects a Quiz that is not a draft.
 */
export async function removeQuestionFromQuiz(
  quizId: string,
  questionId: string,
): Promise<RemoveQuestionResult> {
  if (!mongoose.isValidObjectId(quizId)) {
    return { ok: false, error: "Không tìm thấy đề." };
  }

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("status questions.id").lean();
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };
  if (quiz.status !== "draft") return { ok: false, error: NOT_DRAFT_ERROR };
  if (!(quiz.questions ?? []).some((question) => question.id === questionId)) {
    return { ok: false, error: QUESTION_NOT_FOUND_ERROR };
  }

  await Quiz.updateOne(
    { _id: quizId },
    { $set: { "questions.$[question].enabled": false } },
    { arrayFilters: [{ "question.id": questionId }] },
  );

  return { ok: true, nextQuestionId: await findNextQuestionToReview(quizId, questionId) };
}

function applyAnswer(  question: QuizQuestion,
  answer: ReviewAnswerInput,
): { question: QuizQuestion } | { error: string } {
  if (question.type === "multichoice") {
    if (!("selectedOptionKeys" in answer)) {
      return { error: UNKNOWN_OPTION_ERROR };
    }
    const picked = new Set(answer.selectedOptionKeys);
    const options = question.options.filter((option) => picked.has(option.key));
    if (picked.size !== options.length || picked.size === 0) {
      return { error: picked.size === 0 ? NO_CORRECT_OPTION_ERROR : UNKNOWN_OPTION_ERROR };
    }
    return {
      question: {
        ...question,
        options: question.options.map((option) => ({
          ...option,
          correct: picked.has(option.key),
        })),
      },
    };
  }

  if (!("blankAnswers" in answer)) {
    return { error: BLANK_COUNT_MISMATCH_ERROR };
  }
  if (answer.blankAnswers.length !== question.blanks.length) {
    return { error: BLANK_COUNT_MISMATCH_ERROR };
  }
  if (answer.blankAnswers.some((value) => value.trim() === "")) {
    return { error: BLANK_REQUIRED_ERROR };
  }
  return {
    question: {
      ...question,
      blanks: question.blanks.map((blank, index) => ({
        ...blank,
        acceptedAnswer: answer.blankAnswers[index].trim(),
      })),
    },
  };
}
