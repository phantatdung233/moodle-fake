import mongoose from "mongoose";

export type QuizMode = "practice" | "exam";
export type QuizStatus = "draft" | "published" | "archived";

export type QuestionStatus = "needs_review" | "ready";
export type QuestionType = "multichoice" | "multianswer";

export type QuizOption = {
  key: string;
  text: string;
  correct: boolean;
};

export type QuizBlank = {
  name: string;
  acceptedAnswer: string;
};

/** A Question is embedded in its Quiz (Spec, Domain model). */
export type QuizQuestion = {
  id: string;
  no: number;
  type: QuestionType;
  content: string;
  options: QuizOption[];
  blanks: QuizBlank[];
  images: string[];
  enabled: boolean;
  status: QuestionStatus;
  hash: string;
  explanation?: string;
};

export type QuizDocument = {
  title: string;
  slug: string;
  mode: QuizMode;
  timeLimit?: number;
  maxAttempts?: number;
  status: QuizStatus;
  questions: QuizQuestion[];
  version: number;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const optionSchema = new mongoose.Schema<QuizOption>(
  {
    key: { type: String, required: true },
    text: { type: String, required: true },
    correct: { type: Boolean, default: false },
  },
  { _id: false },
);

const blankSchema = new mongoose.Schema<QuizBlank>(
  {
    name: { type: String, required: true },
    acceptedAnswer: { type: String, default: "" },
  },
  { _id: false },
);

const questionSchema = new mongoose.Schema<QuizQuestion>(
  {
    id: { type: String, required: true },
    no: { type: Number, required: true },
    type: { type: String, enum: ["multichoice", "multianswer"], required: true },
    content: { type: String, default: "" },
    options: { type: [optionSchema], default: [] },
    blanks: { type: [blankSchema], default: [] },
    images: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ["needs_review", "ready"], default: "needs_review" },
    hash: { type: String, default: "" },
    explanation: { type: String },
  },
  { _id: false },
);

const quizSchema = new mongoose.Schema<QuizDocument>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    mode: { type: String, enum: ["practice", "exam"], required: true },
    timeLimit: { type: Number },
    maxAttempts: { type: Number },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      required: true,
    },
    questions: { type: [questionSchema], default: [] },
    version: { type: Number, default: 1 },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

export const Quiz: mongoose.Model<QuizDocument> =
  (mongoose.models.Quiz as mongoose.Model<QuizDocument>) ??
  mongoose.model<QuizDocument>("Quiz", quizSchema);
