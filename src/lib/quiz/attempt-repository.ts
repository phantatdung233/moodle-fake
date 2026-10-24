/**
 * Attempt data layer — the seam the student server actions and pages share
 * with MongoDB. Everything a caller needs to decide access lives here, so the
 * cookie is only an identity hint: each function re-checks that the Attempt
 * belongs to the MSSV it was asked for.
 */
import mongoose from "mongoose";
import {
  Attempt,
  type AttemptDocument,
  type AttemptQuestionResult,
  type AttemptResult,
  type AttemptStatus,
} from "./attempt.model";
import { gradeAnswer, gradeAttempt, type BlankGrade, type AttemptAnswer } from "./grading";
import { Quiz, type QuizMode, type QuizQuestion } from "./quiz.model";
import { ensureConnection, isDuplicateKeyError } from "@/lib/mongodb";

/** MSSV identity: uppercase + trimmed, so " b2012345 " and "B2012345" are one student. */
export function normalizeStudentId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** A plain Attempt the server action / page can render; dates are ISO-safe. */
export type AttemptView = {
  id: string;
  studentId: string;
  studentName: string;
  quizId: string;
  quizSlug: string;
  quizVersion: number;
  mode: QuizMode;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt?: Date;
  deadline?: Date;
  questionsSnapshot: QuizQuestion[];
  answers: AttemptDocument["answers"];
  result?: AttemptDocument["result"];
};

function toView(doc: AttemptDocument & { _id: mongoose.Types.ObjectId }): AttemptView {
  return {
    id: String(doc._id),
    studentId: doc.studentId,
    studentName: doc.studentName,
    quizId: String(doc.quizId),
    quizSlug: doc.quizSlug,
    quizVersion: doc.quizVersion,
    mode: doc.mode,
    status: doc.status,
    startedAt: doc.startedAt,
    submittedAt: doc.submittedAt,
    deadline: doc.deadline,
    questionsSnapshot: doc.questionsSnapshot.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      blanks: question.blanks.map((blank) => ({ ...blank })),
      images: [...question.images],
    })),
    answers: doc.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionKeys: [...answer.selectedOptionKeys],
      blankValues: [...answer.blankValues],
      revealed: answer.revealed,
      ...(answer.graded ? { graded: { ...answer.graded } } : {}),
    })),
    ...(doc.result ? { result: doc.result } : {}),
  };
}

export type StartAttemptInput = {
  quizId: string;
  studentId: string;
  studentName: string;
};

export type StartAttemptResult =
  | { ok: true; attempt: AttemptView; resumed: boolean }
  | { ok: false; error: string };

/**
 * Opens the sinh viên's in-progress Attempt for this Quiz, or starts one.
 *
 * Practice mode has no attempt limit, so a finished Attempt never blocks a new
 * one; opening the Quiz again resumes an in-progress Attempt first. The partial
 * unique index on (studentId, quizId, status: in_progress) makes two tabs
 * starting at once resolve to one Attempt: the loser re-reads the winner's row.
 */
