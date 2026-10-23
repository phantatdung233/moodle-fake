/**
 * Seam: the CSV export as the giảng viên receives it. The file is built from
 * the same filter as the table, so the tests arrange Attempts, ask for a
 * filter and compare the exact bytes Excel would open.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import { answerQuestion, resumeOrStartAttempt, submitAttempt } from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

const { exportResultsCsv } = await import("./results-csv-export");

async function seedPublishedQuiz(slug: string, title: string): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title,
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 3),
  });
  if (!created.ok) throw new Error(created.error);
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

async function takeAttempt(quizId: string, studentId: string, studentName: string): Promise<void> {
  const started = await resumeOrStartAttempt({ quizId, studentId, studentName });
  if (!started.ok) throw new Error(started.error);
  await answerQuestion({
    attemptId: started.attempt.id,
    studentId,
    questionId: "Q001",
    selectedOptionKeys: ["e"],
    blankValues: [],
  });
  await submitAttempt({ attemptId: started.attempt.id, studentId });
}

describe("exportResultsCsv", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_csv_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz("python-co-ban", 'Python "cơ bản", HK1');
  });

  it("xuất đúng các cột với BOM UTF-8 và dấu phẩy ngăn cách", async () => {
    await takeAttempt(quizId, "B2012345", "Nguyễn Văn An");

    const csv = await exportResultsCsv({});

    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("MSSV,Họ tên,Đề,Lượt,Điểm (%),Trạng thái,Bắt đầu,Nộp bài");
    // The title has a comma and quotes: both must survive a round trip.
    expect(lines[1]).toContain('"Python ""cơ bản"", HK1"');
    // "33,3" is quoted because Vietnamese Excel reads the comma as decimal.
    expect(lines[1]).toMatch(/^B2012345,Nguyễn Văn An,"Python ""cơ bản"", HK1",1,"33,3",Đã nộp,/);
    expect(lines).toHaveLength(3); // header + one row + the trailing empty string
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("chỉ gồm các dòng khớp bộ lọc đang bật", async () => {
    const otherQuizId = await seedPublishedQuiz("de-khac", "Đề khác");
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(otherQuizId, "B9999999", "Bình");

    const byStudent = await exportResultsCsv({ studentId: "b2012345" });
    expect(byStudent).toContain("B2012345");
    expect(byStudent).not.toContain("B9999999");

    const byQuiz = await exportResultsCsv({ quizId: otherQuizId });
    expect(byQuiz).toContain("B9999999");
    expect(byQuiz).not.toContain("B2012345");
  });

  it("để trống điểm và thời gian nộp của lượt đang làm dở", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);

    // The title is quoted, so read the row from the end: status, start, submit.
    const row = (await exportResultsCsv({})).split("\r\n")[1];

    expect(row).toMatch(/^B1,An,/);
    // Score is empty (no "%" in the CSV); "Nộp bài" is the last, empty column.
    expect(row).toContain(',1,,Đang làm,');
    expect(row.endsWith(",")).toBe(true);
    expect(row).not.toContain("%");
  });

  it("giữ nguyên MSSV có số 0 ở đầu, không cho Excel nuốt mất", async () => {
    await takeAttempt(quizId, "0123456", "An");

    expect((await exportResultsCsv({})).split("\r\n")[1]).toMatch(/^0123456,/);
  });
});
