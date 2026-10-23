/**
 * Đọc các frame `text/event-stream` của `/api/explain` trên trình duyệt.
 *
 * Tách khỏi component để test được bằng `ReadableStream` giả: ghép frame bị cắt
 * giữa hai chunk, bỏ frame hỏng, và chuyển frame `{error}` thành lỗi mềm.
 */
import type { ExplanationFrame } from "./request";

/** Yields each `data:` frame as it arrives; a closing `{done:true}` ends the loop. */
export async function* readExplanationFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ExplanationFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const frame = parseEvent(event);
        if (!frame) continue;
        yield frame;
        if (frame.done) return;
      }
    }

    const last = parseEvent(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(event: string): ExplanationFrame | null {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (data === "" || data === "[DONE]") return null;

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { text, error, done } = parsed as Record<string, unknown>;
    return {
      ...(typeof text === "string" ? { text } : {}),
      ...(typeof error === "string" ? { error } : {}),
      ...(done === true ? { done: true as const } : {}),
    };
  } catch {
    return null;
  }
}
