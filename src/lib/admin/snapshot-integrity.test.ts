/**
 * Ticket #9's snapshot promise, end to end through the public seams:
 *
 *   publish v1 → sinh viên starts and answers → the giảng viên cannot edit the
 *   frozen Quiz → a newer version of the paper exists (a re-upload, or an edit
 *   after unpublish) → the old Attempt's review and the sinh viên's summary
 *   still show v1's Question text and v1's explanation.
 *
 * Reads go through `getAttemptDetail` (the giảng viên's page) and
 * `getSummaryForStudent` (the sinh viên's page), never through Mongoose, so the
 * test measures what a browser would actually see.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz, unpublishQuiz } from "@/lib/quiz/lifecycle-repository";
import { saveQuestionAnswer } from "@/lib/quiz/review-repository";
import { Quiz } from "@/lib/quiz/quiz.model";
import {
  answerQuestion,
  getSummaryForStudent,
  resumeOrStartAttempt,
  submitAttempt,
} from "@/lib/quiz/attempt-repository";
import { withRecomputedHash } from "@/lib/quiz/question-hash";
import { saveExplanation } from "@/lib/gemini/cache";
import { listResults, getAttemptDetail } from "@/lib/admin/results-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function firstQuestions(count = 3) {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, count);
}

/** A one-question paper made from a real Moodle Question, so answers are real. */
function singleQuestion() {
  const [question] = firstQuestions(1);
  return [{ ...question, enabled: true, status: "ready" as const }];
}

