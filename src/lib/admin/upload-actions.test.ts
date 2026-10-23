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
const { toUploadFilePayload } = await import("@/lib/admin/upload-file");
type UploadState = import("./upload-actions").UploadState;

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function moodleFile(): File {
  return new File([readFileSync(MOODLE_FILE)], "moodle_quiz_merged.json");
}

function moodlePayload() {
  return toUploadFilePayload(moodleFile());
}

function previewForm(): FormData {
  const form = new FormData();
  form.set("file", moodleFile());
  return form;
}

const emptyState: UploadState = {};

/** Puts a valid, signed admin session on the mocked request. */
async function signIn(): Promise<void> {
  const { createAdminSessionCookie } = await import("@/lib/admin/session");
  sessionCookie.value = (await createAdminSessionCookie()).value;
}

describe("admin upload server actions", () => {
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

  it("preview trả về số câu và lỗi parse mà không ghi gì vào DB", async () => {
    const state = await previewUpload(emptyState, previewForm());

    expect(state.preview?.questions).toBe(180);
    expect(state.preview?.byType).toEqual({ multichoice: 161, multianswer: 19 });
    expect(state.preview?.errors.length).toBeGreaterThan(0);
    expect(state.error).toBeUndefined();
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("preview file không phải mảng trả thông báo tiếng Việt thay vì ném lỗi", async () => {
    const form = new FormData();
    form.set("file", new File(['{"questions": []}'], "de.json"));

    const state = await previewUpload(emptyState, form);

    expect(state).toEqual({
      error: "File JSON phải là một mảng câu hỏi ở cấp cao nhất, không phải object",
    });
  });

  it("từ chối tạo đề khi không có phiên admin, kể cả khi middleware bị bỏ qua", async () => {
    const state = await confirmUpload(await moodlePayload(), {
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    expect(state).toMatchObject({
      error: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.",
    });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("tạo đề khi request mang phiên admin hợp lệ", async () => {
    await signIn();

    // Success redirects, so the action rejects instead of returning state.
    await expect(
      confirmUpload(await moodlePayload(), { title: "Python cơ bản", slug: "python-co-ban" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await Quiz.countDocuments({ slug: "python-co-ban" })).toBe(1);
  });

  it("confirm với slug đã dùng trả lỗi tiếng Việt, giữ preview và không ghi thêm", async () => {
    await signIn();
    await Quiz.create({ title: "Cũ", slug: "python-co-ban", mode: "practice" });

    const state = await confirmUpload(await moodlePayload(), {
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    expect(state).toMatchObject({
      error: "Slug “python-co-ban” đã được dùng cho đề khác. Hãy chọn slug khác.",
    });
    // The preview survives the failed confirm so the giảng viên only fixes the slug.
    expect(state && "preview" in state ? state.preview?.questions : undefined).toBe(180);
    expect(await Quiz.countDocuments()).toBe(1);
  });

  it("confirm với tên đề rỗng không tạo đề", async () => {
    await signIn();

    const state = await confirmUpload(await moodlePayload(), { title: "   ", slug: "python-co-ban" });

    expect(state).toMatchObject({ error: "Tên đề không được để trống." });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("lỗi bất ngờ (DB hỏng) → thông báo tiếng Việt, không ném stack trace", async () => {
    await signIn();
    const repository = await import("@/lib/quiz/repository");
    const spy = vi
      .spyOn(repository, "createDraftQuizFromQuestions")
      .mockRejectedValueOnce(new Error("connection refused: mongodb://10.0.0.1"));

    try {
      const state = await confirmUpload(await moodlePayload(), {
        title: "Python cơ bản",
        slug: "python-co-ban",
      });

      expect(state).toEqual({ error: "Không thực hiện được thao tác. Kiểm tra kết nối rồi thử lại." });
    } finally {
      spy.mockRestore();
    }
    expect(await Quiz.countDocuments()).toBe(0);
  });
});
