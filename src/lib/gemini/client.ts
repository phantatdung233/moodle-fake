/**
 * "Cổng" gọi model: dịch vụ giải thích chỉ biết `ExplainClient`, không biết
 * SDK Gemini. Nhờ vậy test truyền fake client để đếm số lần gọi, còn chạy thật
 * thì `createGeminiClient()` bọc `@google/genai`.
 */
import { GoogleGenAI } from "@google/genai";
import { getGeminiModel } from "./config";

export type ExplainClient = {
  /** Yields the explanation progressively; throws when the model is unreachable. */
  stream(prompt: string): AsyncIterable<string>;
};

/** `GEMINI_API_KEY` is the documented key; the SDK only honours it while `GOOGLE_API_KEY` is unset. */
export function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() ?? "";
}

/**
 * Gemini 2.5 Flash with thinking off: reasoning tokens would only delay the
 * first visible word of a two-sentence explanation. The model id comes from
 * `GEMINI_MODEL` so a project without 2.5 access can switch without a deploy.
 */
export function createGeminiClient(apiKey: string, model = getGeminiModel()): ExplainClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async *stream(prompt) {
      const chunks = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: {
          temperature: 0.4,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      for await (const chunk of chunks) {
        const text = chunk.text;
        if (text) yield text;
      }
    },
  };
}