describe("snapshot integrity after a newer version exists", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_snapshot_integrity_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("publish v1, chặn admin sửa, rồi một đề mới hơn xuất hiện — bài cũ vẫn đọc theo bản v1", async () => {
    // ── v1: a draft the giảng viên answers and publishes ───────────────────────
    const v1 = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions: singleQuestion(),
    });
    if (!v1.ok) throw new Error(v1.error);
    const answered = await saveQuestionAnswer(v1.quizId, "Q001", { selectedOptionKeys: ["e"] });
    if (!answered.ok) throw new Error(answered.error);
    const published = await publishQuiz(v1.quizId);
    if (!published.ok) throw new Error(published.error);

    const v1Question = (await Quiz.findById(v1.quizId).lean())!.questions.find(
      (question) => question.id === "Q001",
    )!;
    const v1Text = v1Question.content;
    const v1Explanation = "Bản v1: sort() là cú pháp đúng để sắp xếp mảng.";
    await saveExplanation({ questionHash: v1Question.hash, questionId: "Q001", text: v1Explanation });

    // ── sinh viên làm trên v1 ─────────────────────────────────────────────────
    const started = await resumeOrStartAttempt({
      quizId: v1.quizId,
      studentId: "B2012345",
      studentName: "An",
    });
    if (!started.ok) throw new Error(started.error);
    expect(started.attempt.questionsSnapshot[0].content).toBe(v1Text);
    expect(started.attempt.questionsSnapshot[0].hash).toBe(v1Question.hash);
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["e"],
      blankValues: [],
    });

    // ── đề đã publish bị đóng băng: không sửa được đáp án ─────────────────────
    expect(await saveQuestionAnswer(v1.quizId, "Q001", { selectedOptionKeys: ["a"] })).toEqual({
      ok: false,
      error: "Đề đã publish nên không sửa được đáp án. Hãy huỷ publish nếu cần sửa.",
    });
    expect(await unpublishQuiz(v1.quizId)).toEqual({
      ok: false,
      error:
        "Đã có sinh viên làm đề này nên không huỷ publish được. Nếu muốn ẩn đề, hãy lưu trữ (archive).",
    });

    // ── Một bản đề mới hơn ra đời ─────────────────────────────────────────────
    // The app's only ways to produce a newer version (spec story 10) are a fresh
    // upload (a separate Quiz) and unpublish → edit → publish (refused here).
    // So the newer version is the same Question with edited content and a new
    // answer, which is exactly what an upload of a corrected file would carry.
    const edited = {
      ...v1Question,
      content: "BẢN MỚI: cú pháp nào sắp xếp mảng giảm dần?",
      options: v1Question.options.map((option) => ({ ...option, correct: option.key === "b" })),
    };
    const v2Question = withRecomputedHash(edited);
    await Quiz.updateOne(
      { _id: v1.quizId },
      {
        $set: { "questions.0.content": v2Question.content, "questions.0.options": v2Question.options },
        $inc: { version: 1 },
      },
    );
    await saveExplanation({
      questionHash: v2Question.hash,
      questionId: "Q001",
      text: "Bản v2: reverse=True sắp xếp giảm dần.",
    });

    // ── bài đang làm dở của sinh viên vẫn là v1 ───────────────────────────────
    const midFlight = await getAttemptDetail(started.attempt.id);
    expect(midFlight?.status).toBe("in_progress");
    expect(midFlight?.questions[0].question.content).toBe(v1Text);
    expect(midFlight?.questions[0].question.content).not.toContain("BẢN MỚI");
    expect(midFlight?.questions[0].question.options.find((option) => option.key === "e")?.correct).toBe(
      true,
    );

    // ── nộp bài: chấm theo v1, không theo v2 ──────────────────────────────────
    const submitted = await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });
    expect(submitted).toMatchObject({ ok: true, status: "submitted" });
    if (!submitted.ok) return;
    expect(submitted.result.total).toBe(100);

    // ── trang chi tiết của giảng viên: nội dung + giải thích của v1 ───────────
    const detail = await getAttemptDetail(started.attempt.id);
    expect(detail?.quizVersion).toBe(2); // the version the Attempt started on
    expect(detail?.questions[0].question.content).toBe(v1Text);
    expect(detail?.questions[0].explanation).toBe(v1Explanation);
    expect(detail?.questions[0].graded).toEqual({ correct: true, score: 1 });

    // ── trang tổng kết của sinh viên: cũng là v1 ──────────────────────────────
    const summary = await getSummaryForStudent(v1.quizId, "B2012345", started.attempt.id);
    expect(summary?.latest?.questionsSnapshot[0].content).toBe(v1Text);
    expect(summary?.latest?.questionsSnapshot[0].hash).toBe(v1Question.hash);
    expect(summary?.latest?.result?.total).toBe(100);

    // ── và bảng kết quả không lẫn hai bản ─────────────────────────────────────
    const results = await listResults({});
    expect(results.rows).toHaveLength(1);
    expect(results.rows[0]).toMatchObject({ attemptId: started.attempt.id, scorePercent: 100 });
  });

  it("tải lại file thành đề mới (slug khác) không đụng đề cũ lẫn lượt làm của nó", async () => {
    const v1 = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban",
      questions: firstQuestions(3),
    });
    if (!v1.ok) throw new Error(v1.error);
    const published = await publishQuiz(v1.quizId);
    if (!published.ok) throw new Error(published.error);

    const started = await resumeOrStartAttempt({
      quizId: v1.quizId,
      studentId: "B1",
      studentName: "An",
    });
    if (!started.ok) throw new Error(started.error);
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });
    const before = await getAttemptDetail(started.attempt.id);

    // "Upload lần nữa tạo đề mới, không ghi đè đề cũ" (spec story 10).
    const v2 = await createDraftQuizFromQuestions({
      title: "Python cơ bản",
      slug: "python-co-ban-v2",
      questions: firstQuestions(3),
    });
    if (!v2.ok) throw new Error(v2.error);
    expect(v2.quizId).not.toBe(v1.quizId);

    const after = await getAttemptDetail(started.attempt.id);
    expect(after?.quizTitle).toBe("Python cơ bản");
    expect(after?.questions.map((entry) => entry.question.content)).toEqual(
      before?.questions.map((entry) => entry.question.content),
    );
  });
});
