/**
 * The Quiz lifecycle — publish / unpublish / archive — plus the draft-only
 * settings and Question selection the giảng viên edits before publishing.
 *
 * Same seam as `repository.ts` and `review-repository.ts`: plain values in and
 * out, so tests, server actions and pages share it. Every write re-reads the
 * Quiz status inside the same update, so the state machine is enforced here
 * and not only by hiding buttons (Spec, "Publish state machine").
 */
import mongoose from "mongoose";
import { Quiz, type QuizMode } from "./quiz.model";
import { isValidQuizSlug, SLUG_FORMAT_ERROR } from "./slug";
import { ensureConnection, isDuplicateKeyError } from "@/lib/mongodb";

export const QUIZ_NOT_FOUND_ERROR = "Không tìm thấy đề.";
export const NOT_DRAFT_ERROR = "Đề đã publish nên không sửa được nữa. Hãy huỷ publish nếu cần sửa.";
export const NOT_PUBLISHED_ERROR = "Đề chưa publish nên không thể archive.";
export const NOT_ARCHIVED_ERROR = "Đề đã lưu trữ nên không sửa được nữa.";
export const ARCHIVED_TERMINAL_ERROR = "Đề đã lưu trữ. Đây là trạng thái cuối, không đổi được nữa.";
export const NO_READY_QUESTIONS_ERROR =
  "Đề chưa có câu nào sẵn sàng để publish. Hãy duyệt đáp án hoặc bật ít nhất một câu đã có đáp án.";
export const UNPUBLISH_HAS_ATTEMPTS_ERROR =
  "Đã có sinh viên làm đề này nên không huỷ publish được. Nếu muốn ẩn đề, hãy lưu trữ (archive).";
export const DELETE_NOT_DRAFT_ERROR =
  "Chỉ xoá được đề nháp. Đề đã publish hoặc đã lưu trữ phải giữ lại để lượt làm cũ còn đọc được.";

/** A Question counts toward a published Quiz only when it is on and has an answer. */
function isReadyForPublish(question: { enabled: boolean; status: string }): boolean {
  return question.enabled && question.status === "ready";
}

export type PublishPreview =
  | { ok: true; readyCount: number; droppedCount: number }
  | { ok: false; error: string };

/**
 * What the confirm dialog shows before publishing: how many Questions will be
 * dropped (disabled, or still `needs_review`) and how many will actually go out.
 */
export async function describePublish(quizId: string): Promise<PublishPreview> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  const quiz = await Quiz.findById(quizId)
    .select("status questions.enabled questions.status")
    .lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "published") return { ok: false, error: "Đề đã publish rồi." };
  if (quiz.status === "archived") return { ok: false, error: ARCHIVED_TERMINAL_ERROR };

  const all = quiz.questions ?? [];
  const readyCount = all.filter(isReadyForPublish).length;
  return { ok: true, readyCount, droppedCount: all.length - readyCount };
}

export type PublishResult =
  | { ok: true; publishedCount: number; droppedCount: number }
  | { ok: false; error: string };

/**
 * Freezes the Quiz: every disabled / `needs_review` Question is switched off
 * (kept in the document so review history and old Attempts still resolve),
 * the rest go out as the paper, `version` moves up and `publishedAt` is set.
 *
 * The status check is part of the update filter, so two concurrent publishes
 * cannot both pass: the loser matches nothing and reports the new state.
 * Rejects a draft with zero ready Questions and a Quiz already published.
 */
