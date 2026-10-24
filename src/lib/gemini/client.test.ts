import { describe, expect, it } from "vitest";

import { requestFor, STREAM_TIMEOUT_MS, textFromChunk } from "./client";

/**
 * The provider is River AI's OpenAI-compatible endpoint: the request must be a
 * chat-completions body with `stream: true`, and the answer arrives as SSE
 * `data:` lines whose `choices[0].delta.content` is the next piece of text.
 */
describe("requestFor", () => {
  it("gửi body chat-completions có stream: true", () => {
    const request = requestFor("model-x", "Giải thích câu này.");

    expect(request.model).toBe("model-x");
    expect(request.messages).toEqual([{ role: "user", content: "Giải thích câu này." }]);
    expect(request.stream).toBe(true);
  });

  it("có trần số token để câu trả lời không chạy quá dài", () => {
    expect(Number.isFinite(requestFor("model-x", "x").max_tokens)).toBe(true);
  });
});

describe("textFromChunk", () => {
  it("lấy phần chữ của một frame SSE", () => {
    expect(textFromChunk('data: {"choices":[{"delta":{"content":"Numpy là"}}]}')).toBe("Numpy là");
  });

  it("bỏ qua [DONE], dòng trống, comment giữ kết nối và frame rỗng", () => {
    expect(textFromChunk("data: [DONE]")).toBeNull();
    expect(textFromChunk("")).toBeNull();
    expect(textFromChunk(": keep-alive")).toBeNull();
    expect(textFromChunk('data: {"choices":[{"delta":{}}]}')).toBeNull();
  });

  it("frame lỗi của provider → ném lỗi để panel báo lỗi mềm", () => {
    expect(() => textFromChunk('data: {"error":{"message":"model overloaded"}}')).toThrow(
      "model overloaded",
    );
  });

  it("dòng không phải JSON thì bỏ qua, không làm hỏng cả stream", () => {
    expect(textFromChunk("data: {hỏng")).toBeNull();
  });
});

describe("STREAM_TIMEOUT_MS", () => {
  it("có trần thời gian hữu hạn cho một lần giải thích", () => {
    expect(Number.isFinite(STREAM_TIMEOUT_MS)).toBe(true);
    expect(STREAM_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("createExplainClient — stream SSE từ provider", () => {
  function sseResponse(frames: string[], status = 200): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return new Response(body, { status });
  }

  it("ghép các delta thành văn bản, kể cả khi một frame bị cắt làm hai", async () => {
    const original = globalThis.fetch;
    const originalUrl = process.env.EXPLAIN_BASE_URL;
    process.env.EXPLAIN_BASE_URL = "https://example.test/v1";
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Numpy là"}}]}\n\ndata: {"cho',
        'ices":[{"delta":{"content":" thư viện"}}]}\n\n',
        "data: [DONE]\n\n",
      ])) as typeof fetch;
    try {
      const { createExplainClient } = await import("./client");
      const client = createExplainClient("key", "model-x");
      const parts: string[] = [];
      for await (const part of client.stream("x")) parts.push(part);
      expect(parts.join("")).toBe("Numpy là thư viện");
    } finally {
      globalThis.fetch = original;
      if (originalUrl === undefined) delete process.env.EXPLAIN_BASE_URL;
      else process.env.EXPLAIN_BASE_URL = originalUrl;
    }
  });

  it("provider trả lỗi → ném lỗi kèm status để panel báo lỗi mềm", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"invalid api key"}}', { status: 401 })) as typeof fetch;
    try {
      const { createExplainClient } = await import("./client");
      const client = createExplainClient("key", "model-x");
      await expect(
        (async () => {
          for await (const _ of client.stream("x")) void _;
        })(),
      ).rejects.toThrow("status 401");
    } finally {
      globalThis.fetch = original;
    }
  });
});
