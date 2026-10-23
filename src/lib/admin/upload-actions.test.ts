import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "@/lib/quiz/quiz.model";
import { confirmUpload, previewUpload, type UploadState } from "./upload-actions";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function uploadForm(fields: { title: string; slug: string }): FormData {
  const form = new FormData();
  form.set("file", new File([readFileSync(MOODLE_FILE)], "moodle_quiz_merged.json"));
  form.set("title", fields.title);
  form.set("slug", fields.slug);
  return form;
}

const emptyState: UploadState = {};

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
