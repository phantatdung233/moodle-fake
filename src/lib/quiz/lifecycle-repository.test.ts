import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz, type QuizMode } from "./quiz.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
import { SLUG_FORMAT_ERROR } from "./slug";
import {
  archiveQuiz,
  describePublish,
  publishQuiz,
  unpublishQuiz,
  updateQuizSettings,
  saveQuestionSelection,
  ARCHIVED_TERMINAL_ERROR,
  NO_READY_QUESTIONS_ERROR,
  NOT_ARCHIVED_ERROR,
  NOT_DRAFT_ERROR,
  UNPUBLISH_HAS_ATTEMPTS_ERROR,
} from "./lifecycle-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function questions() {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;
}

async function seedQuiz(slug = "python-co-ban"): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: questions(),
  });
  if (!created.ok) throw new Error(created.error);
  return created.quizId;
}

describe("publish", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("cảnh báo trước số câu bị loại và số câu còn lại", async () => {
    const quizId = await seedQuiz();

    const preview = await describePublish(quizId);

    // 180 câu: 100 needs_review bị loại, 80 câu ready còn lại.
    expect(preview).toEqual({ ok: true, readyCount: 80, droppedCount: 100 });
  });

  it("loại câu chưa duyệt và câu đã tắt, đóng băng đề và tăng version", async () => {
    const quizId = await seedQuiz();

    const published = await publishQuiz(quizId);

    expect(published).toEqual({ ok: true, publishedCount: 80, droppedCount: 100 });
    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.status).toBe("published");
    expect(quiz?.version).toBe(2);
    expect(quiz?.publishedAt).toBeInstanceOf(Date);
    // Câu bị loại vẫn nằm trong document (lịch sử/duyệt), chỉ tắt đi.
    expect(quiz?.questions).toHaveLength(180);
    expect(quiz?.questions.filter((question) => question.enabled)).toHaveLength(80);
    expect(
      quiz?.questions
        .filter((question) => question.enabled)
        .every((question) => question.status === "ready"),
    ).toBe(true);
  });
});

describe("draft settings", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_settings_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("sửa tên, slug, chế độ, thời gian và số lần làm khi còn nháp", async () => {
    const quizId = await seedQuiz();

    const saved = await updateQuizSettings(quizId, {
      title: "  Python giữa kỳ ",
      slug: "python-giua-ky",
      mode: "exam",
      timeLimit: 45,
      maxAttempts: 2,
    });

    expect(saved).toEqual({ ok: true });
    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz).toMatchObject({
      title: "Python giữa kỳ",
      slug: "python-giua-ky",
      mode: "exam",
      timeLimit: 45,
      maxAttempts: 2,
      status: "draft",
    });
  });

  it("bỏ timeLimit / maxAttempts khi đổi đề sang luyện tập", async () => {
    const quizId = await seedQuiz();
    await updateQuizSettings(quizId, {
      title: "Python cơ bản",
      slug: "python-co-ban",
      mode: "exam",
      timeLimit: 60,
      maxAttempts: 1,
    });

    await updateQuizSettings(quizId, {
      title: "Python cơ bản",
      slug: "python-co-ban",
      mode: "practice",
      timeLimit: null,
      maxAttempts: null,
    });

    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.mode).toBe("practice");
    expect(quiz?.timeLimit ?? null).toBeNull();
    expect(quiz?.maxAttempts ?? null).toBeNull();
  });

  it("từ chối slug sai định dạng, slug trùng và số câu/thời gian vô lý", async () => {
    const quizId = await seedQuiz();
    await seedQuiz("da-co-roi");

    const base = {
      title: "Python cơ bản",
      slug: "python-co-ban",
      mode: "practice" as QuizMode,
      timeLimit: null,
      maxAttempts: null,
    };

    expect(await updateQuizSettings(quizId, { ...base, slug: "Có Dấu" })).toEqual({
      ok: false,
      error: SLUG_FORMAT_ERROR,
    });
    expect(await updateQuizSettings(quizId, { ...base, slug: "da-co-roi" })).toMatchObject({
      ok: false,
    });
    expect(await updateQuizSettings(quizId, { ...base, title: "   " })).toMatchObject({
      ok: false,
    });
    expect(
      await updateQuizSettings(quizId, { ...base, mode: "exam", timeLimit: 0, maxAttempts: 1 }),
    ).toMatchObject({ ok: false });
    expect(
      await updateQuizSettings(quizId, { ...base, mode: "exam", timeLimit: 30, maxAttempts: 0 }),
    ).toMatchObject({ ok: false });
    expect(await updateQuizSettings(quizId, { ...base, mode: "exam", timeLimit: 30, maxAttempts: 1.5 })).toMatchObject({
      ok: false,
    });

    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz).toMatchObject({ title: "Python cơ bản", slug: "python-co-ban", mode: "practice" });
  });
});

