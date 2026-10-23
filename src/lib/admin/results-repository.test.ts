/**
 * Seam: the giảng viên's results data layer. Every test reads through it the
 * way `/admin/results` does — plain rows, filters and a reset — never through
 * Mongoose directly, except to arrange an Attempt the UI could not create
 * (a second finished Attempt).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Attempt } from "@/lib/quiz/attempt.model";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import { answerQuestion, resumeOrStartAttempt, submitAttempt } from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

const { listResults, resetStudentAttempts } = await import("./results-repository");

function moodleQuestions(count = 3) {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, count);
}

async function seedPublishedQuiz(slug: string, title = "Python cơ bản"): Promise<string> {
  const created = await createDraftQuizFromQuestions({ title, slug, questions: moodleQuestions() });
  if (!created.ok) throw new Error(created.error);
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

/** Starts and submits one practice Attempt for this MSSV. */
async function takeAttempt(
  quizId: string,
  studentId: string,
  studentName: string,
  correct = true,
): Promise<string> {
  const started = await resumeOrStartAttempt({ quizId, studentId, studentName });
  if (!started.ok) throw new Error(started.error);
  // Q001's correct option key is "e".
  await answerQuestion({
    attemptId: started.attempt.id,
    studentId,
    questionId: "Q001",
    selectedOptionKeys: [correct ? "e" : "a"],
    blankValues: [],
  });
  const submitted = await submitAttempt({ attemptId: started.attempt.id, studentId });
  if (!submitted.ok) throw new Error(submitted.error);
  return started.attempt.id;
}

/** Closes the stored Attempt list newest-first, as the table shows it. */
function studentIds(rows: { studentId: string }[]): string[] {
  return rows.map((row) => row.studentId);
}

describe("listResults", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_repository_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz("python-co-ban");
  });

  it("liệt kê mỗi lượt làm với MSSV, tên, đề, lượt thứ mấy, % điểm và thời gian", async () => {
    const attemptId = await takeAttempt(quizId, "b2012345", "Nguyễn Văn An");

    const page = await listResults({});

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      attemptId,
      studentId: "B2012345",
      studentName: "Nguyễn Văn An",
      quizId,
      quizTitle: "Python cơ bản",
      quizVersion: 2,
      attemptNumber: 1,
      status: "submitted",
      scorePercent: 33.3,
    });
    expect(page.rows[0].startedAt).toBeInstanceOf(Date);
    expect(page.rows[0].submittedAt).toBeInstanceOf(Date);
    expect(page.totalRows).toBe(1);
  });

  it("đánh số lượt theo thứ tự bắt đầu, kể cả lượt thứ hai của cùng sinh viên", async () => {
    await takeAttempt(quizId, "B2012345", "An");
    // The second Attempt is what "Làm lại" creates; a practice Quiz allows it.
    const second = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!second.ok) throw new Error(second.error);

    const page = await listResults({});

    const numbers = page.rows.map((row) => `${row.studentId}#${row.attemptNumber}`);
    // Newest Attempt first, so lượt 2 sits above lượt 1.
    expect(numbers).toEqual(["B2012345#2", "B2012345#1"]);
    expect(page.rows[0]).toMatchObject({ attemptId: second.attempt.id, status: "in_progress" });
  });

  it("lọc theo đề", async () => {
    const otherQuizId = await seedPublishedQuiz("de-khac", "Đề khác");
    await takeAttempt(quizId, "B1", "An");
    await takeAttempt(otherQuizId, "B2", "Bình");

    expect(studentIds((await listResults({ quizId: otherQuizId })).rows)).toEqual(["B2"]);
    expect(studentIds((await listResults({})).rows)).toHaveLength(2);
  });

  it("lọc theo MSSV: đúng hoàn toàn hoặc chứa, không phân biệt hoa thường", async () => {
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(quizId, "B2099999", "Bình");

    expect(studentIds((await listResults({ studentId: "b2012345" })).rows)).toEqual(["B2012345"]);
    expect(studentIds((await listResults({ studentId: "201" })).rows)).toEqual(["B2012345"]);
    expect(studentIds((await listResults({ studentId: "999" })).rows)).toEqual(["B2099999"]);
    expect((await listResults({ studentId: "B0000" })).rows).toEqual([]);
  });

  it("giữ lượt mới nhất trước và chặn số dòng bằng giới hạn", async () => {
    for (const studentId of ["B1", "B2", "B3"]) {
      await takeAttempt(quizId, studentId, studentId);
    }

    const page = await listResults({ limit: 2 });

    expect(studentIds(page.rows)).toEqual(["B3", "B2"]);
    expect(page.totalRows).toBe(3);
    expect(page.truncated).toBe(true);
    expect((await listResults({ limit: 10 })).truncated).toBe(false);
  });

  it("đưa ra danh sách đề để chọn bộ lọc", async () => {
    await seedPublishedQuiz("de-khac", "Đề khác");

    const page = await listResults({});

    expect(page.quizzes.map((quiz) => quiz.title).sort()).toEqual(["Python cơ bản", "Đề khác"]);
  });
});

describe("resetStudentAttempts", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_reset_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz("python-co-ban");
  });

  it("chỉ xoá lượt của một sinh viên cho một đề", async () => {
    const otherQuizId = await seedPublishedQuiz("de-khac", "Đề khác");
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(quizId, "B9999999", "Bình");
    await takeAttempt(otherQuizId, "B2012345", "An");

    const result = await resetStudentAttempts({ quizId, studentId: "b2012345" });

    expect(result).toEqual({ ok: true, deletedCount: 2 });
    expect(await Attempt.countDocuments({ quizId, studentId: "B2012345" })).toBe(0);
    expect(await Attempt.countDocuments({ quizId, studentId: "B9999999" })).toBe(1);
    expect(await Attempt.countDocuments({ quizId: otherQuizId })).toBe(1);
  });

  it("không tìm thấy lượt nào thì báo lỗi và không xoá gì", async () => {
    await takeAttempt(quizId, "B2012345", "An");

    expect(await resetStudentAttempts({ quizId, studentId: "B404" })).toEqual({
      ok: false,
      error: "Không có lượt làm nào của B404 trong đề này.",
    });
    expect(await Attempt.countDocuments({ quizId })).toBe(1);
  });

  it("sau khi reset sinh viên làm lại được từ lượt 1", async () => {
    await takeAttempt(quizId, "B2012345", "An");
    await resetStudentAttempts({ quizId, studentId: "B2012345" });

    await takeAttempt(quizId, "B2012345", "An");
    const page = await listResults({ studentId: "B2012345" });

    expect(page.rows.map((row) => row.attemptNumber)).toEqual([1]);
  });
});
