import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { MAX_UPLOAD_BYTES } from "./upload-limits";

describe("next.config", () => {
  it("cho phép gửi file JSON tối đa qua server action, không bị chặn ở 1 MB mặc định", () => {
    // Next caps Server Action bodies at 1 MB by default; anything above that is
    // rejected before the upload action runs and shows no Vietnamese message.
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(
      `${MAX_UPLOAD_BYTES / (1024 * 1024)}mb`,
    );
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(1024 * 1024);
  });
});
