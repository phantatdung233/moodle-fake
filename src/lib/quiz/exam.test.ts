import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Attempt } from "./attempt.model";
import type { QuizMode } from "./quiz.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
import { publishQuiz, updateQuizSettings } from "./lifecycle-repository";
import {
  getSummaryForStudent,
  resumeOrStartAttempt,
  submitAttempt,
} from "./attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function questions() {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;
}

/** A draft Quiz with the first `count` Questions only, so tests are fast. */
async function seedQuiz({
  slug = "python-co-ban",
  mode,
  timeLimit,
  maxAttempts,
}: {
  slug?: string;
  mode?: QuizMode;
  timeLimit?: number | null;
  maxAttempts?: number | null;
} = {}): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: questions().slice(0, 5),
  });
  if (!created.ok) throw new Error(created.error);
  if (mode) {
    const saved = await updateQuizSettings(created.quizId, {
      title: "Python cơ bản",
      slug,
      mode,
      timeLimit: timeLimit ?? null,
      maxAttempts: maxAttempts ?? null,
    });
    if (!saved.ok) throw new Error(saved.error);
  }
  return created.quizId;
}

async function seedPublishedQuiz(options: Parameters<typeof seedQuiz>[0] = {}): Promise<string> {
  const quizId = await seedQuiz(options);
  const published = await publishQuiz(quizId);
  if (!published.ok) throw new Error(published.error);
  return quizId;
}

describe("starting an Attempt only on a published Quiz", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_exam_start_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("từ chối đề nháp và đề đã lưu trữ", async () => {
    const draftId = await seedQuiz({ slug: "con-nhap" });

    expect(
      await resumeOrStartAttempt({ quizId: draftId, studentId: "B1", studentName: "An" }),
    ).toEqual({ ok: false, error: "Đề này chưa mở cho sinh viên làm." });

    const archivedId = await seedPublishedQuiz({ slug: "da-luu-tru" });
    const { archiveQuiz } = await import("./lifecycle-repository");
    await archiveQuiz(archivedId);

    expect(
      await resumeOrStartAttempt({ quizId: archivedId, studentId: "B1", studentName: "An" }),
    ).toEqual({ ok: false, error: "Đề này chưa mở cho sinh viên làm." });
    expect(await Attempt.countDocuments()).toBe(0);
  });

  it("chỉ đưa câu đã bật vào bản chốt của đề đã publish", async () => {
    const quizId = await seedPublishedQuiz();

    const started = await resumeOrStartAttempt({
      quizId,
      studentId: "B1",
      studentName: "An",
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.attempt.questionsSnapshot).toHaveLength(5);
    expect(started.attempt.questionsSnapshot.every((question) => question.enabled)).toBe(true);
  });

  it("đặt deadline = startedAt + timeLimit cho đề kiểm tra", async () => {
    const quizId = await seedPublishedQuiz({ mode: "exam", timeLimit: 30, maxAttempts: 2 });

    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });

    if (!started.ok) throw new Error(started.error);
    expect(started.attempt.mode).toBe("exam");
    expect(started.attempt.deadline).toBeInstanceOf(Date);
    const minutes =
      (started.attempt.deadline!.getTime() - started.attempt.startedAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(30);
  });

  it("chặn lượt làm thứ 3 khi maxAttempts = 2, kèm thông báo tiếng Việt", async () => {
    const quizId = await seedPublishedQuiz({ mode: "exam", timeLimit: 15, maxAttempts: 2 });

    // B1 uses both of their Attempts.
    for (let round = 0; round < 2; round += 1) {
      const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
      if (!started.ok) throw new Error(started.error);
      expect(await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" })).toMatchObject({
        ok: true,
      });
    }

    // Another MSSV still has their own two.
    const other = await resumeOrStartAttempt({ quizId, studentId: "B2", studentName: "Bình" });
    expect(other.ok).toBe(true);

    const third = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });

    expect(third).toEqual({
      ok: false,
      error: "Bạn đã hết 2 lần làm đề này.",
    });
    expect(await Attempt.countDocuments({ quizId, studentId: "B1" })).toBe(2);
  });

  it("vẫn tiếp tục được bài đang làm dù đã hết maxAttempts", async () => {
    const quizId = await seedPublishedQuiz({ mode: "exam", timeLimit: 15, maxAttempts: 1 });

    const first = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!first.ok) throw new Error(first.error);

    const again = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });

    expect(again).toMatchObject({ ok: true, resumed: true });
    if (!again.ok) return;
    expect(again.attempt.id).toBe(first.attempt.id);
  });

  it("đếm luôn lượt đã hết giờ vào maxAttempts", async () => {
    const quizId = await seedPublishedQuiz({ mode: "exam", timeLimit: 15, maxAttempts: 1 });
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await Attempt.updateOne(
      { _id: started.attempt.id },
      { $set: { deadline: new Date(Date.now() - 1000) } },
    );

    expect(await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" })).toMatchObject({
      ok: true,
      status: "expired",
    });
    expect(await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" })).toEqual({
      ok: false,
      error: "Bạn đã hết 1 lần làm đề này.",
    });
  });

  it("đề luyện tập không giới hạn số lần làm", async () => {
    const quizId = await seedPublishedQuiz();

    for (let round = 0; round < 3; round += 1) {
      const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
      if (!started.ok) throw new Error(started.error);
      await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });
    }

    expect(await Attempt.countDocuments({ quizId, studentId: "B1" })).toBe(3);
    expect((await getSummaryForStudent(quizId, "B1"))?.attemptCount).toBe(3);
  });
});

