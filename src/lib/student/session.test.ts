import { describe, expect, it } from "vitest";
import {
  clearedStudentSessionCookie,
  createStudentSessionCookie,
  readStudentSession,
  STUDENT_SESSION_COOKIE,
} from "./session";

const secret = "bi-mat-phien-test";

describe("student identity cookie", () => {
  it("carries the MSSV and attempt id, httpOnly, and is readable back", async () => {
    const cookie = await createStudentSessionCookie(
      { studentId: "B2012345", attemptId: "6a1b2c3d4e5f60718293a4b5" },
      secret,
    );

    expect(cookie.name).toBe(STUDENT_SESSION_COOKIE);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(await readStudentSession(cookie.value, secret)).toEqual({
      studentId: "B2012345",
      attemptId: "6a1b2c3d4e5f60718293a4b5",
    });
  });

  it("is separate from the admin cookie", async () => {
    const { ADMIN_SESSION_COOKIE } = await import("@/lib/admin/session");

    expect(STUDENT_SESSION_COOKIE).not.toBe(ADMIN_SESSION_COOKIE);
  });

  it("refuses a forged, expired or missing cookie", async () => {
    const { signToken } = await import("@/lib/auth/token");
    const cookie = await createStudentSessionCookie(
      { studentId: "B2012345", attemptId: "abc" },
      secret,
    );

    expect(await readStudentSession(undefined, secret)).toBeNull();
    expect(await readStudentSession(`${cookie.value}f`, secret)).toBeNull();
    expect(await readStudentSession(cookie.value, "bi-mat-khac")).toBeNull();

    const stale = await signToken(
      { studentId: "B2012345", attemptId: "abc", iat: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 31 },
      secret,
    );
    expect(await readStudentSession(stale, secret)).toBeNull();
  });

  it("refuses a token that lacks the identity fields", async () => {
    const { signToken } = await import("@/lib/auth/token");
    const now = Math.floor(Date.now() / 1000);

    expect(await readStudentSession(await signToken({ iat: now }, secret), secret)).toBeNull();
    expect(
      await readStudentSession(await signToken({ studentId: "B1", iat: now }, secret), secret),
    ).toBeNull();
  });

  it("clears itself with an empty value and maxAge 0", () => {
    const cookie = clearedStudentSessionCookie();

    expect(cookie.name).toBe(STUDENT_SESSION_COOKIE);
    expect(cookie.value).toBe("");
    expect(cookie.options.maxAge).toBe(0);
  });
});
