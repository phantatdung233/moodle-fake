import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { parseQuizJson } from "../src/lib/quiz/parser";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function readMoodleExport(): unknown {
  try {
    return JSON.parse(readFileSync(MOODLE_FILE, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path.basename(MOODLE_FILE)} không phải JSON hợp lệ.`);
    }
    throw new Error(`Không đọc được file ${path.basename(MOODLE_FILE)}.`);
  }
}

/**
 * `pnpm seed` — reads moodle_quiz_merged.json, runs the Moodle parser and prints
 * the stats the upload preview shows: Questions by type, how many still need the
 * giảng viên's answer, and every Question the parser could not grade.
 *
 * It does not persist a Quiz yet; creating the draft Quiz lands in ticket #4.
 * It does check that MongoDB is reachable, so a broken MONGODB_URI surfaces at
 * seed time rather than on the first page load.
 */
async function main() {
  const { questions, stats, errors } = parseQuizJson(readMoodleExport());

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI chưa được cấu hình. Xem .env.example.");
  }

  console.log(`Đọc ${path.basename(MOODLE_FILE)}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.db?.admin().command({ ping: 1 });
  console.log(`Kết nối MongoDB: OK`);

  console.log("");
  console.log(`Tổng số Question: ${stats.total}`);
  console.log(`  multichoice: ${stats.byType.multichoice}`);
  console.log(`  multianswer: ${stats.byType.multianswer}`);
  console.log(`  needs_review: ${stats.needsReview}`);
  console.log(`  có ô trống không đáp án: ${stats.emptyAnswers}`);
  console.log(`  lỗi parse: ${errors.length}`);

  if (errors.length > 0) {
    console.log("");
    console.log("Câu cần giảng viên duyệt lại:");
    for (const error of errors) {
      console.log(`  ${error.questionId}: ${error.reason}`);
    }
  }

  console.log("");
  console.log(
    `Chưa lưu Quiz nào (tạo đề nháp từ ${questions.length} Question đã parse ở ticket #4).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
