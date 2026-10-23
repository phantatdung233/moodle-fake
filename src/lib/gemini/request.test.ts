import { describe, expect, it } from "vitest";
import { readExplanationRequest, encodeFrame, encodeFrames } from "./request";

describe("readExplanationRequest", () => {
  it("đọc questionId và questionHash từ JSON body", () => {
    const parsed = readExplanationRequest({
      questionId: "Q144",
      questionHash: "abc",
    });

    expect(parsed).toEqual({ ok: true, questionId: "Q144", questionHash: "abc" });
  });

  it("questionHash là tuỳ chọn (server tự lấy hash từ snapshot)", () => {
    expect(readExplanationRequest({ questionId: "Q144" })).toEqual({
      ok: true,
      questionId: "Q144",
      questionHash: undefined,
    });
  });

  it("từ chối body không phải object hoặc thiếu questionId", () => {
    for (const body of [null, "Q144", 42, [], {}, { questionId: "" }, { questionId: 7 }]) {
      const parsed = readExplanationRequest(body);
      expect(parsed).toMatchObject({ ok: false });
    }
  });
});

describe("encodeFrame", () => {
  it("mã hoá mỗi sự kiện thành một dòng SSE có tiền tố data:", () => {
    expect(encodeFrame({ text: "Xin chào" })).toBe('data: {"text":"Xin chào"}\n\n');
    expect(encodeFrame({ error: "Chưa cấu hình Gemini" })).toBe(
      'data: {"error":"Chưa cấu hình Gemini"}\n\n',
    );
    expect(encodeFrame({ text: "hết" }, true)).toBe('data: {"text":"hết","done":true}\n\n');
  });

  it("text nhiều dòng vẫn nằm trong một frame JSON hợp lệ", () => {
    const encoded = encodeFrame({ text: "dòng 1\ndòng 2" });
    expect(encoded.endsWith("\n\n")).toBe(true);
    const line = encoded.trim().slice("data: ".length);
    expect(JSON.parse(line)).toEqual({ text: "dòng 1\ndòng 2" });
  });
});

describe("encodeFrames", () => {
  it("nối các frame rồi đóng bằng đúng một frame done", () => {
    expect(encodeFrames([{ error: "Chưa cấu hình Gemini" }])).toBe(
      'data: {"error":"Chưa cấu hình Gemini"}\n\ndata: {"done":true}\n\n',
    );
  });

  it("không thêm frame done khi được yêu cầu bỏ", () => {
    expect(encodeFrames([{ text: "a" }], false)).toBe('data: {"text":"a"}\n\n');
  });
});
