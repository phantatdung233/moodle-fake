/**
 * Cấu hình Gemini phía server.
 *
 * Model đọc từ env `GEMINI_MODEL`, mặc định `gemini-2.5-flash`.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function getGeminiModel(): string {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_GEMINI_MODEL;
}
