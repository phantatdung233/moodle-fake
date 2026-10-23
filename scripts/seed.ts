import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { parseQuizJson } from "../src/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "../src/lib/quiz/repository";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");
const SEED_TITLE = "Python cơ bản";
const SEED_SLUG = "python-co-ban";

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
 * `pnpm seed` — reads moodle_quiz_merged.json, runs the Moodle parser, prints
 * the stats the upload preview shows (Questions by type, how many still need
 * the giảng viên's answer, every Question the parser could not grade) and
 * creates one draft Quiz through the same data layer the admin upload uses, so
 * a fresh checkout has something to open at `/admin`.
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

  // Re-running the seed next to an existing "python-co-ban" picks a free slug
  // instead of failing or overwriting the quiz the giảng viên may be editing.
  const result = await createDraftQuizWithFreeSlug({
    title: SEED_TITLE,
    baseSlug: SEED_SLUG,
    questions,
  });

  console.log("");
  console.log(
    result.ok
      ? `Đã tạo đề nháp "${SEED_TITLE}" tại /admin/quizzes/${result.quizId} (slug /q/${result.slug}).`
      : `Không tạo được đề nháp: ${result.error}`,
  );
  if (!result.ok) process.exitCode = 1;
}

async function createDraftQuizWithFreeSlug(input: {
  title: string;
  baseSlug: string;
  questions: Parameters<typeof createDraftQuizFromQuestions>[0]["questions"];
}) {
  const result = await createDraftQuizFromQuestions({
    title: input.title,
    slug: input.baseSlug,
    questions: input.questions,
  });
  if (result.ok) return result;

  // The seed is idempotent-ish: a taken slug becomes `<base>-2`, `<base>-3`…
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const attempt = await createDraftQuizFromQuestions({
      title: `${input.title} (${suffix})`,
      slug: `${input.baseSlug}-${suffix}`,
      questions: input.questions,
    });
    if (attempt.ok) return attempt;
  }
  return result;
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
