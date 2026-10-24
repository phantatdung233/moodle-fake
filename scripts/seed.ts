import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { parseQuizJson } from "../src/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "../src/lib/quiz/repository";
import { publishQuiz } from "../src/lib/quiz/lifecycle-repository";
import { Quiz } from "../src/lib/quiz/quiz.model";
import { Attempt } from "../src/lib/quiz/attempt.model";

/**
 * `pnpm seed` — every Moodle export in `res/` becomes one published Quiz.
 *
 * Each file is `moodle_quiz_de_<n>.json`: a bare array of Questions, named
 * `Python — Đề <n>` at `/q/python-de-<n>`, opened as a practice Quiz so a sinh
 * viên gets feedback per Question. Publishing switches off whatever the parser
 * flagged for the giảng viên, so a paper is always gradeable.
 *
 * `pnpm seed --reset` first drops every Quiz, Attempt and cached explanation:
 * it wipes the sinh viên's history too, so it is opt-in and prints what it
 * removed.
 */

const RES_DIR = path.resolve(process.cwd(), "res");
const FILE_PATTERN = /^moodle_quiz_de_(\d+)\.json$/;

type ResQuiz = {
  file: string;
  /** The `n` in `moodle_quiz_de_<n>.json`. */
  number: number;
  title: string;
  slug: string;
  raw: unknown;
};

function readResQuizzes(): ResQuiz[] {
  let files: string[];
  try {
    files = readdirSync(RES_DIR);
  } catch {
    throw new Error(`Không đọc được thư mục ${path.basename(RES_DIR)}/.`);
  }

  const quizzes = files
    .map((file) => ({ file, match: FILE_PATTERN.exec(file) }))
    .filter((entry) => entry.match !== null)
    .map(({ file, match }) => {
      const number = Number(match![1]);
      const full = path.join(RES_DIR, file);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(full, "utf8"));
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`${file} không phải JSON hợp lệ.`);
        }
        throw new Error(`Không đọc được file ${file}.`);
      }
      return {
        file,
        number,
        title: `Python — Đề ${number}`,
        slug: `python-de-${number}`,
        raw,
      };
    })
    .sort((a, b) => a.number - b.number);

  if (quizzes.length === 0) {
    throw new Error(`Không tìm thấy file moodle_quiz_de_<n>.json nào trong res/.`);
  }
  return quizzes;
}

/** Drops every Quiz, Attempt and explanation the old data left behind. */
async function resetData(): Promise<void> {
  const [quizzes, attempts, explanations] = await Promise.all([
    Quiz.deleteMany({}),
    Attempt.deleteMany({}),
    // The cache model lives in the AI layer; reach the collection directly so
    // the seed does not depend on its schema just to empty it.
    mongoose.connection.db
      ?.collection("explanationcaches")
      .deleteMany({}),
  ]);
  console.log(
    `Đã xoá: ${quizzes.deletedCount} đề, ${attempts.deletedCount} bài làm, ${explanations?.deletedCount ?? 0} giải thích đã lưu.`,
  );
}

async function seedQuiz(quiz: ResQuiz) {
  const { questions, stats, errors } = parseQuizJson(quiz.raw);

  console.log("");
  console.log(`${quiz.file} → ${quiz.title} (/q/${quiz.slug})`);
  console.log(`  câu hỏi: ${stats.total} (multichoice ${stats.byType.multichoice}, multianswer ${stats.byType.multianswer})`);
  console.log(`  needs_review: ${stats.needsReview} · ô trống không đáp án: ${stats.emptyAnswers}`);
  for (const error of errors) {
    console.log(`  lỗi ${error.questionId}: ${error.reason}`);
  }

  // A reset starts from an empty collection, so the plain slug is free. Without
  // `--reset` a taken slug gets a suffix instead of overwriting a Quiz that may
  // already have Attempts.
  let created = await createDraftQuizFromQuestions({
    title: quiz.title,
    slug: quiz.slug,
    questions,
  });
  for (let suffix = 2; !created.ok && /slug|đã tồn tại/i.test(created.error) && suffix <= 20; suffix += 1) {
    created = await createDraftQuizFromQuestions({
      title: `${quiz.title} (${suffix})`,
      slug: `${quiz.slug}-${suffix}`,
      questions,
    });
  }
  if (!created.ok) {
    console.log(`  KHÔNG tạo được: ${created.error}`);
    return false;
  }

  const published = await publishQuiz(created.quizId);
  if (!published.ok) {
    console.log(`  tạo nháp OK nhưng publish lỗi: ${published.error}`);
    return false;
  }

  console.log(
    `  đã publish: ${published.publishedCount} câu dùng được, ${published.droppedCount} câu bị tắt.`,
  );
  return true;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const quizzes = readResQuizzes();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI chưa được cấu hình. Xem .env.example.");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.db?.admin().command({ ping: 1 });
  console.log("Kết nối MongoDB: OK");

  if (reset) await resetData();

  let failed = 0;
  for (const quiz of quizzes) {
    if (!(await seedQuiz(quiz))) failed += 1;
  }

  console.log("");
  console.log(
    failed === 0
      ? `Xong: ${quizzes.length} đề đã publish.`
      : `Xong nhưng ${failed}/${quizzes.length} đề lỗi.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
