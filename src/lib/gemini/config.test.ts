import { describe, expect, it, afterEach } from "vitest";

import { DEFAULT_GEMINI_MODEL, getGeminiModel } from "./config";

describe("getGeminiModel", () => {
  const original = process.env.GEMINI_MODEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = original;
    }
  });

  it("mặc định là gemini-2.5-flash khi không có env", () => {
    delete process.env.GEMINI_MODEL;
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.5-flash");
    expect(getGeminiModel()).toBe("gemini-2.5-flash");
  });

  it("đọc model từ env GEMINI_MODEL", () => {
    process.env.GEMINI_MODEL = "gemini-3.0-pro";
    expect(getGeminiModel()).toBe("gemini-3.0-pro");
  });

  it("bỏ qua env rỗng hoặc chỉ có khoảng trắng", () => {
    process.env.GEMINI_MODEL = "   ";
    expect(getGeminiModel()).toBe("gemini-2.5-flash");
  });
});
