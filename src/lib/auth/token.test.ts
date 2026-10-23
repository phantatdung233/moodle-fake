import { describe, expect, it } from "vitest";
import { isWithinMaxAge, issuedAtSeconds, readToken, signToken } from "./token";

const secret = "bi-mat-phien-test";

describe("signed tokens", () => {
  it("round-trips the payload it was signed with", async () => {
    const token = await signToken({ studentId: "B2012345", attemptId: "abc" }, secret);

    expect(await readToken(token, secret)).toEqual({
      studentId: "B2012345",
      attemptId: "abc",
    });
  });

  it("keeps non-ASCII payload values intact", async () => {
    const token = await signToken({ studentName: "Nguyễn Văn An" }, secret);

    expect(await readToken(token, secret)).toMatchObject({
      studentName: "Nguyễn Văn An",
    });
  });

  it("refuses a tampered payload, a missing token and a wrong secret", async () => {
    const token = await signToken({ studentId: "B2012345" }, secret);
    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ studentId: "B9999999" }))
      .toString("base64url");

    expect(await readToken(`${forgedPayload}.${signature}`, secret)).toBeNull();
    expect(await readToken(`${payload}.${"0".repeat(64)}`, secret)).toBeNull();
    expect(await readToken(payload, secret)).toBeNull();
    expect(await readToken(undefined, secret)).toBeNull();
    expect(await readToken(token, "bi-mat-khac")).toBeNull();
  });

  it("refuses a payload that is not a JSON object", async () => {
    expect(await readToken(await signToken("chuoi", secret), secret)).toBeNull();
    expect(await readToken(await signToken([1, 2], secret), secret)).toBeNull();
  });

  it("cannot mint a token without a secret", async () => {
    await expect(signToken({}, "")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("reads the issue time and expires a stale token", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 100;
    const payload = await readToken(await signToken({ iat: issuedAt }, secret), secret);

    expect(issuedAtSeconds(payload ?? {})).toBe(issuedAt);
    expect(isWithinMaxAge(issuedAt, 200)).toBe(true);
    expect(isWithinMaxAge(issuedAt, 50)).toBe(false);
    expect(isWithinMaxAge(issuedAt + 10_000, 200)).toBe(false);
    expect(isWithinMaxAge(null, 200)).toBe(false);
  });
});