describe("chọn câu cho đề", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_selection_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("bật/tắt từng câu khi đề còn nháp", async () => {
    const quizId = await seedQuiz();

    expect(await saveQuestionSelection(quizId, "Q001", false)).toEqual({ ok: true });
    expect(await saveQuestionSelection(quizId, "Q002", true)).toEqual({ ok: true });

    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.questions.find((question) => question.id === "Q001")?.enabled).toBe(false);
    expect(quiz?.questions.find((question) => question.id === "Q002")?.enabled).toBe(true);
  });

  it("từ chối câu không có trong đề", async () => {
    const quizId = await seedQuiz();

    expect(await saveQuestionSelection(quizId, "Q999", false)).toMatchObject({ ok: false });
  });
});

describe("trạng thái đề đã publish", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_published_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedQuiz();
    const published = await publishQuiz(quizId);
    if (!published.ok) throw new Error(published.error);
  });

  const settings = {
    title: "Đổi tên",
    slug: "slug-moi",
    mode: "practice" as QuizMode,
    timeLimit: null,
    maxAttempts: null,
  };

  it("chặn mọi sửa đổi khi đề đã publish (không chỉ ẩn UI)", async () => {
    expect(await updateQuizSettings(quizId, settings)).toEqual({ ok: false, error: NOT_DRAFT_ERROR });
    expect(await saveQuestionSelection(quizId, "Q001", false)).toEqual({
      ok: false,
      error: NOT_DRAFT_ERROR,
    });
    expect(await publishQuiz(quizId)).toEqual({ ok: false, error: "Đề đã publish rồi." });

    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.title).toBe("Python cơ bản");
    expect(quiz?.slug).toBe("python-co-ban");
  });

  it("huỷ publish được về nháp khi chưa có lượt làm nào", async () => {
    expect(await unpublishQuiz(quizId)).toEqual({ ok: true });

    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.status).toBe("draft");
    expect(quiz?.publishedAt ?? null).toBeNull();
    // Version chỉ tăng khi publish, nên đề nháp vẫn là bản 2 cho tới lần publish sau.
    expect(quiz?.version).toBe(2);
    // Sửa lại được ngay sau khi huỷ publish.
    expect(await updateQuizSettings(quizId, settings)).toEqual({ ok: true });
  });

  it("chặn huỷ publish khi đã có sinh viên làm, chỉ còn archive", async () => {
    const { resumeOrStartAttempt } = await import("./attempt-repository");
    const started = await resumeOrStartAttempt({
      quizId,
      studentId: "B2012345",
      studentName: "Nguyễn Văn An",
    });
    if (!started.ok) throw new Error(started.error);

    expect(await unpublishQuiz(quizId)).toEqual({
      ok: false,
      error: UNPUBLISH_HAS_ATTEMPTS_ERROR,
    });
    expect((await Quiz.findById(quizId).lean())?.status).toBe("published");

    expect(await archiveQuiz(quizId)).toEqual({ ok: true });
    const quiz = await Quiz.findById(quizId).lean();
    expect(quiz?.status).toBe("archived");
  });

  it("archive là trạng thái cuối, không đổi được nữa", async () => {
    expect(await archiveQuiz(quizId)).toEqual({ ok: true });

    expect(await archiveQuiz(quizId)).toEqual({ ok: false, error: "Đề đã lưu trữ rồi." });
    expect(await unpublishQuiz(quizId)).toEqual({ ok: false, error: ARCHIVED_TERMINAL_ERROR });
    expect(await publishQuiz(quizId)).toEqual({ ok: false, error: ARCHIVED_TERMINAL_ERROR });
    expect(await updateQuizSettings(quizId, settings)).toEqual({
      ok: false,
      error: NOT_ARCHIVED_ERROR,
    });
    expect(await saveQuestionSelection(quizId, "Q001", false)).toEqual({
      ok: false,
      error: NOT_ARCHIVED_ERROR,
    });
  });

  it("archive hết các lượt làm vẫn đọc được (dữ liệu cũ giữ nguyên)", async () => {
    const { resumeOrStartAttempt, getAttemptForStudent } = await import("./attempt-repository");
    const started = await resumeOrStartAttempt({
      quizId,
      studentId: "B2012345",
      studentName: "Nguyễn Văn An",
    });
    if (!started.ok) throw new Error(started.error);

    await archiveQuiz(quizId);

    expect(await getAttemptForStudent(started.attempt.id, "B2012345")).not.toBeNull();
  });
});