export async function resumeOrStartAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
  const studentId = normalizeStudentId(input.studentId);
  const studentName = input.studentName.trim();

  if (studentId === "") return { ok: false, error: "Vui lòng nhập MSSV." };
  if (studentName === "") return { ok: false, error: "Vui lòng nhập họ tên." };
  if (!mongoose.isValidObjectId(input.quizId)) return { ok: false, error: "Không tìm thấy đề." };

  await ensureConnection();

  const quiz = await Quiz.findById(input.quizId).lean();
  if (!quiz) return { ok: false, error: "Không tìm thấy đề." };
  // Only a published Quiz is open: a draft is still being edited and an
  // archived one is closed to new Attempts (Spec, "Publish state machine").
  if (quiz.status !== "published") return { ok: false, error: QUIZ_NOT_OPEN_ERROR };

  const existing = await Attempt.findOne({ studentId, quizId: quiz._id, status: "in_progress" });
  if (existing) {
    return { ok: true, attempt: toView(existing.toObject()), resumed: true };
  }

  // Every finished Attempt counts, expired included: a student past their
  // deadline has used that attempt up (Spec, user story 59).
  if (quiz.mode === "exam" && quiz.maxAttempts && quiz.maxAttempts > 0) {
    const used = await Attempt.countDocuments({
      studentId,
      quizId: quiz._id,
      status: { $in: ["submitted", "expired"] },
    });
    if (used >= quiz.maxAttempts) {
      return { ok: false, error: exhaustedAttemptsError(quiz.maxAttempts) };
    }
  }

  const startedAt = new Date();
  const deadline =
    quiz.mode === "exam" && quiz.timeLimit ? new Date(startedAt.getTime() + quiz.timeLimit * 60_000) : undefined;

  try {
    const created = await Attempt.create({
      studentId,
      studentName,
      quizId: quiz._id,
      quizSlug: quiz.slug,
      quizVersion: quiz.version,
      mode: quiz.mode,
      status: "in_progress",
      startedAt,
      ...(deadline ? { deadline } : {}),
      // Freeze the Questions: a later Quiz version must not change this paper.
      // A published Quiz only carries the Questions its publish let through.
      questionsSnapshot: quiz.questions.filter((question) => question.enabled),
      answers: [],
    });
    return { ok: true, attempt: toView(created.toObject()), resumed: false };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const winner = await Attempt.findOne({ studentId, quizId: quiz._id, status: "in_progress" });
      if (winner) return { ok: true, attempt: toView(winner.toObject()), resumed: true };
    }
    throw error;
  }
}

export type AnswerInput = {
  attemptId: string;
  studentId: string;
  questionId: string;
} & AttemptAnswer;

export type AnswerResult = { ok: true } | { ok: false; error: string };

export const NOT_YOUR_ATTEMPT_ERROR = "Bạn không có quyền làm bài này.";
export const QUESTION_NOT_FOUND_ERROR = "Không tìm thấy câu hỏi trong bài.";
export const REVEALED_LOCKED_ERROR = "Câu này đã khoá sau khi xem đáp án nên không sửa được nữa.";
export const SUBMITTED_LOCKED_ERROR = "Bài đã nộp nên không sửa được câu trả lời nữa.";
export const TIME_UP_ERROR = "Đã hết giờ làm bài nên không sửa được câu trả lời nữa.";
export const QUIZ_NOT_OPEN_ERROR = "Đề này chưa mở cho sinh viên làm.";

/** "Bạn đã hết 2 lần làm đề này." — user story 59. */
export function exhaustedAttemptsError(maxAttempts: number): string {
  return `Bạn đã hết ${maxAttempts} lần làm đề này.`;
}

async function loadOwnedAttempt(attemptId: string, studentId: string) {
  if (!mongoose.isValidObjectId(attemptId)) return null;
  await ensureConnection();
  return Attempt.findOne({ _id: attemptId, studentId: normalizeStudentId(studentId) });
}

/** One Attempt for its own sinh viên, or `null` for anyone else / a bad id. */
export async function getAttemptForStudent(
  attemptId: string,
  studentId: string,
): Promise<AttemptView | null> {
  const attempt = await loadOwnedAttempt(attemptId, studentId);
  return attempt ? toView(attempt.toObject()) : null;
}

/** The student's in-progress Attempt for a Quiz, if any. */
export async function getOpenAttempt(quizId: string, studentId: string): Promise<AttemptView | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;
  await ensureConnection();
  const attempt = await Attempt.findOne({
    quizId,
    studentId: normalizeStudentId(studentId),
    status: "in_progress",
  });
  return attempt ? toView(attempt.toObject()) : null;
}

