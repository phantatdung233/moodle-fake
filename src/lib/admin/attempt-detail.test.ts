/**
 * Seam: `/admin/results/[attemptId]`'s data. The tests read an Attempt through
 * `getAttemptDetail` the way the giảng viên's page does — every Question, the
 * answer, the correct answer and the score.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "@/lib/quiz/quiz.model";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import {
  answerQuestion,
  resumeOrStartAttempt,
  submitAttempt,
} from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

const { getAttemptDetail } = await import("./results-repository");

function moodleQuestions(count = 3) {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, count);
}

async function seedPublishedQuiz(slug = "python-co-ban"): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: moodleQuestions(),
  });
  if (!created.ok) throw new Error(created.error);
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

describe("getAttemptDetail", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_attempt_detail_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedPublishedQuiz();
  });

  it("hiện từng câu với câu trả lời của sinh viên, đáp án đúng và điểm", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    // Q001's correct key is "e"; "a" is wrong, Q002/Q003 stay blank.
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["a"],
      blankValues: [],
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });

    const detail = await getAttemptDetail(started.attempt.id);

    expect(detail).toMatchObject({
      attemptId: started.attempt.id,
      studentId: "B2012345",
      studentName: "An",
      quizTitle: "Python cơ bản",
      attemptNumber: 1,
      status: "submitted",
      scorePercent: 0,
    });
    expect(detail?.questions).toHaveLength(3);
    const [first, second] = detail!.questions;
    expect(first.question.id).toBe("Q001");
    expect(first.selectedOptionKeys).toEqual(["a"]);
    expect(first.graded).toEqual({ correct: false, score: 0 });
    expect(first.question.options.filter((option) => option.correct).map((option) => option.key)).toEqual([
      "e",
    ]);
    expect(second.question.id).toBe("Q002");
    expect(second.selectedOptionKeys).toEqual([]);
    expect(second.graded).toEqual({ correct: false, score: 0 });
  });

  it("giữ đúng câu trả lời từng ô của câu điền khuyết", async () => {
    // Q031 is the 2-blank multianswer Question; the first 31 Questions include it.
    await clearTestDatabase();
    const created = await createDraftQuizFromQuestions({
      title: "Điền khuyết",
      slug: "dien-khuyet",
      questions: moodleQuestions(31),
    });
    if (!created.ok) throw new Error(created.error);
    const published = await publishQuiz(created.quizId);
    if (!published.ok) throw new Error(published.error);
    const started = await resumeOrStartAttempt({
      quizId: created.quizId,
      studentId: "B1",
      studentName: "An",
    });
    if (!started.ok) throw new Error(started.error);
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId: "B1",
      questionId: "Q031",
      selectedOptionKeys: [],
      blankValues: ["(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)", "sai"],
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });

    const detail = await getAttemptDetail(started.attempt.id);
    const question = detail?.questions.find((entry) => entry.question.id === "Q031");

    expect(question?.blankValues).toEqual([
      "(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)",
      "sai",
    ]);
    expect(question?.graded).toEqual({ correct: false, score: 0.5 });
  });

  it("không kèm giải thích nào: chi tiết lượt làm chỉ có phần chấm", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);

    const detail = await getAttemptDetail(started.attempt.id);

    expect(detail?.questions.every((question) => question.explanation === null)).toBe(true);
  });

  it("trả null cho id không hợp lệ hoặc không tồn tại", async () => {
    expect(await getAttemptDetail("khong-phai-id")).toBeNull();
    expect(await getAttemptDetail("6a1b2c3d4e5f60718293a4b5")).toBeNull();
  });

  it("đọc câu hỏi từ snapshot, không từ Quiz hiện tại", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    const snapshotContent = started.attempt.questionsSnapshot[0].content;

    // Simulate the Quiz being replaced: different content, different answers.
    await Quiz.updateOne(
      { _id: quizId },
      { $set: { "questions.0.content": "Nội dung mới của bản đề sau" } },
    );

    const detail = await getAttemptDetail(started.attempt.id);

    expect(detail?.questions[0].question.content).toBe(snapshotContent);
    expect(detail?.questions[0].question.content).not.toContain("Nội dung mới");
  });
});
