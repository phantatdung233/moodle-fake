/**
 * Cấu hình nhà cung cấp model phía server.
 *
 * Model đọc từ env `EXPLAIN_MODEL`, mặc định `deepseek-ai/DeepSeek-V4.1-Flash`
 * (River AI). Base URL đọc từ `EXPLAIN_BASE_URL`, mặc định
 * `https://api.river.ai/v1`. Muốn đổi model hoặc nhà cung cấp chỉ cần sửa env,
 * không cần deploy lại code.
 */
export const DEFAULT_EXPLAIN_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

export const DEFAULT_EXPLAIN_BASE_URL = "https://api.river.ai/v1";

export function getExplainModel(): string {
  const fromEnv = process.env.EXPLAIN_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_EXPLAIN_MODEL;
}

export function getExplainBaseUrl(): string {
  const fromEnv = process.env.EXPLAIN_BASE_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return DEFAULT_EXPLAIN_BASE_URL;
}
