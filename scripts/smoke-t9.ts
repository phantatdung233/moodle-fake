/**
 * Throwaway smoke helper for ticket #9. Not part of the app: it drives the real
 * data layer against a throwaway local database so the HTTP-level smoke test
 * can look at `/admin/results` with real rows to filter and export.
 *
 *   pnpm exec tsx scripts/smoke-t9.ts seed
 *   pnpm exec tsx scripts/smoke-t9.ts drop
 */
import mongoose from "mongoose";
import { Quiz } from "../src/lib/quiz/quiz.model";
import { Attempt } from "../src/lib/quiz/attempt.model";
import { parseQuizJson } from "../src/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "../src/lib/quiz/repository";
import { publishQuiz } from "../src/lib/quiz/lifecycle-repository";
import { answerQuestion, resumeOrStartAttempt, submitAttempt } from "../src/lib/quiz/attempt-repository";

const uri = process.env.SMOKE_MONGODB_URI;
if (!uri) throw new Error("SMOKE_MONGODB_URI chưa được đặt");

async function main() {
  await mongoose.connect(uri!, { serverSelectionTimeoutMS: 5_000 });
  const command = process.argv[2];

  if (command === "drop") {
    await mongoose.connection.db?.dropDatabase();
    console.log("Đã xoá database smoke.");
    return;
  }

  // A published practice Quiz and a published exam Quiz.
  const json = parseQuizJson(
    JSON.parse(
      (await import("node:fs")).readFileSync("moodle_quiz_merged.json", "utf8"),
    ),
  );
  const practice = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: "python-co-ban",
    questions: json.questions.slice(0, 3),
  });
  if (!practice.ok) throw new Error(practice.error);
  const exam = await createDraftQuizFromQuestions({
    title: "Kiểm tra giữa kỳ",
    slug: "kiem-tra-giua-ky",
    questions: json.questions.slice(0, 3),
  });
  if (!exam.ok) throw new Error(exam.error);
  await mongoose.connection.db?.collection("quizzes").updateOne(
    { slug: "kiem-tra-giua-ky" },
    { $set: { mode: "exam", timeLimit: 20, maxAttempts: 2 } },
  );
  for (const quizId of [practice.quizId, exam.quizId]) {
    const published = await publishQuiz(quizId);
    if (!published.ok) throw new Error(published.error);
  }

  async function take(quizId: string, studentId: string, name: string, correct: boolean) {
    const started = await resumeOrStartAttempt({ quizId, studentId, studentName: name });
    if (!started.ok) throw new Error(started.error);
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId,
      questionId: "Q001",
      selectedOptionKeys: [correct ? "e" : "a"],
      blankValues: [],
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId });
    return started.attempt.id;
  }

  const an = await take(practice.quizId, "B2012345", "Nguyễn Văn An", true);
  await take(practice.quizId, "B2099999", 'Lê "Bình", lớp 2', false);
  await take(practice.quizId, "B2012345", "Nguyễn Văn An", true); // lượt 2
  await take(exam.quizId, "B2012345", "Nguyễn Văn An", true);
  // One open Attempt, so the table has a "Đang làm" row too.
  await resumeOrStartAttempt({ quizId: practice.quizId, studentId: "B3000001", studentName: "Trần Chi" });

  console.log(`quizzes=${await Quiz.countDocuments()} attempts=${await Attempt.countDocuments()}`);
  console.log(`practiceQuiz=${practice.quizId} examQuiz=${exam.quizId} anAttempt=${an}`);
}

main()
  .catch((error: unknown) => {
    console.error("Smoke seed thất bại:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