function readAnswer(question: QuizQuestion, input: AnswerInput): AnswerResult | AttemptAnswer {
  const optionKeys = new Set(question.options.map((option) => option.key));
  const unknown = input.selectedOptionKeys.filter((key) => !optionKeys.has(key));
  if (unknown.length > 0) {
    return { ok: false, error: "Lựa chọn không nằm trong câu hỏi này. Hãy tải lại trang." };
  }
  // Blank values are positional: pad/trim to the Question's blank count so a
  // later reorder of Questions can never shift another blank's answer.
  const blankValues = question.blanks.map((_, index) => input.blankValues[index] ?? "");
  return {
    questionId: question.id,
    selectedOptionKeys: [...new Set(input.selectedOptionKeys)],
    blankValues,
  };
}

/**
 * Saves one Question's answer immediately (`saveAnswer` in the UI fires on
 * every choice / keystroke). A revealed Question is locked server-side.
 */
export async function answerQuestion(input: AnswerInput): Promise<AnswerResult> {
  const attempt = await loadOwnedAttempt(input.attemptId, input.studentId);
  if (!attempt) return { ok: false, error: NOT_YOUR_ATTEMPT_ERROR };

  const question = attempt.questionsSnapshot.find((candidate) => candidate.id === input.questionId);
  if (!question) return { ok: false, error: QUESTION_NOT_FOUND_ERROR };

  if (attempt.status !== "in_progress") return { ok: false, error: SUBMITTED_LOCKED_ERROR };
  if (attempt.deadline && attempt.deadline.getTime() <= Date.now()) {
    return { ok: false, error: TIME_UP_ERROR };
  }

  const current = attempt.answers.find((answer) => answer.questionId === input.questionId);
  if (current?.revealed) return { ok: false, error: REVEALED_LOCKED_ERROR };

  const answer = readAnswer(question, input);
  if ("ok" in answer) return answer;

  attempt.set("answers", [
    ...attempt.answers.filter((entry) => entry.questionId !== input.questionId),
    { ...answer, revealed: false },
  ]);
  await attempt.save();
  return { ok: true };
}

/** Everything the UI needs to show đúng/sai after a reveal. */
export type RevealFeedback = {
  questionId: string;
  revealed: true;
  correct: boolean;
  score: number;
  /** multichoice: every option the giảng viên marked correct. */
  correctOptionKeys?: string[];
  /** multianswer: per blank, what was typed and the accepted answer. */
  perBlank?: BlankGrade[];
};

export type RevealResult = { ok: true; feedback: RevealFeedback } | { ok: false; error: string };

/**
 * Practice only: grades the saved answer with `gradeAnswer`, persists the
 * result on the Attempt (`revealed: true`) and locks the Question. The grading
 * is local — the AI panel only explains the result, it never decides
 * correct/incorrect.
 */
export async function revealQuestion(input: {
  attemptId: string;
  studentId: string;
  questionId: string;
}): Promise<RevealResult> {
  const attempt = await loadOwnedAttempt(input.attemptId, input.studentId);
  if (!attempt) return { ok: false, error: NOT_YOUR_ATTEMPT_ERROR };

  const question = attempt.questionsSnapshot.find((candidate) => candidate.id === input.questionId);
  if (!question) return { ok: false, error: QUESTION_NOT_FOUND_ERROR };

  if (attempt.mode === "exam") {
    return { ok: false, error: "Chế độ kiểm tra chỉ xem đáp án sau khi nộp bài." };
  }
  if (attempt.status !== "in_progress") return { ok: false, error: SUBMITTED_LOCKED_ERROR };

  const answers = attempt.answers.map((answer) => ({
    questionId: answer.questionId,
    selectedOptionKeys: [...answer.selectedOptionKeys],
    blankValues: [...answer.blankValues],
    revealed: answer.revealed,
  }));
  const existing = answers.find((answer) => answer.questionId === input.questionId);
  if (existing?.revealed) return { ok: false, error: "Câu này đã xem đáp án rồi." };

  const saved: AttemptAnswer =
    existing ?? { questionId: input.questionId, selectedOptionKeys: [], blankValues: [] };
  const grade = gradeAnswer(question, saved);

  const record = {
    ...saved,
    revealed: true,
    graded: {
      correct: grade.correct,
      score: grade.score,
      ...(grade.perBlank ? { perBlank: grade.perBlank } : {}),
    },
  };
  attempt.set("answers", [
    ...answers.filter((answer) => answer.questionId !== input.questionId),
    record,
  ]);
  await attempt.save();

  const correctOptionKeys = question.options
    .filter((option) => option.correct)
    .map((option) => option.key);

  return {
    ok: true,
    feedback: {
      questionId: question.id,
      revealed: true,
      correct: grade.correct,
      score: grade.score,
      ...(question.type === "multichoice" ? { correctOptionKeys } : {}),
      ...(grade.perBlank ? { perBlank: grade.perBlank } : {}),
    },
  };
}

