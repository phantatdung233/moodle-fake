/**
 * Sinh giải thích cho một Question bằng cách stream từ API model (River AI).
 *
 * Không cache: mỗi sinh viên có thể chọn đáp án khác nhau nên lời giải thích phải
 * được sinh theo đúng đáp án của lượt làm đó.
 *
 * Đúng/sai và đáp án vẫn do `gradeAnswer` cục bộ quyết định — model chỉ viết
 * lời giải thích. Hàm này không bao giờ ném lỗi vì model/thiếu key; mọi
 * trục trặc thành `{ ok: false, error }` với thông báo tiếng Việt hiện thẳng lên UI.
 */
import { buildExplanationPrompt, type ExplanationRequest } from "./prompt";
import { createExplainClient, getExplainApiKey, type ExplainClient } from "./client";
import { EXPLANATION } from "./messages";

/**
 * Swappable only under `NODE_ENV=test`, where the admin-explanation route test
 * injects a fake client (the same seam the unit tests use by hand).
 */
let testClientFactory: ((apiKey: string) => ExplainClient) | null = null;

/** Test-only: run the real route against a fake model instead of the SDK. */
export function useTestExplainClient(factory: (apiKey: string) => ExplainClient): void {
  if (process.env.NODE_ENV !== "test") throw new Error("chỉ dùng trong test");
  testClientFactory = factory;
}

export { EXPLANATION } from "./messages";

/**
 * One thing to show: a piece of text, or the soft error that interrupted it.
 * The route serialises these frames; the panel appends `text` and shows `error`.
 */
export type ExplanationEvent = { text?: string; error?: string };

export type ExplanationStream = AsyncIterable<ExplanationEvent>;

export type ExplainResult =
  | { ok: true; source: "generated"; stream: ExplanationStream }
  | { ok: false; error: string; stream: ExplanationStream };

export type ExplainQuestionInput = ExplanationRequest & {
  /** Injected in tests; production builds the real HTTP client. */
  client?: ExplainClient;
  /** Defaults to `RIVER_API_KEY`; empty means "chưa cấu hình". */
  apiKey?: string;
};

function softError(message: string): ExplainResult {
  return {
    ok: false,
    error: message,
    stream: (async function* () {
      yield { error: message };
    })(),
  };
}

/**
 * SDK error codes/messages that mean "this key or this model is not usable
 * here", as opposed to a transient network/5xx failure. The SDK often throws a
 * double-encoded JSON string instead of an `Error`, so match both.
 */
const CONFIG_ERRORS = [
  /\b40[13]\b/, // 401/403: bad key, permission, refused the call
  /\b404\b/, // model not found
  /API_KEY_INVALID/i,
  /PERMISSION_DENIED/i,
  /UNAUTHENTICATED/i,
  /NOT_FOUND/i,
  /INVALID_ARGUMENT/i,
  /not found/i,
  /not supported/i,
  /unsupported/i,
  /model .* (?:is )?not (?:available|found)/i,
];

/**
 * "The model is fine, come back later": overload (503/`UNAVAILABLE`, "high
 * demand") and our own timeout. A 429 is also temporary (quota), never a
 * configuration mistake.
 */
const BUSY_ERRORS = [
  /\b429\b/,
  /\b503\b/,
  /UNAVAILABLE/i,
  /overloaded/i,
  /high demand/i,
  /RESOURCE_EXHAUSTED/i,
  /timed? ?out/i,
  /aborted/i,
];

/**
 * Picks the soft error for a failed generation. A configuration problem points
 * at `RIVER_API_KEY`/`EXPLAIN_MODEL`; an overloaded or silent model asks for a
 * retry; anything else (network drop, 5xx) keeps the generic message so a
 * temporary outage is not mistaken for a misconfiguration.
 */
export function explanationErrorFor(error: unknown): string {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : "";
  if (BUSY_ERRORS.some((pattern) => pattern.test(text))) return EXPLANATION.modelBusy;
  return CONFIG_ERRORS.some((pattern) => pattern.test(text))
    ? EXPLANATION.modelUnavailable
    : EXPLANATION.unavailable;
}

/**
 * Wraps the generator so every failure becomes frames, never a thrown error:
 * `ok: true` promises a live model stream; the frame stream
 * reports a mid-stream failure honestly while keeping whatever was already shown.
 */
async function* generateFrames(
  client: ExplainClient,
  prompt: string,
): AsyncGenerator<ExplanationEvent> {
  const chunks: string[] = [];
  let failure: string | null = null;
  try {
    for await (const chunk of client.stream(prompt)) {
      if (!chunk || chunk.trim() === "") continue;
      chunks.push(chunk);
      yield { text: chunk };
    }
  } catch (error) {
    failure = explanationErrorFor(error);
  }

  // A failed or empty generation must report itself honestly: nothing is stored
  // to fall back on, so the student sees the error and can ask again.
  const text = chunks.join("").trim();
  if (failure !== null || text === "") {
    yield { error: failure ?? EXPLANATION.unavailable };
  }
}

/**
 * Always a live stream, generated for this student's own answer. Missing key /
 * model unavailable → soft error; the quiz keeps working because grading never
 * goes through the AI provider.
 */
export async function explainQuestion(input: ExplainQuestionInput): Promise<ExplainResult> {
  const apiKey = input.apiKey ?? getExplainApiKey();
  // An injected client is the test seam: it replaces the key + SDK entirely.
  // Only the real path needs a key, so production behaves exactly as before.
  if (!input.client && apiKey.trim() === "") return softError(EXPLANATION.notConfigured);

  let client: ExplainClient;
  try {
    client =
      input.client ??
      testClientFactory?.(apiKey) ??
      createExplainClient(apiKey);
  } catch {
    // A malformed key or base URL surfaces here: a configuration problem, so
    // the message names the env vars to check.
    return softError(EXPLANATION.modelUnavailable);
  }

  return {
    ok: true,
    source: "generated",
    stream: generateFrames(
      client,
      buildExplanationPrompt({ question: input.question, studentAnswer: input.studentAnswer }),
    ),
  };
}

/** For deciding whether to auto-request an explanation at all. */
export function isExplainConfigured(): boolean {
  return getExplainApiKey() !== "";
}
