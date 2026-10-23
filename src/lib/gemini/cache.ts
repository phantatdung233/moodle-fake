/**
 * Đọc/ghi ExplanationCache — lớp dữ liệu duy nhất cho giải thích đã sinh.
 *
 * `getCachedExplanation(hash)` là seam mà route handler (`/api/explain`) và
 * trang tổng kết dùng để hiện giải thích có sẵn mà không gọi Gemini.
 */
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

/** Upsert by hash: regenerating a Question replaces its stale text, never duplicates it. */
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
}
