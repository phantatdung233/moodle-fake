import { describe, expect, it, afterEach } from "vitest";

import {
  DEFAULT_EXPLAIN_BASE_URL,
  DEFAULT_EXPLAIN_MODEL,
  getExplainBaseUrl,
  getExplainModel,
} from "./config";

describe("getExplainModel", () => {
  const original = process.env.EXPLAIN_MODEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EXPLAIN_MODEL;
    } else {
      process.env.EXPLAIN_MODEL = original;
    }
  });

  it("mặc định là model DeepSeek của River AI khi không có env", () => {
    delete process.env.EXPLAIN_MODEL;
    expect(DEFAULT_EXPLAIN_MODEL).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
    expect(getExplainModel()).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
  });

  it("đọc model từ env EXPLAIN_MODEL", () => {
    process.env.EXPLAIN_MODEL = "model-khac";
    expect(getExplainModel()).toBe("model-khac");
  });

  it("bỏ qua env rỗng hoặc chỉ có khoảng trắng", () => {
    process.env.EXPLAIN_MODEL = "   ";
    expect(getExplainModel()).toBe(DEFAULT_EXPLAIN_MODEL);
  });
});

describe("getExplainBaseUrl", () => {
  const original = process.env.EXPLAIN_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EXPLAIN_BASE_URL;
    } else {
      process.env.EXPLAIN_BASE_URL = original;
    }
  });

  it("mặc định là endpoint River AI", () => {
    delete process.env.EXPLAIN_BASE_URL;
    expect(DEFAULT_EXPLAIN_BASE_URL).toBe("https://api.river.ai/v1");
    expect(getExplainBaseUrl()).toBe("https://api.river.ai/v1");
  });

  it("đọc base URL từ env và bỏ dấu / ở cuối", () => {
    process.env.EXPLAIN_BASE_URL = "http://localhost:8080/v1/";
    expect(getExplainBaseUrl()).toBe("http://localhost:8080/v1");
  });
});
