/**
 * Hợp đồng giữa panel giải thích và route handler `/api/explain`.
 *
 * Mỗi frame là một dòng SSE `data: <json>`; panel chỉ cần đọc `text`/`error`,
 * nên có thể test phần này mà không cần trình duyệt hay model.
 */

export const EXPLAIN_ROUTE = "/api/explain";

export type ExplanationRequestInput = {
  /** The Attempt on screen; the server checks it belongs to the cookie's MSSV. */
  attemptId: string;
  questionId: string;
  /**
   * The hash the client rendered for; the server uses its own snapshot hash and
   * answers `409` when the two differ (stale page after an admin edit).
   */
  questionHash?: string;
};

export type ExplanationRequestBody =
  | { ok: true; attemptId: string; questionId: string; questionHash: string | undefined }
  | { ok: false; error: string };

export type ReviewExplanationRequestBody =
  | { ok: true; questionId: string; questionHash: string | undefined }
  | { ok: false; error: string };

export const INVALID_EXPLAIN_REQUEST = "Yêu cầu giải thích không hợp lệ.";

/**
 * Validates the sinh viên's POST body; malformed input is a soft error, never a
 * 500. `attemptId` is required because the cookie names the MSSV, not a paper:
 * the route checks that the Attempt really belongs to that MSSV.
 */
export function readExplanationRequest(body: unknown): ExplanationRequestBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: INVALID_EXPLAIN_REQUEST };
  }
  const { attemptId, questionId, questionHash } = body as Record<string, unknown>;
  if (typeof attemptId !== "string" || attemptId.trim() === "") {
    return { ok: false, error: INVALID_EXPLAIN_REQUEST };
  }
  if (typeof questionId !== "string" || questionId.trim() === "") {
    return { ok: false, error: INVALID_EXPLAIN_REQUEST };
  }
  return {
    ok: true,
    attemptId: attemptId.trim(),
    questionId: questionId.trim(),
    questionHash: typeof questionHash === "string" && questionHash !== "" ? questionHash : undefined,
  };
}

/**
 * The giảng viên's review page names a Quiz, not an Attempt, so its body has no
 * `attemptId`: the session is the authorisation, and the Question comes from the
 * Quiz being edited.
 */
export function readReviewExplanationRequest(body: unknown): ReviewExplanationRequestBody {
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

/** Several frames plus the closing `done` frame: the body of a short-lived response. */
export function encodeFrames(frames: readonly ExplanationFrame[], done = true): string {
  const body = frames.map((frame) => encodeFrame(frame)).join("");
  return done ? `${body}${encodeFrame({}, true)}` : body;
}
