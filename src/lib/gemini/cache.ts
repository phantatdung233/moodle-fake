/**
 * Đọc/ghi giải thích đã sinh — lớp dữ liệu duy nhất cho phần này.
 *
 * Hai bản ghi của cùng một văn bản (Spec, "Gemini"):
 * - `ExplanationCache` khoá theo `Question.hash` — bản đọc chính, giữ được cả
 *   những hash mà đề đã không còn (attempt cũ vẫn thấy giải thích lúc làm).
 * - `Question.explanation` trên đề đang dùng hash đó — ghi kèm để giảng viên
 *   thấy ngay lời giải thích trong chính document của đề.
 *
 * `getCachedExplanation(hash)` là cửa đọc duy nhất: route handler
 * (`/api/explain`), trang tổng kết, chi tiết lượt làm của admin đều gọi nó.
 */
import { Quiz } from "@/lib/quiz/quiz.model";
import { ExplanationCache } from "./explanation.model";
import { ensureConnection } from "@/lib/mongodb";

/**
 * The explanation stored for this `Question.hash`, or `null` when Gemini has
 * never explained that exact content + answer. Connection/cache failures read
 * as "not cached": a broken cache must never break the quiz screen.
 */
export async function getCachedExplanation(questionHash: string): Promise<string | null> {
  if (typeof questionHash !== "string" || questionHash.trim() === "") return null;

  try {
    await ensureConnection();
    const cached = await ExplanationCache.findOne({ questionHash }).lean();
    const text = cached?.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

/**
 * Upsert by hash: regenerating a Question replaces its stale text, never
 * duplicates it. The same text is written into every draft / published Quiz
 * that carries the hash, so `Question.explanation` stays a mirror of what
 * students get; a hash only old Attempts know has no Quiz to mirror.
 */
export async function saveExplanation(input: {
  questionHash: string;
  questionId: string;
  text: string;
}): Promise<void> {
  await ensureConnection();
  await ExplanationCache.updateOne(
    { questionHash: input.questionHash },
    { $set: { questionId: input.questionId, text: input.text } },
    { upsert: true },
  );
  await Quiz.updateMany(
    { "questions.hash": input.questionHash, status: { $in: ["draft", "published"] } },
    { $set: { "questions.$[question].explanation": input.text } },
    { arrayFilters: [{ "question.hash": input.questionHash }] },
  );
}
