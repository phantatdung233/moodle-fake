import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { parseQuizJson } from "@/lib/quiz/parser";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";
import { questionForExplanation } from "./explanation-question";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function startPracticeAttempt(studentId: string) {
  const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
  const { resumeOrStartAttempt } = await import("@/lib/quiz/attempt-repository");
  const questions = parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;

  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: `python-co-ban-${studentId.toLowerCase()}`,
    questions,
  });
  if (!created.ok) throw new Error(created.error);

  const started = await resumeOrStartAttempt({
    quizId: created.quizId,
    studentId,
    studentName: "Sinh viên Test",
  });
  if (!started.ok) throw new Error(started.error);
  return started.attempt;
}

describe("questionForExplanation", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_explanation_question_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("trả về Question trong snapshot của Attempt kèm câu trả lời đã lưu", async () => {
    const attempt = await startPracticeAttempt("B2000001");
    const { answerQuestion } = await import("@/lib/quiz/attempt-repository");
    await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2000001",
      questionId: "Q144",
      selectedOptionKeys: ["a"],
      blankValues: [],
    });

    const found = await questionForExplanation({
      attemptId: attempt.id,
      studentId: "B2000001",
      questionId: "Q144",
    });

    expect(found).not.toBeNull();
    expect(found?.question.id).toBe("Q144");
    // The hash comes from the server snapshot, never from the browser.
    expect(found?.question.hash).toBe(
      attempt.questionsSnapshot.find((question) => question.id === "Q144")?.hash,
    );
    expect(found?.studentAnswer).toEqual({ selectedOptionKeys: ["a"], blankValues: [] });
  });

  it("từ chối Attempt của sinh viên khác", async () => {
    const attempt = await startPracticeAttempt("B2000002");

    expect(
      await questionForExplanation({
        attemptId: attempt.id,
        studentId: "B9999999",
        questionId: "Q144",
      }),
    ).toBeNull();
  });

  it("trả về null khi câu không có trong bài", async () => {
    const attempt = await startPracticeAttempt("B2000003");

    expect(
      await questionForExplanation({
        attemptId: attempt.id,
        studentId: "B2000003",
        questionId: "Q999",
      }),
    ).toBeNull();
  });

  it("chưa trả lời thì câu trả lời là rỗng, không ném lỗi", async () => {
    const attempt = await startPracticeAttempt("B2000004");

    const found = await questionForExplanation({
      attemptId: attempt.id,
      studentId: "B2000004",
      questionId: "Q144",
    });

    expect(found?.studentAnswer).toEqual({ selectedOptionKeys: [], blankValues: [] });
  });
});
