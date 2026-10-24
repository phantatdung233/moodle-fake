/**
 * Thông báo lỗi mềm của phần giải thích — dùng chung cho server và trình duyệt.
 *
 * File này không được import gì từ SDK/model client: panel là client component,
 * và kéo mã phía server vào bundle trình duyệt sẽ làm hỏng `next build`.
 */

/** Hiện nguyên văn trên UI khi model không dùng được. */
export const EXPLANATION = {
  /** No key configured on the server at all. */
  notConfigured: "Chưa cấu hình API giải thích",
  /** Key present but the model refused/failed for a transient reason (network, 5xx, timeout). */
  unavailable: "Chưa cấu hình hoặc không dùng được API giải thích",
  /**
   * The model answered but is overloaded (503 "high demand") or never responded
   * before the timeout. Temporary, so the message says to retry rather than to
   * change configuration.
   */
  modelBusy:
    "Model đang quá tải hoặc không phản hồi kịp — đợi một lát rồi bấm Thử lại",
  /**
   * The model itself is unusable with this configuration: bad key, no access to
   * the model, model not found, or the API refusing the call. Says what the
   * operator can change, since `EXPLAIN_MODEL` is an env swap, not a code change.
   */
  modelUnavailable:
    "Model không dùng được với cấu hình hiện tại — kiểm tra RIVER_API_KEY hoặc đổi EXPLAIN_MODEL",
} as const;
