import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const { ExplanationCache } = await import("./explanation.model");
const { getCachedExplanation, saveExplanation } = await import("./cache");

describe("ExplanationCache", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_explanation_cache_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    await ExplanationCache.syncIndexes();
  });

  it("trả về null khi hash chưa từng được giải thích", async () => {
    expect(await getCachedExplanation("hash-chua-co")).toBeNull();
  });

  it("lưu giải thích theo questionHash và đọc lại được", async () => {
    await ExplanationCache.create({
      questionHash: "hash-q144",
      questionId: "Q144",
      text: "Đáp án ghi nhận trong đề sai.",
    });

    expect(await getCachedExplanation("hash-q144")).toBe("Đáp án ghi nhận trong đề sai.");
  });

  it("khoá theo hash chứ không theo câu: bản đáp án cũ và mới cùng tồn tại", async () => {
    await saveExplanation({ questionHash: "hash-cu", questionId: "Q144", text: "Bản cũ" });
    await saveExplanation({ questionHash: "hash-moi", questionId: "Q144", text: "Bản mới" });

    expect(await getCachedExplanation("hash-cu")).toBe("Bản cũ");
    expect(await getCachedExplanation("hash-moi")).toBe("Bản mới");
  });

  it("ghi đè chứ không nhân đôi khi cùng hash được lưu lần nữa", async () => {
    await saveExplanation({ questionHash: "hash-1", questionId: "Q001", text: "Cũ" });
    await saveExplanation({ questionHash: "hash-1", questionId: "Q001", text: "Mới" });

    expect(await ExplanationCache.countDocuments({ questionHash: "hash-1" })).toBe(1);
    expect(await getCachedExplanation("hash-1")).toBe("Mới");
  });

  it("bỏ qua chuỗi rỗng: không cache một giải thích không có nội dung", async () => {
    expect(await getCachedExplanation("")).toBeNull();
  });

  it("ghi kèm vào Question.explanation của đề đang dùng hash đó (write-through, Spec)", async () => {
    const { Quiz } = await import("@/lib/quiz/quiz.model");
    const { hashQuestionAnswers } = await import("@/lib/quiz/question-hash");
    const question = {
      id: "Q001",
      no: 1,
      type: "multichoice" as const,
      content: "print('a') in ra gì?",
      options: [
        { key: "a", text: "a", correct: true },
        { key: "b", text: "b", correct: false },
      ],
      blanks: [],
      images: [],
      enabled: true,
      status: "ready" as const,
      hash: "",
    };
    const hash = hashQuestionAnswers(question.content, question.options, question.blanks);
    const quiz = await Quiz.create({
      title: "Đề",
      slug: "de",
      mode: "practice",
      questions: [{ ...question, hash }],
    });

    await saveExplanation({ questionHash: hash, questionId: "Q001", text: "In ra a." });

    expect((await Quiz.findById(quiz._id).lean())?.questions[0].explanation).toBe("In ra a.");
    // A hash no Quiz carries (older answers) still lands in ExplanationCache only.
    await saveExplanation({ questionHash: "hash-khong-co-de", questionId: "Q001", text: "Bản cũ" });
    expect(await getCachedExplanation("hash-khong-co-de")).toBe("Bản cũ");
    expect((await Quiz.findById(quiz._id).lean())?.questions[0].explanation).toBe("In ra a.");
  });
});
