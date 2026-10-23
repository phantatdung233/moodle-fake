import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "./quiz.model";
import { ExplanationCache } from "@/lib/gemini/explanation.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
import { hashQuestionAnswers } from "./question-hash";
import {
  archiveQuiz,
  deleteDraftQuiz,
  DELETE_NOT_DRAFT_ERROR,
  publishQuiz,
  QUIZ_NOT_FOUND_ERROR,
} from "./lifecycle-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedQuiz(slug = "python-co-ban"): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 5),
  });
  if (!created.ok) throw new Error(created.error);
  return created.quizId;
}

describe("xoá đề nháp", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_delete_draft_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("xoá hẳn đề nháp cùng giải thích đã cache", async () => {
    const quizId = await seedQuiz();
    const quiz = await Quiz.findById(quizId).lean();
    const hash = quiz?.questions[0]?.hash;
    if (!hash) throw new Error("missing hash");
    await ExplanationCache.create({ questionHash: hash, questionId: quiz.questions[0].id, text: "x" });

    expect(await deleteDraftQuiz(quizId)).toEqual({ ok: true });

    expect(await Quiz.findById(quizId).lean()).toBeNull();
    expect(await ExplanationCache.countDocuments({ questionHash: hash })).toBe(0);
  });

  it("chỉ xoá giải thích của đúng đề bị xoá", async () => {
    // Two drafts share every Question hash; the explanation is per hash, so the
    // kept draft must keep its cache entry even though the id matches too.
    const doomedId = await seedQuiz("de-xoa");
    const keptId = await seedQuiz("de-giu");
    const doomed = await Quiz.findById(doomedId).lean();
    const kept = await Quiz.findById(keptId).lean();
    if (!doomed || !kept) throw new Error("missing quiz");
    const sharedHash = doomed.questions[0].hash;
    const ownHash = hashQuestionAnswers("Câu riêng của đề được giữ", [], []);
    await Quiz.updateOne({ _id: keptId, "questions.id": kept.questions[0].id }, { $set: { "questions.$.hash": ownHash } });
    await ExplanationCache.create({
      questionHash: sharedHash,
      questionId: kept.questions[0].id,
      text: "của đề bị xoá",
    });
    await ExplanationCache.create({
      questionHash: ownHash,
      questionId: kept.questions[0].id,
      text: "của đề được giữ",
    });

    expect(await deleteDraftQuiz(doomedId)).toEqual({ ok: true });

    expect(await Quiz.findById(keptId).lean()).not.toBeNull();
    expect(await ExplanationCache.countDocuments({})).toBe(1);
    expect((await ExplanationCache.findOne({}).lean())?.text).toBe("của đề được giữ");
  });

  it("từ chối xoá đề đã publish hoặc đã lưu trữ", async () => {
    const publishedId = await seedQuiz("de-publish");
    const published = await publishQuiz(publishedId);
    if (!published.ok) throw new Error(published.error);
    expect(await deleteDraftQuiz(publishedId)).toEqual({ ok: false, error: DELETE_NOT_DRAFT_ERROR });
    expect(await Quiz.findById(publishedId).lean()).not.toBeNull();

    const archivedId = await seedQuiz("de-luu-tru");
    const archived = await publishQuiz(archivedId);
    if (!archived.ok) throw new Error(archived.error);
    await archiveQuiz(archivedId);
    expect(await deleteDraftQuiz(archivedId)).toEqual({ ok: false, error: DELETE_NOT_DRAFT_ERROR });
    expect(await Quiz.findById(archivedId).lean()).not.toBeNull();
  });

  it("đề không tồn tại hoặc id sai định dạng thì báo không tìm thấy", async () => {
    expect(await deleteDraftQuiz("khong-phai-object-id")).toEqual({
      ok: false,
      error: QUIZ_NOT_FOUND_ERROR,
    });
    expect(await deleteDraftQuiz("0123456789abcdef01234567")).toEqual({
      ok: false,
      error: QUIZ_NOT_FOUND_ERROR,
    });
  });
});