export async function publishQuiz(quizId: string): Promise<PublishResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  // Read once for the counts and the disabled ids; the update below re-checks
  // `status: "draft"` so a concurrent publish cannot slip through.
  const quiz = await Quiz.findById(quizId)
    .select("status questions.id questions.enabled questions.status")
    .lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "published") return { ok: false, error: "Đề đã publish rồi." };
  if (quiz.status === "archived") return { ok: false, error: ARCHIVED_TERMINAL_ERROR };

  const all = quiz.questions ?? [];
  const readyIds = all.filter(isReadyForPublish).map((question) => question.id);
  const droppedCount = all.length - readyIds.length;
  if (readyIds.length === 0) return { ok: false, error: NO_READY_QUESTIONS_ERROR };

  const drop = await Quiz.updateOne(
    { _id: quizId, status: "draft" },
    {
      $set: { status: "published", publishedAt: new Date() },
      $inc: { version: 1 },
    },
  );
  if (drop.matchedCount === 0) return { ok: false, error: "Đề đã publish rồi." };

  await Quiz.updateOne(
    { _id: quizId, "questions.enabled": true },
    { $set: { "questions.$[question].enabled": false } },
    { arrayFilters: [{ "question.id": { $nin: readyIds } }] },
  );

  return { ok: true, publishedCount: readyIds.length, droppedCount };
}

export type LifecycleResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes a draft Quiz for good — a draft never reached a sinh viên, so there
 * is no Attempt or snapshot to protect. `published` / `archived` are refused:
 * their Attempts still read the Quiz, so they may only be archived.
 *
 * The status is part of the delete filter, so a Quiz published in another tab
 * between the check and the delete matches nothing instead of vanishing. The
 * cached explanations of the removed Questions go with it; a hash shared with
 * another Quiz stops matching anything, so leaving it would be dead weight.
 */
export async function deleteDraftQuiz(quizId: string): Promise<LifecycleResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  const quiz = await Quiz.findOne({ _id: quizId }).select("status questions.id questions.hash").lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status !== "draft") return { ok: false, error: DELETE_NOT_DRAFT_ERROR };

  const deleted = await Quiz.deleteOne({ _id: quizId, status: "draft" });
  if (deleted.deletedCount === 0) return { ok: false, error: DELETE_NOT_DRAFT_ERROR };

  const hashes = (quiz.questions ?? []).map((question) => question.hash).filter(Boolean);
  if (hashes.length > 0) {
    const { ExplanationCache } = await import("@/lib/gemini/explanation.model");
    await ExplanationCache.deleteMany({ questionHash: { $in: hashes } });
  }

  return { ok: true };
}

/**
 * `published → draft`, only while nobody has started an Attempt — an Attempt
 * holds a snapshot and a result, but the giảng viên may only reopen editing
 * when there is nothing to protect. Questions the publish switched off stay
 * off; the giảng viên turns them back on in the editor.
 */
export async function unpublishQuiz(quizId: string): Promise<LifecycleResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  const { Attempt } = await import("./attempt.model");
  const quiz = await Quiz.findById(quizId).select("status").lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "draft") return { ok: false, error: "Đề đang là bản nháp." };
  if (quiz.status === "archived") return { ok: false, error: ARCHIVED_TERMINAL_ERROR };

  if ((await Attempt.countDocuments({ quizId })) > 0) {
    return { ok: false, error: UNPUBLISH_HAS_ATTEMPTS_ERROR };
  }

  const updated = await Quiz.updateOne(
    { _id: quizId, status: "published" },
    { $set: { status: "draft" }, $unset: { publishedAt: 1 } },
  );
  if (updated.matchedCount === 0) return { ok: false, error: "Đề đang là bản nháp." };

  return { ok: true };
}

/** `published → archived`, the terminal state: hidden from `/`, Attempts stay readable. */
export async function archiveQuiz(quizId: string): Promise<LifecycleResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("status").lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "draft") return { ok: false, error: NOT_PUBLISHED_ERROR };
  if (quiz.status === "archived") return { ok: false, error: "Đề đã lưu trữ rồi." };

  const updated = await Quiz.updateOne(
    { _id: quizId, status: "published" },
    { $set: { status: "archived" } },
  );
  if (updated.matchedCount === 0) return { ok: false, error: "Đề đã lưu trữ rồi." };

  return { ok: true };
}

export type QuizSettingsInput = {
  title: string;
  slug: string;
  mode: QuizMode;
  /** Minutes for an exam; `null` clears it (practice has none). */
  timeLimit: number | null;
  /** Attempts allowed for an exam; `null` clears it. */
  maxAttempts: number | null;
};

