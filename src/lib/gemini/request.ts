/**
 * Hợp đồng giữa panel giải thích và route handler `/api/explain`.
 *
 * Mỗi frame là một dòng SSE `data: <json>`; panel chỉ cần đọc `text`/`error`,
 * nên có thể test phần này mà không cần trình duyệt hay Gemini.
 */

export const EXPLAIN_ROUTE = "/api/explain";

export type ExplanationRequestInput = {
  questionId: string;
  /**
   * The hash the client rendered for; the server uses its own snapshot hash and
   * answers `409` when the two differ (stale page after an admin edit).
   */
  questionHash?: string;
};

export type ExplanationRequestBody =
  | { ok: true; questionId: string; questionHash: string | undefined }
  | { ok: false; error: string };

export const INVALID_EXPLAIN_REQUEST = "Yêu cầu giải thích không hợp lệ.";

/** Validates the POST body; malformed input is a soft error, never a 500. */
export function readExplanationRequest(body: unknown): ExplanationRequestBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: INVALID_EXPLAIN_REQUEST };
  }
  const { questionId, questionHash } = body as Record<string, unknown>;
  if (typeof questionId !== "string" || questionId.trim() === "") {
    return { ok: false, error: INVALID_EXPLAIN_REQUEST };
  }
  return {
    ok: true,
    questionId: questionId.trim(),
    questionHash: typeof questionHash === "string" && questionHash !== "" ? questionHash : undefined,
  };
}

export type ExplanationFrame = {
  text?: string;
  error?: string;
  /** True on the single closing frame, so the panel can stop its "đang viết" state. */
  done?: true;
};

/** `data: {"text":"…"}\n\n` — one SSE event. */
export function encodeFrame(frame: ExplanationFrame, done = false): string {
  return `data: ${JSON.stringify(done ? { ...frame, done: true } : frame)}\n\n`;
}
