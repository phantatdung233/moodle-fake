import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionCookie,
  isValidAdminPassword,
  readAdminSession,
} from "./session";

const env = { adminPassword: "mat-khau-test", sessionSecret: "bi-mat-phien-test" };

describe("admin login password", () => {
  it("rejects a wrong admin password", () => {
    expect(isValidAdminPassword("sai-mat-khau", env)).toBe(false);
    expect(isValidAdminPassword("", env)).toBe(false);
  });

  it("rejects every password when ADMIN_PASSWORD is not configured", () => {
    expect(
      isValidAdminPassword("", { ...env, adminPassword: undefined }),
    ).toBe(false);
  });

  it("accepts the ADMIN_PASSWORD from the environment", () => {
    expect(isValidAdminPassword("mat-khau-test", env)).toBe(true);
  });
});

describe("admin session cookie", () => {
  it("is httpOnly and survives a round trip through SESSION_SECRET", async () => {
    const cookie = await createAdminSessionCookie(env);

    expect(cookie.name).toBe(ADMIN_SESSION_COOKIE);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.path).toBe("/");
    expect(await readAdminSession(cookie.value, env)).toBe(true);
  });

  it("refuses a tampered or missing cookie", async () => {
    const cookie = await createAdminSessionCookie(env);
    const tampered = `${cookie.value.split(".")[0]}.${"0".repeat(64)}`;

    expect(await readAdminSession(tampered, env)).toBe(false);
    expect(await readAdminSession(cookie.value.split(".")[0], env)).toBe(false);
    expect(await readAdminSession("", env)).toBe(false);
    expect(await readAdminSession(undefined, env)).toBe(false);
  });

  it("refuses a session minted with another SESSION_SECRET", async () => {
    const cookie = await createAdminSessionCookie({
      ...env,
      sessionSecret: "bi-mat-khac",
    });

    expect(await readAdminSession(cookie.value, env)).toBe(false);
  });

  it("cannot mint a session without SESSION_SECRET", async () => {
    await expect(
      createAdminSessionCookie({ ...env, sessionSecret: undefined }),
    ).rejects.toThrow(/SESSION_SECRET/);
  });
});
