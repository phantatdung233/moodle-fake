import { describe, expect, it } from "vitest";
import { EXPLANATION } from "./explain";
import { readExplanationFrames } from "./frame-reader";

const encoder = new TextEncoder();

/** Reads our frame reader through a real stream, the way fetch().body arrives. */
function responseOf(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const seen: { text?: string; error?: string; done?: boolean }[] = [];
  for await (const frame of readExplanationFrames(stream)) seen.push(frame);
  return seen;
}

describe("readExplanationFrames", () => {
  it("ghép text từng frame theo thứ tự stream", async () => {
    const seen = await collect(
      responseOf('data: {"text":"Numpy"}\n\n', 'data: {"text":" là"}\n\n', 'data: {"done":true}\n\n'),
    );

    expect(seen).toEqual([{ text: "Numpy" }, { text: " là" }, { done: true }]);
  });

  it("gộp frame bị cắt giữa hai lần đọc chunk", async () => {
    const seen = await collect(responseOf('data: {"te', 'xt":"xin chào"}\n', '\ndata: {"done":true}\n\n'));

    expect(seen).toEqual([{ text: "xin chào" }, { done: true }]);
  });

  it("chuyển frame lỗi thành lỗi mềm đọc được", async () => {
    const seen = await collect(
      responseOf(`data: ${JSON.stringify({ error: EXPLANATION.notConfigured })}\n\ndata: {"done":true}\n\n`),
    );

    expect(seen).toEqual([{ error: "Chưa cấu hình API giải thích" }, { done: true }]);
  });

  it("bỏ qua frame rác thay vì ném lỗi vào panel", async () => {
    const seen = await collect(responseOf("data: not-json\n\n", 'data: {"text":"ổn"}\n\n'));

    expect(seen).toEqual([{ text: "ổn" }]);
  });

  it("stream trống → không frame nào (panel coi như xong)", async () => {
    expect(await collect(responseOf())).toEqual([]);
  });
});
