/**
 * "Cổng" gọi model: dịch vụ giải thích chỉ biết `ExplainClient`, không biết nhà
 * cung cấp API. Nhờ vậy test truyền fake client để đếm số lần gọi, còn chạy thật
 * thì `createExplainClient()` gọi River AI qua endpoint OpenAI-compatible.
 */
import { getExplainModel, getExplainBaseUrl } from "./config";

export type ExplainClient = {
  /** Yields the explanation progressively; throws when the model is unreachable. */
  stream(prompt: string): AsyncIterable<string>;
};

/** `RIVER_API_KEY` is the documented key; `EXPLAIN_API_KEY` overrides it. */
export function getExplainApiKey(): string {
  return (process.env.RIVER_API_KEY ?? process.env.EXPLAIN_API_KEY ?? "").trim();
}

/**
 * Ceiling for one explanation. A healthy stream finishes in a few seconds; 45s
 * leaves room for a slow first token without an endless spinner.
 */
export const STREAM_TIMEOUT_MS = 45_000;

/**
 * The body of one chat-completions call. `stream: true` makes the server answer
 * with SSE chunks (`data: {...}` lines), which is what the panel reads
 * progressively instead of waiting for the whole text.
 */
export function requestFor(model: string, prompt: string) {
  return {
    model,
    messages: [{ role: "user" as const, content: prompt }],
    // Short explanations; a hard ceiling keeps a runaway answer from billing.
    max_tokens: 1200,
    temperature: 0.4,
    stream: true,
  };
}

/**
 * One SSE line from an OpenAI-compatible stream → its text delta, or `null`.
 * `[DONE]` and keep-alive comments carry no text; a `finish_reason` chunk has
 * an empty delta. Anything unparsable is skipped rather than failing the call.
 */
export function textFromChunk(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(":")) return null;
  const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : "";
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null } }[];
      error?: { message?: string };
    };
    if (parsed.error?.message) throw new Error(parsed.error.message);
    const text = parsed.choices?.[0]?.delta?.content;
    return text ? text : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Streams an explanation from River AI. The model id comes from `EXPLAIN_MODEL`
 * so a project can switch models without a deploy.
 *
 * `EXPLAIN_TIMEOUT_MS`: how long the stream may stay silent before it is
 * aborted. Without a ceiling, a model under load leaves the panel spinning
 * forever.
 */
export function createExplainClient(
  apiKey: string,
  model = getExplainModel(),
  timeoutMs = STREAM_TIMEOUT_MS,
): ExplainClient {
  const baseUrl = getExplainBaseUrl();

  return {
    async *stream(prompt) {
      // The clock guards the silence, not the whole answer: a long text that
      // keeps streaming is allowed to finish.
      const controller = new AbortController();
      let timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(requestFor(model, prompt)),
          signal: controller.signal,
        });

        if (!response.ok) {
          // The body carries the provider's reason (bad key, unknown model,
          // quota); `explanationErrorFor` reads the status and the text.
          const detail = await response.text().catch(() => "");
          throw new Error(`status ${response.status}: ${detail.slice(0, 500)}`);
        }
        if (!response.body) throw new Error("empty response");

        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(), timeoutMs);
          buffer += decoder.decode(chunk, { stream: true });
          // Frames are separated by a blank line; a chunk may split one in two.
          let breakAt = buffer.indexOf("\n\n");
          while (breakAt !== -1) {
            const frame = buffer.slice(0, breakAt);
            buffer = buffer.slice(breakAt + 2);
            for (const line of frame.split("\n")) {
              const text = textFromChunk(line);
              if (text) yield text;
            }
            breakAt = buffer.indexOf("\n\n");
          }
        }

        // A provider may end without a trailing blank line.
        for (const line of buffer.split("\n")) {
          const text = textFromChunk(line);
          if (text) yield text;
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
