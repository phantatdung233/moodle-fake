/**
 * Quiz data layer: the seam server actions and pages share with MongoDB.
 *
 * Functions here take and return plain domain values (no Mongoose documents) so
 * they can be called directly from tests, server actions and server components.
 */
import mongoose from "mongoose";
import { Quiz, type QuizMode, type QuizQuestion, type QuizStatus } from "./quiz.model";
import { Attempt } from "./attempt.model";
import { isValidQuizSlug, SLUG_FORMAT_ERROR } from "./slug";
import { connectToDatabase } from "@/lib/db";

/**
 * Tests connect Mongoose to mongodb-memory-server themselves, so a live
 * connection is reused as-is; only a cold process reads MONGODB_URI.
 */
async function ensureConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await connectToDatabase();
}

export type CreateDraftQuizInput = {
  title: string;
  slug: string;
  questions: QuizQuestion[];
};

export const NO_QUESTIONS_ERROR = "File không có câu hỏi nào hợp lệ nên chưa tạo được đề.";

export type CreateDraftQuizResult =
  | { ok: true; quizId: string; slug: string }
  | { ok: false; error: string };

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Persists a new draft Quiz embedding every parsed Question — including the
 * ones still marked `needs_review`: the giảng viên reviews them later, nothing
 * is dropped at upload time. Each call inserts a separate Quiz, so uploading
 * the same file twice never overwrites the first one.
 *
 * Rejects a blank title, a malformed slug, an empty question set and a slug
 * already used by another Quiz — with a Vietnamese message and nothing written.
 */
export async function createDraftQuizFromQuestions(
  input: CreateDraftQuizInput,
): Promise<CreateDraftQuizResult> {
  const title = input.title.trim();
  const slug = input.slug.trim();

  if (title === "") {
    return { ok: false, error: "Tên đề không được để trống." };
  }
  if (slug === "") {
    return { ok: false, error: "Slug không được để trống." };
  }
  if (!isValidQuizSlug(slug)) {
    return { ok: false, error: SLUG_FORMAT_ERROR };
  }
  // No Question means nothing to review or publish; a draft Quiz with zero
  // questions would only clutter `/admin`.
  if (input.questions.length === 0) {
    return { ok: false, error: NO_QUESTIONS_ERROR };
  }

  await ensureConnection();

  try {
    const quiz = await Quiz.create({
      title,
      slug,
      mode: "practice",
      status: "draft",
      version: 1,
      questions: input.questions.map((question) => {
        // `explanation` is written by the Gemini cache later; a fresh draft has none.
        const stored: QuizQuestion = { ...question };
        delete stored.explanation;
        return stored;
      }),
    });

    return { ok: true, quizId: String(quiz._id), slug: quiz.slug };
  } catch (error) {
    // The unique index on `slug` is the source of truth, so a concurrent upload
    // cannot sneak the same slug past a prior existence check.
    if (isDuplicateKeyError(error)) {
      return { ok: false, error: `Slug “${slug}” đã được dùng cho đề khác. Hãy chọn slug khác.` };
    }
    throw error;
  }
}

export type QuizListItem = {
  id: string;
  title: string;
  slug: string;
  mode: QuizMode;
  status: QuizStatus;
  questionCount: number;
  readyCount: number;
  needsReviewCount: number;
  /** Every Attempt ever started for this Quiz, finished or not. */
  attemptCount: number;
  createdAt: Date;
};

/** Every Quiz for the `/admin` list, newest first. */
export async function listQuizzes(): Promise<QuizListItem[]> {
  await ensureConnection();

  const quizzes = await Quiz.find({})
    .select("title slug mode status questions createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const attemptCounts = await countAttemptsByQuiz();

  return quizzes.map((quiz) => {
    const questions = quiz.questions ?? [];
    const needsReviewCount = questions.filter(
      (question) => question.status === "needs_review",
    ).length;
    return {
      id: String(quiz._id),
      title: quiz.title,
      slug: quiz.slug,
      mode: quiz.mode,
      status: quiz.status,
      questionCount: questions.length,
      readyCount: questions.length - needsReviewCount,
      needsReviewCount,
      attemptCount: attemptCounts.get(String(quiz._id)) ?? 0,
      createdAt: quiz.createdAt,
    };
  });
}

async function countAttemptsByQuiz(): Promise<Map<string, number>> {
  const grouped = await Attempt.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $group: { _id: "$quizId", count: { $sum: 1 } } },
  ]);
  return new Map(grouped.map((row) => [String(row._id), row.count]));
}

export type QuizDetail = QuizListItem & {
  version: number;
  publishedAt: Date | null;
  multichoiceCount: number;
  multianswerCount: number;
};

/** One Quiz for `/admin/quizzes/[id]`; `null` for a missing or malformed id. */
export async function getQuizForAdmin(quizId: string): Promise<QuizDetail | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;

  await ensureConnection();

  const quiz = await Quiz.findById(quizId)
    .select("title slug mode status questions version publishedAt createdAt")
    .lean();
  if (!quiz) return null;

  const questions = quiz.questions ?? [];
  const needsReviewCount = questions.filter(
    (question) => question.status === "needs_review",
  ).length;

  return {
    id: String(quiz._id),
    title: quiz.title,
    slug: quiz.slug,
    mode: quiz.mode,
    status: quiz.status,
    questionCount: questions.length,
    readyCount: questions.length - needsReviewCount,
    needsReviewCount,
    attemptCount: await Attempt.countDocuments({ quizId: quiz._id }),
    createdAt: quiz.createdAt,
    version: quiz.version,
    publishedAt: quiz.publishedAt ?? null,
    multichoiceCount: questions.filter((question) => question.type === "multichoice")
      .length,
    multianswerCount: questions.filter((question) => question.type === "multianswer")
      .length,
  };
}

/**
 * A Quiz the sinh viên can open at `/q/<slug>`.
 *
 * Ticket #8 adds the publish gate (`status: published` only); until then a
 * draft is open so the flow can be demoed end to end.
 */
export type TestableQuiz = {
  id: string;
  title: string;
  slug: string;
  mode: QuizMode;
  status: QuizStatus;
  questionCount: number;
};

export async function getQuizBySlug(slug: string): Promise<TestableQuiz | null> {
  await ensureConnection();

  const quiz = await Quiz.findOne({ slug })
    .select("title slug mode status questions")
    .lean();
  if (!quiz) return null;

  return {
    id: String(quiz._id),
    title: quiz.title,
    slug: quiz.slug,
    mode: quiz.mode,
    status: quiz.status,
    questionCount: (quiz.questions ?? []).filter((question) => question.enabled).length,
  };
}

/** Every Quiz the home page lists, newest first; archived ones are hidden. */
export async function listTestableQuizzes(): Promise<TestableQuiz[]> {
  await ensureConnection();

  const quizzes = await Quiz.find({ status: { $ne: "archived" } })
    .select("title slug mode status questions createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return quizzes.map((quiz) => ({
    id: String(quiz._id),
    title: quiz.title,
    slug: quiz.slug,
    mode: quiz.mode,
    status: quiz.status,
    questionCount: (quiz.questions ?? []).filter((question) => question.enabled).length,
  }));
}
