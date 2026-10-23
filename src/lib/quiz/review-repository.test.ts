import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "./quiz.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
import {
  findNextQuestionToReview,
  getQuestionForReview,
  getQuizForReview,
  saveQuestionAnswer,
  removeQuestionFromQuiz,
} from "./review-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

/** Seeds the same draft Quiz `pnpm seed` and the upload form create. */
async function seedDraftQuiz(): Promise<string> {
  const { questions } = parseQuizJson(
    JSON.parse(readFileSync(MOODLE_FILE, "utf8")),
  );
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: "python-co-ban",
    questions,
  });
  if (!created.ok) throw new Error(created.error);
  return created.quizId;
}

async function storedQuestion(quizId: string, questionId: string) {
  const quiz = await Quiz.findById(quizId).lean();
  return quiz?.questions.find((question) => question.id === questionId);
}

describe("answer review of a draft Quiz", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_review_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("seed data: câu chưa duyệt đầu tiên là Q046", async () => {
    const quizId = await seedDraftQuiz();

    expect(await findNextQuestionToReview(quizId)).toBe("Q046");
  });

  it("chọn nhiều đáp án đúng cho multichoice: lưu hết, ra khỏi hàng đợi, tiến độ tăng", async () => {
    const quizId = await seedDraftQuiz();
    const before = await getQuizForReview(quizId);
    if (!before) throw new Error("không thấy đề");
    expect(before.reviewQueue).toContain("Q046");
    const progressBefore = before.answeredCount;

    const result = await saveQuestionAnswer(quizId, "Q046", {
      selectedOptionKeys: ["a", "b"],
    });

    expect(result).toEqual({ ok: true, nextQuestionId: expect.any(String) });

    const question = await storedQuestion(quizId, "Q046");
    expect(question?.status).toBe("ready");
    expect(question?.options.filter((option) => option.correct).map((option) => option.key)).toEqual([
      "a",
      "b",
    ]);

    const after = await getQuizForReview(quizId);
    expect(after?.reviewQueue).not.toContain("Q046");
    expect(after?.answeredCount).toBe(progressBefore + 1);
    expect(after?.totalCount).toBe(180);
    expect(await findNextQuestionToReview(quizId)).not.toBe("Q046");
  });

  it("multianswer: lưu đáp án từng ô trống và ra khỏi hàng đợi", async () => {
    const quizId = await seedDraftQuiz();

    const result = await saveQuestionAnswer(quizId, "Q143", {
      blankAnswers: ["while", ":"],
    });

    expect(result.ok).toBe(true);
    const question = await storedQuestion(quizId, "Q143");
    expect(question?.status).toBe("ready");
    expect(question?.blanks.map((blank) => blank.name)).toEqual([
      "Q143_blank1",
      "Q143_blank2",
    ]);
    expect(question?.blanks.map((blank) => blank.acceptedAnswer)).toEqual(["while", ":"]);
    expect((await getQuizForReview(quizId))?.reviewQueue).not.toContain("Q143");
  });

  it("multianswer: từ chối khi còn ô trống và không ghi gì", async () => {
    const quizId = await seedDraftQuiz();
    const before = await storedQuestion(quizId, "Q143");

    const result = await saveQuestionAnswer(quizId, "Q143", {
      blankAnswers: ["while", "   "],
    });

    expect(result).toEqual({
      ok: false,
      error: "Hãy điền đáp án cho tất cả các ô trống.",
    });
    const after = await storedQuestion(quizId, "Q143");
    expect(after?.status).toBe("needs_review");
    expect(after?.blanks.map((blank) => blank.acceptedAnswer)).toEqual(
      before?.blanks.map((blank) => blank.acceptedAnswer),
    );
  });

  it("multichoice: từ chối khi không chọn đáp án nào", async () => {
    const quizId = await seedDraftQuiz();

    const result = await saveQuestionAnswer(quizId, "Q046", { selectedOptionKeys: [] });

    expect(result).toEqual({ ok: false, error: "Hãy chọn ít nhất một đáp án đúng." });
    expect((await storedQuestion(quizId, "Q046"))?.status).toBe("needs_review");
  });

  it("sửa đáp án câu đã duyệt trong đề nháp làm hash đổi", async () => {
    const quizId = await seedDraftQuiz();
    const readyBefore = await storedQuestion(quizId, "Q001");
    expect(readyBefore?.status).toBe("ready");

    const corrected = readyBefore?.options.findIndex((option) => !option.correct) ?? -1;
    const newKey = readyBefore?.options[corrected]?.key;
    if (!newKey) throw new Error("Q001 không có lựa chọn thứ hai");

    const result = await saveQuestionAnswer(quizId, "Q001", {
      selectedOptionKeys: [newKey],
    });

    expect(result.ok).toBe(true);
    const readyAfter = await storedQuestion(quizId, "Q001");
    expect(readyAfter?.status).toBe("ready");
    expect(readyAfter?.options.find((option) => option.correct)?.key).toBe(newKey);
    // Hash không đổi nghĩa: explanation cache theo hash phải thấy đáp án mới.
    expect(readyAfter?.hash).not.toBe(readyBefore?.hash);
    expect(readyAfter?.hash).toHaveLength(64);
  });

  it("xoá câu khỏi đề: enabled = false, không còn trong hàng đợi và không tính tiến độ", async () => {
    const quizId = await seedDraftQuiz();
    const before = await getQuizForReview(quizId);
    if (!before) throw new Error("không thấy đề");

    const result = await removeQuestionFromQuiz(quizId, "Q046");

    expect(result).toEqual({ ok: true, nextQuestionId: expect.any(String) });
    const question = await storedQuestion(quizId, "Q046");
    // History stays: the Question row is kept, only switched off.
    expect(question).toBeDefined();
    expect(question?.enabled).toBe(false);

    const after = await getQuizForReview(quizId);
    expect(after?.reviewQueue).not.toContain("Q046");
    expect(after?.totalCount).toBe(before.totalCount - 1);
    expect(after?.answeredCount).toBe(before.answeredCount);
    expect(await findNextQuestionToReview(quizId)).not.toBe("Q046");
  });

  it("đề đã publish: từ chối lưu đáp án và xoá câu", async () => {
    const quizId = await seedDraftQuiz();
    await Quiz.updateOne({ _id: quizId }, { $set: { status: "published" } });
    const before = await storedQuestion(quizId, "Q046");

    const saved = await saveQuestionAnswer(quizId, "Q046", { selectedOptionKeys: ["a"] });
    const removed = await removeQuestionFromQuiz(quizId, "Q046");

    expect(saved).toEqual({
      ok: false,
      error: "Đề đã publish nên không sửa được đáp án. Hãy huỷ publish nếu cần sửa.",
    });
    expect(removed).toEqual({
      ok: false,
      error: "Đề đã publish nên không sửa được đáp án. Hãy huỷ publish nếu cần sửa.",
    });
    const after = await storedQuestion(quizId, "Q046");
    expect(after?.status).toBe(before?.status);
    expect(after?.enabled).toBe(true);
    expect(after?.hash).toBe(before?.hash);
  });

  it("đọc một câu để hiển thị: đủ nội dung, lựa chọn, ô trống, ảnh", async () => {
    const quizId = await seedDraftQuiz();

    const question = await getQuestionForReview(quizId, "Q046");

    expect(question).toMatchObject({
      id: "Q046",
      no: 46,
      type: "multichoice",
      status: "needs_review",
      enabled: true,
    });
    expect(question?.content).toContain("Copies trong numpy");
    expect(question?.options.map((option) => option.key)).toEqual(["a", "b"]);
    expect(question?.blanks).toEqual([]);
    expect(question?.images).toEqual([]);

    const withImage = await getQuestionForReview(quizId, "Q020");
    expect(withImage?.images).toHaveLength(1);

    const multianswer = await getQuestionForReview(quizId, "Q143");
    expect(multianswer?.blanks).toEqual([
      { name: "Q143_blank1", acceptedAnswer: "fruits[0]" },
      { name: "Q143_blank2", acceptedAnswer: "\"kiwi\"" },
    ]);
  });

  it("đọc một câu: null khi đề/câu không tồn tại, hoặc câu đã bị xoá khỏi đề", async () => {
    const quizId = await seedDraftQuiz();
    await removeQuestionFromQuiz(quizId, "Q047");

    expect(await getQuestionForReview(quizId, "Q047")).toBeNull();
    expect(await getQuestionForReview(quizId, "Q999")).toBeNull();
    expect(await getQuestionForReview("khong-phai-object-id", "Q046")).toBeNull();
    expect(await getQuestionForReview("6a1b2c3d4e5f60718293a4b5", "Q046")).toBeNull();
  });
});
