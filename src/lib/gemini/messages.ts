/**
 * Thông báo lỗi mềm của phần giải thích — dùng chung cho server và trình duyệt.
 *
 * File này không được import gì từ SDK Gemini: panel là client component, và
 * kéo `@google/genai` vào bundle trình duyệt sẽ làm hỏng `next build`.
 */

/** Hiện nguyên văn trên UI khi Gemini không dùng được. */
export const EXPLANATION = {
  /** No key configured on the server at all. */
  notConfigured: "Chưa cấu hình Gemini",
  /** Key present but the model refused/failed for a transient reason (network, 5xx, timeout). */
  unavailable: "Chưa cấu hình hoặc không dùng được Gemini",
  /**
   * The model itself is unusable with this configuration: bad key, no access to
   * the 2.5 model, model not found, or the API refusing the call. Says what the
   * operator can change, since `GEMINI_MODEL` is an env swap, not a code change.
   */
  modelUnavailable:
    "Gemini không dùng được với cấu hình hiện tại — kiểm tra GEMINI_API_KEY hoặc đổi GEMINI_MODEL",
} as const;
