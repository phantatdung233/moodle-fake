import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "./quiz.model";
import { createDraftQuizFromQuestions, getQuizForAdmin, listQuizzes } from "./repository";
import { parseQuizJson } from "./parser";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function moodleExport(): ReturnType<typeof parseQuizJson> {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8")));
}

describe("createDraftQuizFromQuestions", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_repository_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("tạo đề nháp chứa đủ 180 câu từ moodle_quiz_merged.json", async () => {
    const { questions, stats } = moodleExport();

    const created = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions,
    });

    expect(created.ok).toBe(true);

    const quiz = await Quiz.findOne({ slug: "python-co-ban" }).lean();
    expect(quiz?.status).toBe("draft");
    expect(quiz?.mode).toBe("practice");
    expect(quiz?.version).toBe(1);
    expect(quiz?.publishedAt).toBeUndefined();
    expect(quiz?.questions).toHaveLength(180);
    expect(quiz?.questions.filter((q) => q.status === "needs_review")).toHaveLength(
      stats.needsReview,
    );
    // Câu cần duyệt vẫn được lưu, chỉ không được chấm là đã sẵn sàng.
    expect(quiz?.questions.find((q) => q.id === "Q143")?.status).toBe("needs_review");
    expect(quiz?.questions.find((q) => q.id === "Q001")?.status).toBe("ready");
    expect(quiz?.questions.every((q) => q.enabled)).toBe(true);
    expect(quiz?.questions.every((q) => q.hash.length > 0)).toBe(true);
    expect(quiz?.questions.every((q) => q.explanation === undefined)).toBe(true);
  });

  it("upload lại cùng file tạo đề thứ hai và không đụng đề đầu", async () => {
    const first = moodleExport();
    const second = moodleExport();

    const createdFirst = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-lan-1",
      questions: first.questions,
    });
    const createdSecond = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-lan-2",
      questions: second.questions,
    });

    expect(createdFirst.ok && createdSecond.ok).toBe(true);
    expect(await Quiz.countDocuments()).toBe(2);

    const quiz = await Quiz.findOne({ slug: "python-lan-1" }).lean();
    expect(quiz?.questions).toHaveLength(180);
    expect(quiz?.questions.map((q) => q.hash)).toEqual(
      first.questions.map((q) => q.hash),
    );
  });

  it("từ chối slug trùng và không tạo thêm đề", async () => {
    const { questions } = moodleExport();
    await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions,
    });

    const duplicate = await createDraftQuizFromQuestions({
      title: "Python cơ bản (bản 2)",
      slug: "python-co-ban",
      questions,
    });

    expect(duplicate).toEqual({
      ok: false,
      error: "Slug “python-co-ban” đã được dùng cho đề khác. Hãy chọn slug khác.",
    });
    expect(await Quiz.countDocuments()).toBe(1);
  });

  it.each([
    ["", "Slug không được để trống."],
    ["Python Co Ban", "Slug chỉ gồm chữ thường, số và dấu gạch ngang (ví dụ: python-co-ban)."],
    ["-dau-gach", "Slug chỉ gồm chữ thường, số và dấu gạch ngang (ví dụ: python-co-ban)."],
    ["hai--gach", "Slug chỉ gồm chữ thường, số và dấu gạch ngang (ví dụ: python-co-ban)."],
  ])("từ chối slug không hợp lệ %j", async (slug, expectedError) => {
    const { questions } = moodleExport();
    const result = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug,
      questions,
    });

    expect(result).toEqual({ ok: false, error: expectedError });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("từ chối tên đề rỗng", async () => {
    const { questions } = moodleExport();
    const result = await createDraftQuizFromQuestions({
      title: "   ",
      slug: "python-co-ban",
      questions,
    });

    expect(result).toEqual({ ok: false, error: "Tên đề không được để trống." });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("từ chối đề không có câu hỏi nào và không lưu gì", async () => {
    const result = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions: [],
    });

    expect(result).toEqual({
      ok: false,
      error: "File không có câu hỏi nào hợp lệ nên chưa tạo được đề.",
    });
    expect(await Quiz.countDocuments()).toBe(0);
  });

  it("chỉ một trong hai lần tạo đồng thời cùng slug thành công", async () => {
    const { questions } = moodleExport();

    // Both uploads pass the title/slug checks before either insert lands, so
    // only the unique index can keep `/q/<slug>` from being claimed twice.
    const results = await Promise.all([
      createDraftQuizFromQuestions({ title: "Bản A", slug: "dong-thoi", questions }),
      createDraftQuizFromQuestions({ title: "Bản B", slug: "dong-thoi", questions }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: "Slug “dong-thoi” đã được dùng cho đề khác. Hãy chọn slug khác.",
    });
    expect(await Quiz.countDocuments()).toBe(1);
  });
});

describe("listQuizzes", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_list_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("liệt kê mọi đề kèm số câu, số câu sẵn sàng/cần duyệt và số lượt làm", async () => {
    const { questions, stats } = moodleExport();
    await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions,
    });
    await Quiz.create({
      title: "Đề kiểm tra giữa kỳ",
      slug: "giua-ky",
      mode: "exam",
      status: "published",
      questions: questions.slice(0, 3),
    });

    const quizzes = await listQuizzes();

    expect(quizzes).toHaveLength(2);
    const python = quizzes.find((quiz) => quiz.slug === "python-co-ban");
    expect(python).toMatchObject({
      title: "Python cơ bản",
      mode: "practice",
      status: "draft",
      questionCount: 180,
      readyCount: 180 - stats.needsReview,
      needsReviewCount: stats.needsReview,
      attemptCount: 0,
    });

    const midterm = quizzes.find((quiz) => quiz.slug === "giua-ky");
    expect(midterm).toMatchObject({
      mode: "exam",
      status: "published",
      questionCount: 3,
      attemptCount: 0,
    });
    expect((midterm?.readyCount ?? 0) + (midterm?.needsReviewCount ?? 0)).toBe(3);
  });
});

describe("getQuizForAdmin", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_detail_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("trả về tóm tắt của đề theo id, kèm số câu theo loại", async () => {
    const { questions, stats } = moodleExport();
    const created = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions,
    });
    if (!created.ok) throw new Error(created.error);

    const quiz = await getQuizForAdmin(created.quizId);

    expect(quiz).toMatchObject({
      id: created.quizId,
      title: "Python cơ bản",
      slug: "python-co-ban",
      status: "draft",
      mode: "practice",
      version: 1,
      questionCount: 180,
      needsReviewCount: stats.needsReview,
      multichoiceCount: stats.byType.multichoice,
      multianswerCount: stats.byType.multianswer,
      attemptCount: 0,
    });
  });

  it("trả về null khi không có đề hoặc id không hợp lệ", async () => {
    expect(await getQuizForAdmin("6a1b2c3d4e5f60718293a4b5")).toBeNull();
    expect(await getQuizForAdmin("khong-phai-object-id")).toBeNull();
  });
});