export type SubmitResult =
  | { ok: true; status: "submitted" | "expired"; result: AttemptResult }
  | { ok: false; error: string };

/**
 * Grades the Attempt once with `gradeAttempt` and stores the result, then locks
 * every answer. `gradeAttempt` walks the Attempt's own `questionsSnapshot`, so
 * an admin publishing a new version cannot change a paper mid-flight.
 *
 * Idempotent: the grading write is guarded by `status: "in_progress"`, and a
 * second submit returns the stored result instead of grading again. When the
 * Attempt was past its `deadline` it is stored as `expired`, which is how the
 * auto-submit path records itself (Spec, "Làm bài").
 */
export async function submitAttempt(input: {
  attemptId: string;
  studentId: string;
}): Promise<SubmitResult> {
  const attempt = await loadOwnedAttempt(input.attemptId, input.studentId);
  if (!attempt) return { ok: false, error: NOT_YOUR_ATTEMPT_ERROR };

  if (attempt.status !== "in_progress" && attempt.result) {
    return {
      ok: true,
      status: attempt.status === "expired" ? "expired" : "submitted",
      result: toResult(attempt.result),
    };
  }

  const submittedAt = new Date();
  const expired = attempt.deadline !== undefined && attempt.deadline.getTime() <= submittedAt.getTime();
  // Grading counts exactly the Questions in this Attempt's frozen snapshot.
  const grade = gradeAttempt(
    attempt.questionsSnapshot,
    attempt.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionKeys: [...answer.selectedOptionKeys],
      blankValues: [...answer.blankValues],
    })),
  );
  const result: AttemptResult = { total: grade.total, perQuestion: grade.perQuestion, submittedAt };

  const lockedAnswers = attempt.answers.map((answer) => ({
    questionId: answer.questionId,
    selectedOptionKeys: [...answer.selectedOptionKeys],
    blankValues: [...answer.blankValues],
    revealed: true,
    graded:
      answer.graded ??
      gradedFor(grade.perQuestion.find((entry) => entry.questionId === answer.questionId)),
  }));

  const updated = await Attempt.findOneAndUpdate(
    { _id: attempt._id, status: "in_progress" },
    {
      $set: {
        status: expired ? "expired" : "submitted",
        submittedAt,
        result,
        answers: lockedAnswers,
      },
    },
    { returnDocument: "after" },
  );

  // Lost the race with a concurrent submit: return what the winner stored.
  if (!updated) {
    const winner = await Attempt.findById(attempt._id);
    if (!winner?.result) return { ok: false, error: NOT_YOUR_ATTEMPT_ERROR };
    return {
      ok: true,
      status: winner.status === "expired" ? "expired" : "submitted",
      result: toResult(winner.result),
    };
  }

  return { ok: true, status: expired ? "expired" : "submitted", result: toResult(result) };
}

function gradedFor(entry: AttemptQuestionResult | undefined) {
  if (!entry) return undefined;
  return {
    correct: entry.correct,
    score: entry.score,
    ...(entry.perBlank ? { perBlank: entry.perBlank.map((blank) => ({ ...blank })) } : {}),
  };
}

