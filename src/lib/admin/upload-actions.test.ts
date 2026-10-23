import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "@/lib/quiz/quiz.model";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** The admin session cookie the current request carries; set per test. */
const sessionCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ADMIN_SESSION_COOKIE && sessionCookie.value
        ? { name, value: sessionCookie.value }
        : undefined,
  }),
}));

/** `revalidatePath` needs Next's request store; tests only care that it runs. */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { confirmUpload, previewUpload } = await import("./upload-actions");
type UploadState = import("./upload-actions").UploadState;

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function uploadForm(fields: { title: string; slug: string }): FormData {
  const form = new FormData();
  form.set("file", new File([readFileSync(MOODLE_FILE)], "moodle_quiz_merged.json"));
  form.set("title", fields.title);
  form.set("slug", fields.slug);
  return form;
}

const emptyState: UploadState = {};

/** Puts a valid, signed admin session on the mocked request. */
async function signIn(): Promise<void> {
  const { createAdminSessionCookie } = await import("@/lib/admin/session");
  sessionCookie.value = (await createAdminSessionCookie()).value;
}

describe("admin upload server action", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_upload_actions_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
    sessionCookie.value = undefined;
  });

  it("từ chối tạo đề khi không có phiên admin, kể cả khi middleware bị bỏ qua", async () => {
    const state = await confirmUpload(
      emptyState,
      uploadForm({ title: "Python cơ bản", slug: "python-co-ban" }),
    );

    expect(state.error).toBe(
      "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.",
    );
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("tạo đề khi request mang phiên admin hợp lệ", async () => {
    await signIn();

    // Success redirects, so the action rejects instead of returning state.
    await expect(
      confirmUpload(emptyState, uploadForm({ title: "Python cơ bản", slug: "python-co-ban" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await Quiz.countDocuments({ slug: "python-co-ban" })).toBe(1);
  });

  it("preview trả về số câu và lỗi parse mà không ghi gì vào DB", async () => {
    const state = await previewUpload(emptyState, uploadForm({ title: "", slug: "" }));

    expect(state.preview?.questions).toBe(180);
    expect(state.preview?.byType).toEqual({ multichoice: 161, multianswer: 19 });
    expect(state.preview?.errors.length).toBeGreaterThan(0);
    expect(state.error).toBeUndefined();
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("confirm với slug đã dùng trả lỗi tiếng Việt thay vì redirect", async () => {
    await signIn();
    await Quiz.create({ title: "Cũ", slug: "python-co-ban", mode: "practice" });

    const state = await confirmUpload(
      emptyState,
      uploadForm({ title: "Python cơ bản", slug: "python-co-ban" }),
    );

    expect(state.error).toBe(
      "Slug “python-co-ban” đã được dùng cho đề khác. Hãy chọn slug khác.",
    );
    // The preview survives the failed confirm so the giảng viên only fixes the slug.
    expect(state.preview?.questions).toBe(180);
    expect(await Quiz.countDocuments()).toBe(1);
  });
});
