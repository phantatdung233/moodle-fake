import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttemptDetail, type AttemptDetail } from "@/lib/admin/results-repository";
import { gradeAnswer } from "@/lib/quiz/grading";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QuestionReview } from "@/app/q/[slug]/ket-qua/question-review";

export const metadata: Metadata = {
  title: "Chi tiết lượt làm",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ attemptId: string }> };

const statusLabels: Record<AttemptDetail["status"], string> = {
  in_progress: "Đang làm",
  submitted: "Đã nộp",
  expired: "Hết giờ — nộp tự động",
};

/**
 * `/admin/results/[attemptId]` — one Attempt as the giảng viên explains it back
 * to the sinh viên: every Question of the paper, what the sinh viên answered,
 * the correct answer, the score and the cached AI explanation.
 *
 * Everything comes from the Attempt's own `questionsSnapshot` (and its hash-keyed
 * explanation cache), so a newer Quiz upload never rewrites an old review
 * (user stories 71–72). An Attempt still in progress has no stored result yet,
 * so its Questions show the saved answers without a verdict.
 *
 * The per-Question card is the same one the sinh viên sees on their summary.
 */
export default async function AttemptDetailPage({ params }: Props) {
  const { attemptId } = await params;

  let attempt: AttemptDetail | null;
  try {
    attempt = await getAttemptDetail(attemptId);
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-destructive">
          Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.
        </p>
      </main>
    );
  }

  if (!attempt) notFound();

  const open = attempt.status === "in_progress";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
      <nav className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/admin/results" className="text-muted-foreground hover:underline">
          ← Bảng kết quả
        </Link>
        <Link
          href={`/admin/quizzes/${attempt.quizId}`}
          className="text-muted-foreground hover:underline"
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

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {attempt.scorePercent === null
              ? "Chưa chấm"
              : `Điểm: ${formatPercent(attempt.scorePercent)}`}
            <Badge
              variant={attempt.status === "expired" ? "destructive" : open ? "outline" : "secondary"}
            >
              {statusLabels[attempt.status]}
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
              ? "Bài đang làm dở nên chưa có điểm. Câu trả lời dưới đây là bản đã lưu mới nhất."
              : `${attempt.questions.length} câu trong bản đề sinh viên đã làm. Đáp án và giải thích là của bản đề đó, kể cả khi giảng viên đã cập nhật đề sau.`}
          </p>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href="/admin/results">Về bảng kết quả</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="questions-heading" className="mt-6 flex flex-col gap-3">
        <h2 id="questions-heading" className="text-lg font-semibold">
          Từng câu ({attempt.questions.length} câu)
        </h2>

        {attempt.questions.map((entry, index) => {
          const answer = {
            questionId: entry.question.id,
            selectedOptionKeys: entry.selectedOptionKeys,
            blankValues: entry.blankValues,
          };
          // The stored grade is the authority after submission; an open Attempt
          // is re-graded live so it still shows per-blank detail.
          const grade: AttemptQuestionResult = {
            questionId: entry.question.id,
            ...(entry.graded ?? gradeAnswer(entry.question, answer)),
          };
          return (
            <QuestionReview
              key={entry.question.id}
              index={index}
              question={entry.question}
              grade={grade}
              selectedOptionKeys={entry.selectedOptionKeys}
              blankValues={entry.blankValues}
              explanation={open ? undefined : entry.explanation}
            />
          );
        })}
      </section>
    </main>
  );
}

function formatPercent(total: number): string {
  return `${total.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}
