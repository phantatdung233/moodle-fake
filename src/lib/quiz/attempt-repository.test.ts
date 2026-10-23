import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Attempt } from "./attempt.model";
import { Quiz } from "./quiz.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
import {
  answerQuestion,
  getAttemptForStudent,
  getOpenAttempt,
  normalizeStudentId,
  resumeOrStartAttempt,
  revealQuestion,
} from "./attempt-repository";
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

describe("normalizeStudentId", () => {
  it("trims and uppercases an MSSV", () => {
    expect(normalizeStudentId("  b2012345 ")).toBe("B2012345");
    expect(normalizeStudentId("B2012345")).toBe("B2012345");
  });
});

describe("starting an Attempt", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_attempt_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("snapshots every Question of the Quiz and starts in progress", async () => {
    const quizId = await seedQuiz();

    const result = await resumeOrStartAttempt({ quizId, studentId: "b2012345", studentName: " Nguyễn Văn An " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempt).toMatchObject({
      studentId: "B2012345",
      studentName: "Nguyễn Văn An",
      quizSlug: "python-co-ban",
      quizVersion: 1,
      mode: "practice",
      status: "in_progress",
      answers: [],
    });
    expect(result.attempt.questionsSnapshot).toHaveLength(180);
    expect(result.attempt.questionsSnapshot[0].id).toBe("Q001");
  });

  it("resumes the same in-progress Attempt for the same MSSV and Quiz", async () => {
    const quizId = await seedQuiz();

    const first = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "Nguyễn Văn An" });
    const second = await resumeOrStartAttempt({
      quizId,
      studentId: " b2012345 ",
      studentName: "Nguyễn Văn An",
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it("gives two tabs starting at once the same Attempt (unique index race)", async () => {
    const quizId = await seedQuiz();

    const results = await Promise.all([
      resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" }),
      resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" }),
    ]);

    const ids = new Set(results.map((result) => (result.ok ? result.attempt.id : null)));
    expect(ids.size).toBe(1);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it("keeps the snapshot even when the Quiz gains a new version later", async () => {
    const quizId = await seedQuiz();
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error("start failed");

    await Quiz.updateOne(
      { _id: quizId },
      { $set: { version: 2, questions: questions().slice(0, 3) } },
    );

    const reopened = await getAttemptForStudent(started.attempt.id, "B2012345");
    expect(reopened?.quizVersion).toBe(1);
    expect(reopened?.questionsSnapshot).toHaveLength(180);
  });

  it("rejects a blank MSSV or blank name", async () => {
    const quizId = await seedQuiz();

    expect(await resumeOrStartAttempt({ quizId, studentId: "  ", studentName: "An" })).toEqual({
      ok: false,
      error: "Vui lòng nhập MSSV.",
    });
    expect(await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "   " })).toEqual({
      ok: false,
      error: "Vui lòng nhập họ tên.",
    });
    expect(await Attempt.countDocuments()).toBe(0);
  });

  it("rejects a Quiz that does not exist", async () => {
    expect(
      await resumeOrStartAttempt({ quizId: "6a1b2c3d4e5f60718293a4b5", studentId: "B1", studentName: "An" }),
    ).toMatchObject({ ok: false, error: "Không tìm thấy đề." });
  });
});

describe("reading and answering an Attempt", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_attempt_answers_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    quizId = await seedQuiz();
  });

  async function startAs(studentId = "B2012345", studentName = "Nguyễn Văn An") {
    const result = await resumeOrStartAttempt({ quizId, studentId, studentName });
    if (!result.ok) throw new Error(result.error);
    return result.attempt;
  }

  it("returns the Attempt to its own sinh viên", async () => {
    const attempt = await startAs();

    const found = await getAttemptForStudent(attempt.id, "B2012345");

    expect(found?.id).toBe(attempt.id);
  });

  it("refuses the Attempt to another MSSV or a malformed id", async () => {
    const attempt = await startAs();

    expect(await getAttemptForStudent(attempt.id, "B9999999")).toBeNull();
    expect(await getAttemptForStudent("khong-phai-id", "B2012345")).toBeNull();
    expect(await getAttemptForStudent(attempt.id, "b2012345")).toEqual(
      expect.objectContaining({ id: attempt.id }),
    );
  });

  it("persists a multichoice answer before any reveal", async () => {
    const attempt = await startAs();

    const saved = await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["e"],
      blankValues: [],
    });

    expect(saved.ok).toBe(true);
    const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
    expect(reloaded?.answers).toEqual([
      { questionId: "Q001", selectedOptionKeys: ["e"], blankValues: [], revealed: false },
    ]);
  });

  it("overwrites the answer while the Question is still open", async () => {
    const attempt = await startAs();
    const base = { attemptId: attempt.id, studentId: "B2012345", questionId: "Q001" };

    await answerQuestion({ ...base, selectedOptionKeys: ["a"], blankValues: [] });
    await answerQuestion({ ...base, selectedOptionKeys: ["e"], blankValues: [] });

    const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
    expect(reloaded?.answers).toHaveLength(1);
    expect(reloaded?.answers[0].selectedOptionKeys).toEqual(["e"]);
  });

  it("keeps blank values positionally aligned with Question.blanks", async () => {
    const attempt = await startAs();

    await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2012345",
      questionId: "Q031",
      selectedOptionKeys: [],
      blankValues: ["(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)", "(1, 9, 6, 3, 4, 5, 2, 7, 8)"],
    });

    const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
    expect(reloaded?.answers[0]).toMatchObject({
      questionId: "Q031",
      blankValues: ["(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)", "(1, 9, 6, 3, 4, 5, 2, 7, 8)"],
    });
  });

  it("refuses answers from another MSSV", async () => {
    const attempt = await startAs();

    const result = await answerQuestion({
      attemptId: attempt.id,
      studentId: "B9999999",
      questionId: "Q001",
      selectedOptionKeys: ["e"],
      blankValues: [],
    });

    expect(result).toEqual({
      ok: false,
      error: "Bạn không có quyền làm bài này.",
    });
    const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
    expect(reloaded?.answers).toEqual([]);
  });

  it("refuses a Question that is not in this Attempt", async () => {
    const attempt = await startAs();

    const result = await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2012345",
      questionId: "Q999",
      selectedOptionKeys: [],
      blankValues: [],
    });

    expect(result).toMatchObject({ ok: false, error: "Không tìm thấy câu hỏi trong bài." });
  });

  it("rejects a multichoice option key the Question does not have", async () => {
    const attempt = await startAs();

    const result = await answerQuestion({
      attemptId: attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["zz"],
      blankValues: [],
    });

    expect(result).toMatchObject({ ok: false });
  });

  describe("revealing", () => {
    it("grades the answer, stores the result and locks the Question", async () => {
      const attempt = await startAs();
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
        selectedOptionKeys: ["e"],
        blankValues: [],
      });

      const revealed = await revealQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
      });

      expect(revealed.ok).toBe(true);
      if (!revealed.ok) return;
      expect(revealed.feedback).toEqual({
        questionId: "Q001",
        revealed: true,
        correct: true,
        score: 1,
        correctOptionKeys: ["e"],
      });
      const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
      expect(reloaded?.answers[0]).toMatchObject({ revealed: true, graded: { correct: true, score: 1 } });
    });

    it("marks a wrong multichoice answer and names the correct option", async () => {
      const attempt = await startAs();
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
        selectedOptionKeys: ["a"],
        blankValues: [],
      });

      const revealed = await revealQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
      });

      expect(revealed).toMatchObject({
        ok: true,
        feedback: { correct: false, score: 0, correctOptionKeys: ["e"] },
      });
    });

    it("reports each blank of a multianswer Question with what was typed", async () => {
      const attempt = await startAs();
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q031",
        selectedOptionKeys: [],
        blankValues: ["(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)", "sai"],
      });

      const revealed = await revealQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q031",
      });

      expect(revealed.ok).toBe(true);
      if (!revealed.ok) return;
      expect(revealed.feedback).toMatchObject({ correct: false, score: 0.5 });
      expect(revealed.feedback.perBlank).toEqual([
        {
          name: "Q031_blank1",
          value: "(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)",
          acceptedAnswer: "(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)",
          correct: true,
        },
        {
          name: "Q031_blank2",
          value: "sai",
          acceptedAnswer: "(1, 9, 6, 3, 4, 5, 2, 7, 8)",
          correct: false,
        },
      ]);
    });

    it("rejects a later answer change for a revealed Question", async () => {
      const attempt = await startAs();
      await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
        selectedOptionKeys: ["e"],
        blankValues: [],
      });
      await revealQuestion({ attemptId: attempt.id, studentId: "B2012345", questionId: "Q001" });

      const again = await answerQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
        selectedOptionKeys: ["a"],
        blankValues: [],
      });

      expect(again).toEqual({
        ok: false,
        error: "Câu này đã khoá sau khi xem đáp án nên không sửa được nữa.",
      });
      const reloaded = await getAttemptForStudent(attempt.id, "B2012345");
      expect(reloaded?.answers[0].selectedOptionKeys).toEqual(["e"]);
    });

    it("rejects a second reveal of the same Question", async () => {
      const attempt = await startAs();
      await revealQuestion({ attemptId: attempt.id, studentId: "B2012345", questionId: "Q001" });

      const again = await revealQuestion({
        attemptId: attempt.id,
        studentId: "B2012345",
        questionId: "Q001",
      });

      expect(again).toMatchObject({ ok: false });
    });

    it("refuses a reveal from another MSSV", async () => {
      const attempt = await startAs();

      expect(
        await revealQuestion({ attemptId: attempt.id, studentId: "B9999999", questionId: "Q001" }),
      ).toEqual({
        ok: false,
        error: "Bạn không có quyền làm bài này.",
      });
    });
  });

  it("finds the open Attempt for a MSSV and Quiz", async () => {
    const attempt = await startAs();

    expect((await getOpenAttempt(quizId, "B2012345"))?.id).toBe(attempt.id);
    expect(await getOpenAttempt(quizId, "B9999999")).toBeNull();
  });
});
