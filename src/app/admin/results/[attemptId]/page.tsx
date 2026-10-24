import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAttemptDetail, type AttemptDetail } from "@/lib/admin/results-repository";
import { attemptStatusLabel, formatDate, formatScoreOutOfTen } from "@/lib/admin/result-format";
import { gradeAnswer } from "@/lib/quiz/grading";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminDatabaseError, AdminHeader } from "@/app/admin/admin-header";
import { QuestionReview } from "@/app/q/[slug]/ket-qua/question-review";
import { QuestionReviewBody } from "@/app/q/[slug]/ket-qua/question-review-body";
import { QuestionReviewFilter } from "@/app/q/[slug]/ket-qua/question-review-filter";

export const metadata: Metadata = {
  title: "Chi tiết lượt làm",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ attemptId: string }> };

export default async function AttemptDetailPage({ params }: Props) {
  const { attemptId } = await params;

  let attempt: AttemptDetail | null;
  try {
    attempt = await getAttemptDetail(attemptId);
  } catch {
    return (
      <main className={adminShell}>
        <AdminHeader active="results" />
        <AdminDatabaseError />
      </main>
    );
  }

  if (!attempt) notFound();

  const open = attempt.status === "in_progress";

  return (
    <main className={adminShell}>
      <AdminHeader active="results" />

      <div className="mx-auto w-full max-w-3xl">
        <nav aria-label="Đường dẫn" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/admin/results"
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Bảng kết quả
          </Link>
          <Link
            href={`/admin/quizzes/${attempt.quizId}`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Xem đề
          </Link>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-balance">
            {attempt.studentName} ({attempt.studentId})
          </h1>
          <p className="text-sm text-muted-foreground">
            {attempt.quizTitle} · bản {attempt.quizVersion} · lượt {attempt.attemptNumber} ·{" "}
            {attempt.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
          </p>
        </header>

      <Card className="rounded-xl bg-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {attempt.scorePercent === null
              ? "Chưa chấm"
              : `Điểm: ${formatScoreOutOfTen(attempt.scorePercent)}`}
            <Badge
              variant={attempt.status === "expired" ? "destructive" : open ? "outline" : "secondary"}
            >
              {attemptStatusLabel(attempt.status)}
            </Badge>
          </CardTitle>
          <CardDescription>
            Bắt đầu {formatDate(attempt.startedAt)}
            {attempt.submittedAt ? ` · nộp ${formatDate(attempt.submittedAt)}` : ""}
            {attempt.deadline ? ` · hạn ${formatDate(attempt.deadline)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {open
              ? "Bài đang làm dở nên chưa có điểm. Dưới đây là câu trả lời đã lưu mới nhất."
              : `${attempt.questions.length} câu, đáp án của bản đề sinh viên đã làm.`}
          </p>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href="/admin/results">Về bảng kết quả</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <section
        aria-labelledby="questions-heading"
        className="mt-6 flex min-w-0 flex-col gap-3"
      >
        <h2 id="questions-heading" className="text-lg font-semibold">
          Từng câu ({attempt.questions.length})
        </h2>
        <QuestionReviewFilter counts={reviewFilterCounts(attempt.questions)}>
          {attempt.questions.map((entry, index) => {
          const answer = {
            questionId: entry.question.id,
            selectedOptionKeys: entry.selectedOptionKeys,
            blankValues: entry.blankValues,
          };
          const grade: AttemptQuestionResult = {
            questionId: entry.question.id,
            ...(entry.graded ?? gradeAnswer(entry.question, answer)),
          };
            const tone = grade.correct
              ? "correct"
              : entry.selectedOptionKeys.length > 0 ||
                  entry.blankValues.some((value) => value.trim() !== "")
                ? "wrong"
                : "blank";
            return (
              <div key={entry.question.id} data-filter-tone={tone}>
                <QuestionReview
                  index={index}
                  question={entry.question}
                  grade={grade}
                  selectedOptionKeys={entry.selectedOptionKeys}
                  blankValues={entry.blankValues}
                  body={
                    <QuestionReviewBody
                      question={entry.question}
                      grade={grade}
                      blankValues={entry.blankValues}
                    />
                  }
                  explanation={open ? undefined : entry.explanation}
                />
              </div>
            );
          })}
        </QuestionReviewFilter>
      </section>
      </div>
    </main>
  );
}

function reviewFilterCounts(
  questions: AttemptDetail["questions"],
): { all: number; correct: number; wrong: number; blank: number } {
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  for (const entry of questions) {
    const grade = entry.graded ?? gradeAnswer(entry.question, {
      selectedOptionKeys: entry.selectedOptionKeys,
      blankValues: entry.blankValues,
    });
    if (grade.correct) correct += 1;
    else if (
      entry.selectedOptionKeys.length > 0 ||
      entry.blankValues.some((value) => value.trim() !== "")
    ) wrong += 1;
    else blank += 1;
  }
  return { all: questions.length, correct, wrong, blank };
}
