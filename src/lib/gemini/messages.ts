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
  /** Key present but the model refused/failed (bad key, no 2.5 access, network). */
  unavailable: "Chưa cấu hình hoặc không dùng được Gemini",
} as const;
