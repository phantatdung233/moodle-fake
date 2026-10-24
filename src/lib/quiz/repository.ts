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
import { ensureConnection, isDuplicateKeyError } from "@/lib/mongodb";

export type CreateDraftQuizInput = {
  title: string;
  slug: string;
  questions: QuizQuestion[];
};

export const NO_QUESTIONS_ERROR = "File không có câu hỏi nào hợp lệ nên chưa tạo được đề.";

export type CreateDraftQuizResult =
  | { ok: true; quizId: string; slug: string }
  | { ok: false; error: string };

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

  // Mongoose builds a Model's indexes lazily, and an insert that overtakes that
  // build succeeds unchecked (the slug guard below is then bypassed). Awaiting
  // `init()` guarantees the unique slug index exists before the first insert —
  // cheap afterwards, since the promise is cached per Model.
  await Quiz.init();

  try {
    const quiz = await Quiz.create({
      title,
      slug,
      mode: "practice",
      status: "draft",
      version: 1,
      questions: input.questions.map((question) => {
        // `explanation` is never written by the app; a fresh draft has none.
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

/** One row of the draft editor's "chọn câu" list. */
export type AdminQuestionRow = {
  id: string;
  no: number;
  type: QuizQuestion["type"];
  /** First line of the Question, so the list is scannable without the full body. */
  preview: string;
  enabled: boolean;
  status: QuizQuestion["status"];
};

export type QuizDetail = QuizListItem & {
  version: number;
  publishedAt: Date | null;
  timeLimit: number | null;
  maxAttempts: number | null;
  multichoiceCount: number;
  multianswerCount: number;
  /** Questions that will go out if the giảng viên publishes now. */
  publishableCount: number;
  /** Enabled but still `needs_review`: dropped by publish unless answered first. */
  enabledNeedsReviewCount: number;
  questions: AdminQuestionRow[];
};

/** One Quiz for `/admin/quizzes/[id]`; `null` for a missing or malformed id. */
export async function getQuizForAdmin(quizId: string): Promise<QuizDetail | null> {
  if (!mongoose.isValidObjectId(quizId)) return null;

  await ensureConnection();

  const quiz = await Quiz.findById(quizId)
    .select("title slug mode status timeLimit maxAttempts questions version publishedAt createdAt")
    .lean();
  if (!quiz) return null;

  const questions = [...(quiz.questions ?? [])].sort((a, b) => a.no - b.no);
  const needsReviewCount = questions.filter(
    (question) => question.status === "needs_review",
  ).length;
  const publishableCount = questions.filter(
    (question) => question.enabled && question.status === "ready",
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
    timeLimit: quiz.timeLimit ?? null,
    maxAttempts: quiz.maxAttempts ?? null,
    publishableCount,
    enabledNeedsReviewCount: questions.filter(
      (question) => question.enabled && question.status === "needs_review",
    ).length,
    questions: questions.map((question) => ({
      id: question.id,
      no: question.no,
      type: question.type,
      preview: questionPreview(question.content),
      enabled: question.enabled,
      status: question.status,
    })),
  };
}

/** One line of a Question body for the selection list (blanks and markdown stripped). */
function questionPreview(content: string): string {
  const line = content
    .replace(/\[\[\d+\]\]/g, "____")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return (line ?? "").slice(0, 140);
}

/**
 * A Quiz the sinh viên can open at `/q/<slug>`. Only a `published` Quiz is ever
 * returned: a draft is still being edited and an archived Quiz is closed to new
 * Attempts, so both look "not found" to a student (Spec, user story 33).
 */
export type TestableQuiz = {
  id: string;
  title: string;
  slug: string;
  mode: QuizMode;
  status: QuizStatus;
  questionCount: number;
  timeLimit?: number;
  maxAttempts?: number;
  version: number;
};

function toTestableQuiz(quiz: {
  _id: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  mode: QuizMode;
  status: QuizStatus;
  timeLimit?: number | null;
  maxAttempts?: number | null;
  version?: number;
  questions?: { enabled: boolean }[];
}): TestableQuiz {
  const questions = quiz.questions ?? [];
  const enabled = questions.filter((question) => question.enabled).length;
  return {
    id: String(quiz._id),
    title: quiz.title,
    slug: quiz.slug,
    mode: quiz.mode,
    status: quiz.status,
    questionCount: enabled,
    version: quiz.version ?? 1,
    ...(quiz.mode === "exam" && quiz.timeLimit != null ? { timeLimit: quiz.timeLimit } : {}),
    ...(quiz.mode === "exam" && quiz.maxAttempts != null ? { maxAttempts: quiz.maxAttempts } : {}),
  };
}

export async function getQuizBySlug(slug: string): Promise<TestableQuiz | null> {
  await ensureConnection();

  const quiz = await Quiz.findOne({ slug, status: "published" })
    .select("title slug mode status timeLimit maxAttempts version questions.enabled")
    .lean();
  return quiz ? toTestableQuiz(quiz) : null;
}

/**
 * The Quiz behind `/q/<slug>/ket-qua` in **any** status, so a sinh viên can
 * still read an old Attempt after the giảng viên archived the Quiz (Spec, user
 * story 31). Only the id is needed; the summary reads Attempts by student.
 */
export async function getQuizBySlugAnyStatus(
  slug: string,
): Promise<{ id: string; slug: string; status: QuizStatus } | null> {
  await ensureConnection();

  const quiz = await Quiz.findOne({ slug }).select("slug status").lean();
  return quiz ? { id: String(quiz._id), slug: quiz.slug, status: quiz.status } : null;
}

/** Every published Quiz, newest first — what `/` lists. Drafts and archived stay hidden. */
export async function listTestableQuizzes(): Promise<TestableQuiz[]> {
  await ensureConnection();

  const quizzes = await Quiz.find({ status: "published" })
    .select("title slug mode status timeLimit maxAttempts version questions.enabled")
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return quizzes.map(toTestableQuiz);
}
