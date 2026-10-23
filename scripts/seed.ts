import path from "node:path";
import mongoose from "mongoose";
import { loadMoodleQuestions, summarizeQuestions } from "../src/lib/quiz/seed-source";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

/**
 * `pnpm seed` — reads moodle_quiz_merged.json, validates its top-level shape and
 * prints how many Questions were parsed, by type.
 *
 * It does not persist a Quiz yet: the real parser and draft Quiz creation land
 * in later tickets. It does check that MongoDB is reachable, so a broken
 * MONGODB_URI surfaces at seed time rather than on the first page load.
 */
async function main() {
  const questions = loadMoodleQuestions(MOODLE_FILE);
  const summary = summarizeQuestions(questions);

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI chưa được cấu hình. Xem .env.example.");
  }

  console.log(`Đọc ${path.basename(MOODLE_FILE)}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.db?.admin().command({ ping: 1 });
  console.log(`Kết nối MongoDB: OK`);

  console.log("");
  console.log(`Tổng số Question: ${summary.total}`);
  console.log(`  multichoice: ${summary.byType.multichoice}`);
  console.log(`  multianswer: ${summary.byType.multianswer}`);
  console.log("");
  console.log("Chưa lưu Quiz nào (parser thật sẽ có ở ticket sau).");
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
