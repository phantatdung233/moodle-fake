import mongoose from "mongoose";
import type { AttemptAnswer, BlankGrade } from "./grading";
import type { QuizMode, QuizQuestion } from "./quiz.model";
import { questionSchema } from "./quiz.model";

export type AttemptStatus = "in_progress" | "submitted" | "expired";

/** One Question's answer, plus whether the sinh viên has seen its result. */
export type AttemptAnswerRecord = AttemptAnswer & {
  /** True once the Question is locked: practice revealed it, or the Attempt was submitted. */
  revealed: boolean;
  /** Filled in when the Question was revealed/submitted; absent while still open. */
  graded?: {
    correct: boolean;
    score: number;
    /** Per-blank detail for a multianswer Question, so the UI can mark wrong blanks. */
    perBlank?: BlankGrade[];
  };
};

export type AttemptQuestionResult = {
  questionId: string;
  score: number;
  correct: boolean;
  perBlank?: BlankGrade[];
};

/** Filled in by `submitAttempt` (ticket #8); nil while the Attempt is in progress. */
export type AttemptResult = {
  /** sum(score) / questionCount × 100, one decimal place. */
  total: number;
  perQuestion: AttemptQuestionResult[];
  submittedAt?: Date;
};

/**
 * A sinh viên's run through one Quiz version (Spec, Domain model).
 *
 * `questionsSnapshot` freezes the Questions as they were when the Attempt
 * started: publishing a new Quiz version never changes someone's in-flight
 * paper (user story 32).
 */
export type AttemptDocument = {
  /** MSSV, normalised uppercase + trimmed. */
  studentId: string;
  studentName: string;
  quizId: mongoose.Types.ObjectId;
  /** Quiz.slug at start time, so the callback link is stable. */
  quizSlug: string;
  quizVersion: number;
  mode: QuizMode;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt?: Date;
  /** Exam mode only: startedAt + Quiz.timeLimit. */
  deadline?: Date;
  questionsSnapshot: QuizQuestion[];
  answers: AttemptAnswerRecord[];
  result?: AttemptResult;
  createdAt: Date;
  updatedAt: Date;
};

const blankGradeSchema = new mongoose.Schema<BlankGrade>(
  {
    name: { type: String, required: true },
    acceptedAnswer: { type: String, default: "" },
    value: { type: String, default: "" },
    correct: { type: Boolean, default: false },
  },
  { _id: false },
);

const answerSchema = new mongoose.Schema<AttemptAnswerRecord>(
  {
    questionId: { type: String, required: true },
    selectedOptionKeys: { type: [String], default: [] },
    blankValues: { type: [String], default: [] },
    revealed: { type: Boolean, default: false },
    graded: {
      type: new mongoose.Schema(
        {
          correct: { type: Boolean, required: true },
          score: { type: Number, required: true },
          perBlank: { type: [blankGradeSchema], default: undefined },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

const questionResultSchema = new mongoose.Schema<AttemptQuestionResult>(
  {
    questionId: { type: String, required: true },
    score: { type: Number, required: true },
    correct: { type: Boolean, required: true },
    perBlank: { type: [blankGradeSchema], default: undefined },
  },
  { _id: false },
);

const resultSchema = new mongoose.Schema<AttemptResult>(
  {
    total: { type: Number, required: true },
    perQuestion: { type: [questionResultSchema], default: [] },
    submittedAt: { type: Date },
  },
  { _id: false },
);

const attemptSchema = new mongoose.Schema<AttemptDocument>(
  {
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
    quizSlug: { type: String, required: true },
    quizVersion: { type: Number, required: true },
    mode: { type: String, enum: ["practice", "exam"], required: true },
    status: {
      type: String,
      enum: ["in_progress", "submitted", "expired"],
      default: "in_progress",
      required: true,
    },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date },
    deadline: { type: Date },
    questionsSnapshot: { type: [questionSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    result: { type: resultSchema, default: undefined },
  },
  { timestamps: true },
);

/**
 * The same MSSV opening the same Quiz again must resume, never fork, an
 * in-progress Attempt. A partial unique index lets a sinh viên keep any number
 * of finished Attempts (practice is unlimited) while at most one is open.
 * `createAttempt` also handles the race when two tabs start at once.
 */
attemptSchema.index(
  { studentId: 1, quizId: 1 },
  { unique: true, partialFilterExpression: { status: "in_progress" } },
);

export const Attempt: mongoose.Model<AttemptDocument> =
  (mongoose.models.Attempt as mongoose.Model<AttemptDocument>) ??
  mongoose.model<AttemptDocument>("Attempt", attemptSchema);
