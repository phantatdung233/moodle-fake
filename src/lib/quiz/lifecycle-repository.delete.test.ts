import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "./quiz.model";
import { parseQuizJson } from "./parser";
import { createDraftQuizFromQuestions } from "./repository";
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

  it("xoá hẳn đề nháp", async () => {
    const quizId = await seedQuiz();

    expect(await deleteDraftQuiz(quizId)).toEqual({ ok: true });

    expect(await Quiz.findById(quizId).lean()).toBeNull();
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
