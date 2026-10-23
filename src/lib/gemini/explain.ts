/**
 * Sinh giải thích cho một Question: trả bản cache ngay nếu có, ngược lại stream
 * từ Gemini và ghi cache khi stream xong (Spec, "Gemini").
 *
 * Đúng/sai và đáp án vẫn do `gradeAnswer` cục bộ quyết định — Gemini chỉ viết
 * lời giải thích. Hàm này không bao giờ ném lỗi vì Gemini/thiếu key/cache; mọi
 * trục trặc thành `{ ok: false, error }` với thông báo tiếng Việt hiện thẳng lên UI.
 */
import { buildExplanationPrompt, type ExplanationRequest } from "./prompt";
import { getCachedExplanation, saveExplanation } from "./cache";
import { createGeminiClient, getGeminiApiKey, type ExplainClient } from "./client";
import { EXPLANATION } from "./messages";

export { EXPLANATION } from "./messages";

/**
 * One thing to show: a piece of text, or the soft error that interrupted it.
 * The route serialises these frames; the panel appends `text` and shows `error`.
 */
export type ExplanationEvent = { text?: string; error?: string };

export type ExplanationStream = AsyncIterable<ExplanationEvent>;

export type ExplainResult =
  | { ok: true; source: "cache" | "generated"; stream: ExplanationStream }
  | { ok: false; error: string; stream: ExplanationStream };

export type ExplainQuestionInput = ExplanationRequest & {
  /** Injected in tests; production builds the real Gemini client. */
  client?: ExplainClient;
  /** Defaults to `GEMINI_API_KEY`; empty means "chưa cấu hình". */
  apiKey?: string;
};

function eventsOf(text: string): ExplanationStream {
  return (async function* () {
    if (text !== "") yield { text };
  })();
}

function softError(message: string, shown: string[] = []): ExplainResult {
  return {
    ok: false,
    error: message,
    stream: (async function* () {
      for (const text of shown) yield { text };
      yield { error: message };
    })(),
  };
}

/**
 * Wraps the generator so every failure becomes frames, never a thrown error:
 * `ok: true` promises "cached text or a live model stream", the frame stream
 * reports a mid-stream failure honestly while keeping whatever was already shown.
 */
async function* generateFrames(
  client: ExplainClient,
  prompt: string,
  onComplete: (text: string) => Promise<void>,
): AsyncGenerator<ExplanationEvent> {
  const chunks: string[] = [];
  let failed = false;
  try {
    for await (const chunk of client.stream(prompt)) {
      if (!chunk || chunk.trim() === "") continue;
      chunks.push(chunk);
      yield { text: chunk };
    }
  } catch {
    failed = true;
  }

  // Only a complete, non-empty answer is worth caching: a failed or empty
  // generation must ask the model again next time.
  const text = chunks.join("").trim();
  if (failed || text === "") {
    yield { error: EXPLANATION.unavailable };
    return;
  }
  try {
    await onComplete(text);
  } catch {
    // The sinh viên already has the text; a failed cache write only costs one
    // more model call later.
  }
}

/**
 * Cache hit → cached text instantly, no model call. Otherwise a live stream
 * that is cached on completion. Missing key / model unavailable → soft error;
 * the quiz keeps working because grading never goes through Gemini.
 */
export async function explainQuestion(input: ExplainQuestionInput): Promise<ExplainResult> {
  const cached = await getCachedExplanation(input.question.hash);
  if (cached) return { ok: true, source: "cache", stream: eventsOf(cached) };

  const apiKey = input.apiKey ?? getGeminiApiKey();
  // An injected client is the test seam: it replaces the key + SDK entirely.
  // Only the real path needs a key, so production behaves exactly as before.
  if (!input.client && apiKey.trim() === "") return softError(EXPLANATION.notConfigured);

  const client = input.client ?? createGeminiClient(apiKey);

  return {
    ok: true,
    source: "generated",
    stream: generateFrames(
      client,
      buildExplanationPrompt({ question: input.question, studentAnswer: input.studentAnswer }),
      (text) =>
        saveExplanation({
          questionHash: input.question.hash,
          questionId: input.question.id,
          text,
        }),
    ),
  };
}

/** For deciding whether to auto-request an explanation at all. */
export function isGeminiConfigured(): boolean {
  return getGeminiApiKey() !== "";
}

/**
 * Explanation text for a Question from the cache only, or `null` (Spec story
 * 57/65): the summary page shows what was already generated without waking the
 * model. Shares the `Question.hash` key with `explainQuestion`.
 */
export function getStoredExplanation(question: { hash: string }): Promise<string | null> {
  return getCachedExplanation(question.hash);
}
