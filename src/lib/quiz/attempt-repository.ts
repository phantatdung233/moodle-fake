/**
 * Attempt data layer — the seam the student server actions and pages share
 * with MongoDB. Everything a caller needs to decide access lives here, so the
 * cookie is only an identity hint: each function re-checks that the Attempt
 * belongs to the MSSV it was asked for.
 */
import mongoose from "mongoose";
import { Attempt, type AttemptDocument, type AttemptStatus } from "./attempt.model";
import { gradeAnswer, type BlankGrade, type AttemptAnswer } from "./grading";
import { Quiz, type QuizMode, type QuizQuestion } from "./quiz.model";
import { connectToDatabase } from "@/lib/db";

async function ensureConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await connectToDatabase();
}

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

  const existing = await Attempt.findOne({ studentId, quizId: quiz._id, status: "in_progress" });
  if (existing) {
    return { ok: true, attempt: toView(existing.toObject()), resumed: true };
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
      questionsSnapshot: quiz.questions,
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
 * is local; the Gemini explanation panel (ticket #9) hangs off this result.
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

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}