describe("submitting an Attempt", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_submit_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz();
  });

  async function startAs(studentId = "B2012345") {
    const started = await resumeOrStartAttempt({ quizId, studentId, studentName: "Nguyễn Văn An" });
    if (!started.ok) throw new Error(started.error);
    return started.attempt;
  }

  it("chấm một lần, lưu kết quả và tính câu bỏ trống là 0", async () => {
    const attempt = await startAs();
    const { answerQuestion } = await import("./attempt-repository");
    const [first, second] = attempt.questionsSnapshot;
    // Q001 đúng là "e"; Q002 đúng là "c" (xem parser test / dữ liệu Moodle).
    await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2012345",
      questionId: first.id,
      selectedOptionKeys: [first.options.find((option) => option.correct)!.key],
      blankValues: [],
    });
    if (second.type === "multichoice") {
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: second.id,
        selectedOptionKeys: [second.options.find((option) => !option.correct)!.key],
        blankValues: [],
      });
    }

    const submitted = await submitAttempt({ attemptId: attempt.id, studentId: "B2012345" });

    expect(submitted).toMatchObject({ ok: true, status: "submitted" });
    if (!submitted.ok) return;
    // 5 câu: 1 đúng, các câu còn lại 0 → 20%.
    const expectedTotal = second.type === "multichoice" ? 20 : 20;
    expect(submitted.result.total).toBe(expectedTotal);
    expect(submitted.result.perQuestion).toHaveLength(5);

    const reloaded = await getSummaryForStudent(quizId, "B2012345");
    expect(reloaded?.latest).toMatchObject({
      id: attempt.id,
      status: "submitted",
      result: { total: expectedTotal },
    });
    expect(reloaded?.latest?.submittedAt).toBeInstanceOf(Date);
  });

  it("nộp lại không chấm lại và không tạo kết quả thứ hai", async () => {
    const attempt = await startAs();

    const first = await submitAttempt({ attemptId: attempt.id, studentId: "B2012345" });
    if (!first.ok) throw new Error(first.error);
    const second = await submitAttempt({ attemptId: attempt.id, studentId: "B2012345" });

    expect(second).toMatchObject({ ok: true, status: "submitted" });
    if (!second.ok) return;
    expect(second.result).toEqual(first.result);
    expect(await Attempt.countDocuments({ quizId })).toBe(1);
    const stored = await Attempt.findById(attempt.id).lean();
    expect(stored?.result?.total).toBe(first.result.total);
  });

  it("từ chối trả lời sau khi nộp", async () => {
    const attempt = await startAs();
    await submitAttempt({ attemptId: attempt.id, studentId: "B2012345" });

    const { answerQuestion } = await import("./attempt-repository");
    expect(
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: attempt.questionsSnapshot[0].id,
        selectedOptionKeys: ["e"],
        blankValues: [],
      }),
    ).toEqual({ ok: false, error: "Bài đã nộp nên không sửa được câu trả lời nữa." });
  });

  it("bài quá hạn tự nộp với trạng thái expired", async () => {
    const examId = await seedPublishedQuiz({
      slug: "kiem-tra-qua-han",
      mode: "exam",
      timeLimit: 15,
      maxAttempts: 1,
    });
    const started = await resumeOrStartAttempt({ quizId: examId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await Attempt.updateOne(
      { _id: started.attempt.id },
      { $set: { deadline: new Date(Date.now() - 60_000) } },
    );

    const submitted = await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });

    expect(submitted).toMatchObject({ ok: true, status: "expired" });
    const stored = await Attempt.findById(started.attempt.id).lean();
    expect(stored?.status).toBe("expired");
    expect(stored?.result?.total).toBe(0);
    expect(stored?.submittedAt).toBeInstanceOf(Date);
  });

  it("không nộp được bài của người khác", async () => {
    const attempt = await startAs();

    expect(await submitAttempt({ attemptId: attempt.id, studentId: "B9999999" })).toEqual({
      ok: false,
      error: "Bạn không có quyền làm bài này.",
    });
  });
});
