/**
 * ExplanationCache — một giải thích Gemini cho mỗi `Question.hash` (Spec,
 * Domain model).
 *
 * Khoá là hash nội dung + đáp án chứ không phải `questionId`: giảng viên sửa
 * đáp án trong đề nháp thì hash đổi và hệ thống sinh giải thích mới, còn
 * `Attempt` cũ vẫn đọc được đúng văn bản của bản đề lúc họ làm bài.
 */
import mongoose from "mongoose";

export type ExplanationCacheDocument = {
  questionHash: string;
  questionId: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
};

const explanationCacheSchema = new mongoose.Schema<ExplanationCacheDocument>(
  {
    questionHash: { type: String, required: true, unique: true },
    questionId: { type: String, required: true, index: true },
    text: { type: String, required: true },
  },
  { timestamps: true },
);

export const ExplanationCache: mongoose.Model<ExplanationCacheDocument> =
  (mongoose.models.ExplanationCache as mongoose.Model<ExplanationCacheDocument>) ??
  mongoose.model<ExplanationCacheDocument>("ExplanationCache", explanationCacheSchema);
