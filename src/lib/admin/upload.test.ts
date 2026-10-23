import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "../quiz/quiz.model";
import { previewQuizUpload, createQuizFromUpload } from "./upload";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function moodleUpload(name = "moodle_quiz_merged.json"): File {
  return new File([readFileSync(MOODLE_FILE)], name, { type: "application/json" });
}

describe("previewQuizUpload", () => {
  it("đọc file Moodle và trả về số câu theo loại, số câu cần duyệt và lỗi parse", async () => {
    const preview = await previewQuizUpload(moodleUpload());

    if (!preview.ok) throw new Error(preview.error);
    expect(preview.stats.total).toBe(180);
    expect(preview.stats.byType).toEqual({ multichoice: 161, multianswer: 19 });
    expect(preview.stats.needsReview).toBeGreaterThanOrEqual(88);
    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.errors[0]).toEqual(
      expect.objectContaining({ questionId: expect.any(String), reason: expect.any(String) }),
    );
  });

  it("từ chối file có top-level không phải mảng bằng thông báo tiếng Việt", async () => {
    const file = new File(['{"questions": []}'], "de.json");

    const preview = await previewQuizUpload(file);

    expect(preview).toEqual({
      ok: false,
      error: "File JSON phải là một mảng câu hỏi ở cấp cao nhất, không phải object",
    });
  });

  it("từ chối mảng rỗng bằng thông báo tiếng Việt", async () => {
    expect(await previewQuizUpload(new File(["[]"], "de.json"))).toEqual({
      ok: false,
      error: "File không có câu hỏi nào hợp lệ nên chưa tạo được đề.",
    });
  });

  it("từ chối file không phải JSON hợp lệ", async () => {
    const preview = await previewQuizUpload(new File(["không phải json"], "de.json"));

    expect(preview).toEqual({
      ok: false,
      error: "File không phải JSON hợp lệ. Hãy kiểm tra lại file xuất từ Moodle.",
    });
  });

  it("từ chối file rỗng", async () => {
    expect(await previewQuizUpload(new File([], "de.json"))).toEqual({
      ok: false,
      error: "Hãy chọn một file JSON để tải lên.",
    });
  });

  it("từ chối file lớn hơn 5 MB", async () => {
    const huge = new File(["[" + " ".repeat(5 * 1024 * 1024) + "]"], "de.json");

    expect(await previewQuizUpload(huge)).toEqual({
      ok: false,
      error: "File quá lớn (giới hạn 5 MB).",
    });
  });
});

describe("createQuizFromUpload", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_upload_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("tạo đề nháp với 180 câu từ file upload", async () => {
    const result = await createQuizFromUpload({
      file: moodleUpload(),
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    expect(result).toMatchObject({ ok: true, slug: "python-co-ban" });
    const quiz = await Quiz.findOne({ slug: "python-co-ban" }).lean();
    expect(quiz?.status).toBe("draft");
    expect(quiz?.questions).toHaveLength(180);
  });

  it("không lưu gì khi file top-level không phải mảng", async () => {
    const result = await createQuizFromUpload({
      file: new File(['{"id": "Q001"}'], "de.json"),
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    expect(result.ok).toBe(false);
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("không lưu gì khi file là mảng rỗng", async () => {
    const result = await createQuizFromUpload({
      file: new File(["[]"], "de.json"),
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    expect(result).toEqual({
      ok: false,
      error: "File không có câu hỏi nào hợp lệ nên chưa tạo được đề.",
    });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("không lưu gì khi slug đã tồn tại", async () => {
    await createQuizFromUpload({
      file: moodleUpload(),
      title: "Python cơ bản",
      slug: "python-co-ban",
    });

    const result = await createQuizFromUpload({
      file: moodleUpload(),
      title: "Python cơ bản lần 2",
      slug: "python-co-ban",
    });

    expect(result).toEqual({
      ok: false,
      error: "Slug “python-co-ban” đã được dùng cho đề khác. Hãy chọn slug khác.",
    });
    expect(await Quiz.countDocuments()).toBe(1);
  });
});