export const TITLE_REQUIRED_ERROR = "Tên đề không được để trống.";
export const SLUG_REQUIRED_ERROR = "Slug không được để trống.";
export const TIME_LIMIT_ERROR = "Thời gian làm bài phải là số phút nguyên, lớn hơn 0.";
export const MAX_ATTEMPTS_ERROR = "Số lần làm phải là số nguyên, lớn hơn 0.";

/**
 * The giảng viên's edits on a draft: title, slug, mode, timeLimit,
 * maxAttempts. Practice Quizzes carry neither limit. Rejects anything but a
 * draft with a Vietnamese message, so a published (frozen) Quiz cannot be
 * changed even by posting the action directly.
 */
export async function updateQuizSettings(
  quizId: string,
  input: QuizSettingsInput,
): Promise<LifecycleResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  const title = input.title.trim();
  const slug = input.slug.trim();
  if (title === "") return { ok: false, error: TITLE_REQUIRED_ERROR };
  if (slug === "") return { ok: false, error: SLUG_REQUIRED_ERROR };
  if (!isValidQuizSlug(slug)) return { ok: false, error: SLUG_FORMAT_ERROR };
  if (input.mode !== "practice" && input.mode !== "exam") {
    return { ok: false, error: "Chế độ không hợp lệ." };
  }

  const timeLimit = input.timeLimit ?? null;
  const maxAttempts = input.maxAttempts ?? null;
  if (timeLimit !== null && !(Number.isInteger(timeLimit) && timeLimit > 0)) {
    return { ok: false, error: TIME_LIMIT_ERROR };
  }
  if (maxAttempts !== null && !(Number.isInteger(maxAttempts) && maxAttempts > 0)) {
    return { ok: false, error: MAX_ATTEMPTS_ERROR };
  }

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("status").lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "published") return { ok: false, error: NOT_DRAFT_ERROR };
  if (quiz.status === "archived") return { ok: false, error: NOT_ARCHIVED_ERROR };

  const $set: Record<string, unknown> = { title, slug, mode: input.mode };
  const $unset: Record<string, 1> = {};
  if (input.mode === "practice" || timeLimit === null) $unset.timeLimit = 1;
  else $set.timeLimit = timeLimit;
  if (input.mode === "practice" || maxAttempts === null) $unset.maxAttempts = 1;
  else $set.maxAttempts = maxAttempts;

  try {
    const updated = await Quiz.updateOne(
      { _id: quizId, status: "draft" },
      { $set, ...(Object.keys($unset).length > 0 ? { $unset } : {}) },
    );
    if (updated.matchedCount === 0) return { ok: false, error: NOT_DRAFT_ERROR };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { ok: false, error: `Slug “${slug}” đã được dùng cho đề khác. Hãy chọn slug khác.` };
    }
    throw error;
  }

  return { ok: true };
}

export const QUESTION_SELECTION_NOT_FOUND_ERROR = "Không tìm thấy câu hỏi này trong đề.";

/**
 * Turns one Question on or off for a draft Quiz — the "40/180 câu" selection.
 * Like every other draft edit this is refused once the Quiz is published.
 */
export async function saveQuestionSelection(
  quizId: string,
  questionId: string,
  enabled: boolean,
): Promise<LifecycleResult> {
  if (!mongoose.isValidObjectId(quizId)) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };

  await ensureConnection();

  const quiz = await Quiz.findById(quizId).select("status questions.id").lean();
  if (!quiz) return { ok: false, error: QUIZ_NOT_FOUND_ERROR };
  if (quiz.status === "published") return { ok: false, error: NOT_DRAFT_ERROR };
  if (quiz.status === "archived") return { ok: false, error: NOT_ARCHIVED_ERROR };
  if (!(quiz.questions ?? []).some((question) => question.id === questionId)) {
    return { ok: false, error: QUESTION_SELECTION_NOT_FOUND_ERROR };
  }

  await Quiz.updateOne(
    { _id: quizId, status: "draft" },
    { $set: { "questions.$[question].enabled": enabled } },
    { arrayFilters: [{ "question.id": questionId }] },
  );

  return { ok: true };
}
