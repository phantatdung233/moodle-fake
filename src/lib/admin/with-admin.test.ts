import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_COOKIE, createAdminSessionCookie } from "./session";
import { NO_SESSION_ERROR } from "./review-messages";
import { withAdmin, withAdminAction } from "./with-admin";

const jar = vi.hoisted(() => ({ admin: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ADMIN_SESSION_COOKIE && jar.admin ? { name, value: jar.admin } : undefined,
  }),
}));

async function signIn(): Promise<void> {
  jar.admin = (await createAdminSessionCookie()).value;
}

describe("withAdminAction", () => {
  beforeEach(() => {
    jar.admin = undefined;
  });

  it("runs the body when the request carries a valid admin session", async () => {
    await signIn();
    const body = vi.fn(async (a: number, b: number) => a + b);

    expect(await withAdminAction(body)(2, 3)).toBe(5);
    expect(body).toHaveBeenCalledWith(2, 3);
  });

  it("refuses without a session, before the body touches anything", async () => {
    const body = vi.fn(async () => "ghi dữ liệu");

    expect(await withAdminAction(body)()).toEqual({ ok: false, error: NO_SESSION_ERROR });
    expect(body).not.toHaveBeenCalled();
  });

  it("turns a thrown error into the generic message, never a stack trace", async () => {
    await signIn();

    const failed = await withAdminAction(async () => {
      throw new Error("MongoServerError: connection refused");
    })();

    expect(failed).toEqual({
      ok: false,
      error: "Không thực hiện được thao tác. Kiểm tra kết nối rồi thử lại.",
    });
  });

  it("lets a body return its own refusal untouched", async () => {
    await signIn();

    expect(
      await withAdminAction(async () => ({ ok: false as const, error: "Đề đã publish rồi." }))(),
    ).toEqual({ ok: false, error: "Đề đã publish rồi." });
  });
});

describe("withAdmin", () => {
  beforeEach(() => {
    jar.admin = undefined;
  });

  it("uses the caller's own refusal shape and keeps the body's type", async () => {
    const body = vi.fn(async () => ({ preview: 180 }));

    const result = await withAdmin(body, () => ({ error: "Hết phiên." }))();

    expect(result).toEqual({ error: "Hết phiên." });
    expect(body).not.toHaveBeenCalled();
  });

  it("still reports a thrown error as `{ ok, error }`", async () => {
    await signIn();

    expect(
      await withAdmin(async () => {
        throw new Error("boom");
      }, () => ({ error: "Hết phiên." }))(),
    ).toEqual({ ok: false, error: "Không thực hiện được thao tác. Kiểm tra kết nối rồi thử lại." });
  });
});