function toResult(result: AttemptDocument["result"]): AttemptResult {
  if (!result) return { total: 0, perQuestion: [] };
  return {
    total: result.total,
    perQuestion: (result.perQuestion ?? []).map((entry) => ({
      questionId: entry.questionId,
      score: entry.score,
      correct: entry.correct,
      ...(entry.perBlank
        ? { perBlank: entry.perBlank.map((blank) => ({ ...blank })) }
        : {}),
    })),
    ...(result.submittedAt ? { submittedAt: result.submittedAt } : {}),
  };
}

/**
 * Server-side auto-submit for an exam Attempt whose `deadline` has passed.
 * Called on every load of `/q/<slug>` so a sinh viên who closes the tab and
 * comes back later still sees their paper submitted. Returns the Attempt as it
 * stands (submitted, expired, or still open) or `null` for a non-owner.
 */
export async function submitExpiredIfDue(input: {
  attemptId: string;
  studentId: string;
}): Promise<AttemptView | null> {
  const attempt = await loadOwnedAttempt(input.attemptId, input.studentId);
  if (!attempt) return null;

  if (attempt.status === "in_progress" && attempt.deadline && attempt.deadline.getTime() <= Date.now()) {
    await submitAttempt(input);
    const refreshed = await loadOwnedAttempt(input.attemptId, input.studentId);
    return refreshed ? toView(refreshed.toObject()) : null;
  }

  return toView(attempt.toObject());
}

/** What a sinh viên may see on their own summary page for one Quiz. */
export type AttemptSummary = {
  quizId: string;
  quizSlug: string;
  quizTitle: string;
  mode: QuizMode;
  /** The Attempt just finished, if any: the one this browser is looking at. */
  latest: AttemptView | null;
  /**
   * The Attempt still open in this browser, when there is one. Filled by the
   * home list so a card can offer "Làm tiếp"; the summary page does not need it.
   */
  inProgress: AttemptView | null;
  /** Finished Attempts (submitted + expired), newest first — the student's own history only. */
  history: AttemptView[];
  attemptCount: number;
  maxAttempts?: number;
  /** True when the giảng viên's limit has already been used up. */
  attemptsExhausted: boolean;
  /** True when starting an Attempt right now is allowed (published, limit left). */
  canStartNew: boolean;
};

/**
 * The sinh viên's own view of a Quiz's Attempts. Never returns another MSSV's
 * rows (Spec, user story 58): the studentId argument comes from the signed
 * cookie, not the URL.
 */
export async function getSummaryForStudent(
  quizId: string,
  studentId: string,
  attemptId?: string,
): Promise<AttemptSummary | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;
  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("title slug mode status maxAttempts").lean();
  if (!quiz) return null;

  const normalized = normalizeStudentId(studentId);
  const docs = await Attempt.find({ quizId: quiz._id, studentId: normalized })
    .sort({ startedAt: -1, _id: -1 })
    .lean();
  const attempts = docs.map((doc) => toView(doc));
  const finished = attempts.filter((attempt) => attempt.status !== "in_progress");
  const maxAttempts = quiz.maxAttempts ?? undefined;
  const attemptsExhausted =
    quiz.mode === "exam" && maxAttempts !== undefined && finished.length >= maxAttempts;

  const latest =
    (attemptId ? attempts.find((attempt) => attempt.id === attemptId) : undefined) ?? finished[0] ?? null;

  // The open Attempt, if any. `attempts` is already newest first, so the first
  // in-progress row is the one the student should continue.
  const inProgress = attempts.find((attempt) => attempt.status === "in_progress") ?? null;

  return {
    quizId: String(quiz._id),
    quizSlug: quiz.slug,
    quizTitle: quiz.title,
    mode: quiz.mode,
    latest,
    inProgress,
    history: finished,
    attemptCount: finished.length,
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    attemptsExhausted,
    canStartNew: quiz.status === "published" && !attemptsExhausted,
  };
}
