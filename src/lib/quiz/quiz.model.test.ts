import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { Quiz } from "./quiz.model";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** Waits for Mongoose's background index builds before a test asserts on uniqueness. */
async function ensureIndexes(): Promise<void> {
  await Promise.all([Quiz.init()]);
}

describe("Quiz model", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    // Its own database: the default `test` database is shared with
    // repository.test.ts, whose `clearTestDatabase` would drop this file's
    // collections (and with them the unique slug index) mid-test.
    server = await startTestDatabase("moodle_quiz_model_test");
  });

  afterAll(async () => {
    await stopTestDatabase(server);
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("stores a draft Quiz whose Questions embed options and blanks", async () => {
    await ensureIndexes();
    await Quiz.create({
      title: "Python cơ bản",
      slug: "python-co-ban",
      mode: "practice",
      questions: [
        {
          id: "Q001",
          no: 1,
          type: "multichoice",
          content: "Cú pháp sắp xếp mảng là?",
          options: [
            { key: "a", text: "orderby()", correct: false },
            { key: "b", text: "sort()", correct: true },
          ],
          hash: "abc",
        },
        {
          id: "Q010",
          no: 10,
          type: "multianswer",
          content: "Điền vào [[1]]",
          blanks: [{ name: "1", acceptedAnswer: "while:" }],
          hash: "def",
        },
      ],
    });

    const quiz = await Quiz.findOne({ slug: "python-co-ban" }).lean();

    expect(quiz?.status).toBe("draft");
    expect(quiz?.version).toBe(1);
    expect(quiz?.questions).toHaveLength(2);
    expect(quiz?.questions[0].options.find((option) => option.correct)?.text).toBe("sort()");
    expect(quiz?.questions[1].blanks[0].acceptedAnswer).toBe("while:");
    // A Question without a reviewed answer is not ready for a published Quiz.
    expect(quiz?.questions[0].status).toBe("needs_review");
  });

  it("refuses two Quizzes with the same slug", async () => {
    const base = { title: "Đề", slug: "trung-slug", mode: "exam" as const };
    await Quiz.create(base);
    // Mongoose builds indexes in the background; wait for them so the second
    // insert races the unique index itself, not its creation.
    await ensureIndexes();
    await expect(Quiz.create(base)).rejects.toThrow();
  });
});
