import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import type { MongoMemoryServer } from "mongodb-memory-server";
import {
  clearTestDatabase,
  reviveIndexBuilds,
  startTestDatabase,
  stopTestDatabase,
} from "@/test/mongo";
import { Quiz } from "@/lib/quiz/quiz.model";

/**
 * Regression: Vitest runs several test files in one worker process, so a later
 * file finds Mongoose already connected and switches database on the same
 * server. Mongoose caches each Model's index build (`init()`) for the whole
 * process, so a build still running when a file finishes can fail against that
 * file's database; its cached rejection then makes `Model.create()` skip
 * indexes for good ("killed by Singularity") and a duplicate slug is accepted.
 * `startTestDatabase` / `clearTestDatabase` must re-arm the build.
 */
describe("test database helpers", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_mongo_helper_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  afterEach(async () => {
    await clearTestDatabase();
  });

  async function duplicateSlugIsRejected(): Promise<void> {
    await Quiz.create({ title: "Đề", slug: "trung-slug", mode: "exam" });
    await expect(Quiz.create({ title: "Đề", slug: "trung-slug", mode: "exam" })).rejects.toThrow(
      /E11000/,
    );
  }

  it("slug duy nhất được bắt ngay ở lần tạo đầu tiên", async () => {
    await duplicateSlugIsRejected();
  });

  it("file test kế tiếp (cùng process) vẫn bắt được đề trùng slug", async () => {
    // The next file's beforeAll: same process, this file's connection still open.
    await startTestDatabase("moodle_quiz_mongo_helper_test_second");
    await clearTestDatabase();
    expect(mongoose.connection.name).toBe("moodle_quiz_mongo_helper_test_second");

    await duplicateSlugIsRejected();
  });

  it("init lại index trên database đang dùng", async () => {
    await clearTestDatabase();
    await reviveIndexBuilds();

    const indexes = await mongoose.connection.db?.collection("quizzes").indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: { slug: 1 }, unique: true })]),
    );
  });

  it("index build chết cùng file trước không làm mất unique index", async () => {
    const quizzes = mongoose.connection.db!.collection("quizzes");
    // Start from a real, unique slug index so a duplicate is refused.
    await quizzes.deleteMany({});
    await quizzes.createIndex({ slug: 1 }, { unique: true });
    await duplicateSlugIsRejected();
    await quizzes.deleteMany({});

    // What Mongoose leaves behind when an index build fails (it was still
    // running when the previous file dropped its database): every Model caches
    // a rejected `init()` promise, so `create` never rebuilds indexes. This is
    // exactly the state the helper has to recover from.
    for (const model of Object.values(mongoose.models)) {
      const cached = Promise.reject(new Error("Index build aborted"));
      cached.catch(() => {});
      (model as unknown as { $init: Promise<void> }).$init = cached;
    }
    await quizzes.dropIndexes();

    // Without the helper the duplicate slips through the missing index...
    const row = { title: "Đề", slug: "trung-slug", questions: [], createdAt: new Date() };
    await quizzes.insertOne({ ...row });
    await quizzes.insertOne({ ...row });
    expect(await quizzes.countDocuments({ slug: "trung-slug" })).toBe(2);

    // ...after it, Mongoose builds the index again on the live connection.
    await clearTestDatabase();
    await Quiz.create({ title: "Đề", slug: "trung-slug", mode: "exam" });
    await expect(
      Quiz.create({ title: "Đề", slug: "trung-slug", mode: "exam" }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