describe("publish khi không có câu nào sẵn sàng", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_lifecycle_empty_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("chặn publish khi mọi câu đều needs_review hoặc đã tắt", async () => {
    const quizId = await seedQuiz();
    await Quiz.updateOne({ _id: quizId }, { $set: { "questions.$[].status": "needs_review" } });

    expect(await publishQuiz(quizId)).toEqual({ ok: false, error: NO_READY_QUESTIONS_ERROR });
    expect(await describePublish(quizId)).toEqual({ ok: true, readyCount: 0, droppedCount: 180 });
    expect((await Quiz.findById(quizId).lean())?.status).toBe("draft");
  });
});

describe("trang chủ chỉ liệt kê đề đã publish", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_home_listing_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("bỏ đề nháp và đề đã lưu trữ khỏi danh sách cho sinh viên", async () => {
    const { listTestableQuizzes, getQuizBySlug } = await import("./repository");

    const draftId = await seedQuiz("de-nhap");
    const publishedId = await seedQuiz("de-da-publish");
    await publishQuiz(publishedId);
    const archivedId = await seedQuiz("de-luu-tru");
    await publishQuiz(archivedId);
    await archiveQuiz(archivedId);

    const listed = await listTestableQuizzes();

    expect(listed.map((quiz) => quiz.slug)).toEqual(["de-da-publish"]);
    expect(await getQuizBySlug("de-nhap")).toBeNull();
    expect(await getQuizBySlug("de-luu-tru")).toBeNull();
    expect(await getQuizBySlug("de-da-publish")).toMatchObject({ id: publishedId });
    // The draft is still there for the giảng viên.
    expect((await Quiz.findById(draftId).lean())?.status).toBe("draft");
  });
});

describe("dữ liệu cho trang sửa đề", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_settings_view_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("trả về mode, timeLimit, maxAttempts và danh sách câu đã bật/tắt", async () => {
    const { getQuizForAdmin } = await import("./repository");
    const quizId = await seedQuiz();
    await updateQuizSettings(quizId, {
      title: "Python cơ bản",
      slug: "python-co-ban",
      mode: "exam",
      timeLimit: 45,
      maxAttempts: 2,
    });
    await saveQuestionSelection(quizId, "Q001", false);

    const quiz = await getQuizForAdmin(quizId);

    expect(quiz).toMatchObject({ mode: "exam", timeLimit: 45, maxAttempts: 2 });
    expect(quiz?.publishableCount).toBe(79);
    expect(quiz?.enabledNeedsReviewCount).toBe(100);
    expect(quiz?.questions).toHaveLength(180);
    expect(quiz?.questions[0]).toMatchObject({ id: "Q001", enabled: false, status: "ready" });
    expect(quiz?.questions[0].preview.length).toBeGreaterThan(0);
  });
});
