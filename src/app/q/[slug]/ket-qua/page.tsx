import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Minus, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getQuizForAdmin,
  getQuizBySlugAnyStatus,
  type QuizDetail,
} from "@/lib/quiz/repository";
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import { exhaustedAttemptsError } from "@/lib/quiz/attempt-repository";
import { loadStudent, loadSummary } from "@/lib/student/actions";
import { summaryCounts } from "@/lib/student/exam";
import {
  attemptStatusLabel,
  formatDate,
  formatPercent,
} from "@/lib/admin/result-format";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudentHeader } from "@/components/student-header";
import { cn } from "@/lib/utils";
import { QuestionReview } from "./question-review";
import { QuestionReviewBody } from "./question-review-body";

export const metadata: Metadata = {
  title: "Kết quả bài làm",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function SummaryPage({ params }: Props) {
  const { slug } = await params;

  let quiz: QuizDetail | null;
  try {
    const anyStatus = await getQuizBySlugAnyStatus(slug);
    quiz = anyStatus ? await getQuizForAdmin(anyStatus.id) : null;
  } catch {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
        <StudentHeader actions={<ThemeToggle />} />
        <p className="mt-10 text-sm text-muted-foreground">
          Mất kết nối máy chủ. Thử tải lại trang sau ít phút.
        </p>
      </main>
    );
  }

  if (!quiz) notFound();

  const [student, summary] = await Promise.all([
    loadStudent(),
    loadSummary({ quizId: quiz.id }),
  ]);
  const latest = summary?.latest ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      <StudentHeader
        student={student}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft aria-hidden />
                Danh sách đề
              </Link>
            </Button>
            <ThemeToggle />
          </>
        }
      />

      <header className="mb-6 mt-8">
        <h1 className="text-2xl font-semibold text-balance">
          Kết quả: {quiz.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
          {latest ? ` · ${latest.studentName} (${latest.studentId})` : ""}
        </p>
      </header>

      {!summary || !latest ? (
        <div className="max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>Chưa có bài nào đã nộp</CardTitle>
              <CardDescription>
                {summary
                  ? "Bạn chưa nộp bài nào cho đề này."
                  : "Nhập MSSV và họ tên trước để xem kết quả của mình."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/q/${quiz.slug}`}>Vào làm bài</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <SummaryBody quiz={quiz} attempt={latest} summary={summary} />
      )}
    </main>
  );
}

export function SummaryBody({
  quiz,
  attempt,
  summary,
}: {
  quiz: QuizDetail;
  attempt: AttemptView;
  summary: NonNullable<Awaited<ReturnType<typeof loadSummary>>>;
}) {
  const counts = summaryCounts(attempt);
  const retryBlocked = summary.mode === "exam" && summary.attemptsExhausted;

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="flex flex-col gap-6 lg:sticky lg:top-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <Card className="overflow-hidden rounded-2xl border-b-4 border-b-brand bg-card py-0">
          <div className="flex flex-col gap-1 border-b bg-brand-surface px-5 py-4">
            <span className="text-xs font-medium text-brand-ink">
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-4xl font-semibold tabular-nums text-brand-ink">
                <span className="sr-only">Điểm: </span>
                {formatPercent(counts.scorePercent)}
              </span>
              {attempt.status === "expired" ? (
                <Badge variant="destructive">
                  {attemptStatusLabel("expired")}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {attemptStatusLabel(attempt.status)}
                </Badge>
              )}
            </span>
            {attempt.submittedAt || summary.history.length > 1 ? (
              <span className="text-xs text-brand-ink/80">
                {attempt.submittedAt
                  ? `Nộp lúc ${formatDate(attempt.submittedAt)}`
                  : ""}
                {summary.history.length > 1
                  ? ` · lần ${summary.history.length - summary.history.findIndex((entry) => entry.id === attempt.id)}/${summary.history.length}`
                  : ""}
              </span>
            ) : null}
          </div>
          <CardContent className="pt-4">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Tổng câu" value={counts.total} />
              <Stat label="Đúng" value={counts.correct} tone="correct" />
              <Stat label="Sai" value={counts.incorrect} tone="wrong" />
              <Stat label="Bỏ trống" value={counts.blank} />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              {retryBlocked ? (
                <p className="text-sm text-muted-foreground">
                  {exhaustedAttemptsError(summary.maxAttempts ?? 0)}
                </p>
              ) : summary.canStartNew ? (
                <Button asChild>
                  <Link href={`/q/${quiz.slug}/lam-moi`}>Làm lại</Link>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Đề đã đóng nên không mở lượt mới.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <section
        aria-labelledby="review-heading"
        className="flex flex-col gap-3 lg:col-start-2 lg:row-start-1"
      >
        <h2 id="review-heading" className="text-lg font-semibold">
          Xem lại từng câu
        </h2>
        {attempt.result?.perQuestion.map((grade, index) => {
          const question = attempt.questionsSnapshot.find(
            (candidate) => candidate.id === grade.questionId,
          );
          if (!question) return null;
          const answer = attempt.answers.find(
            (entry) => entry.questionId === grade.questionId,
          );
          return (
            <QuestionReview
              key={grade.questionId}
              attemptId={attempt.id}
              index={index}
              question={question}
              grade={grade}
              selectedOptionKeys={answer?.selectedOptionKeys ?? []}
              blankValues={answer?.blankValues ?? []}
              body={
                <QuestionReviewBody
                  question={question}
                  grade={grade}
                  blankValues={answer?.blankValues ?? []}
                />
              }
            />
          );
        })}
      </section>

      {summary.history.length > 1 ? (
        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-2 lg:col-start-2 lg:row-start-2"
        >
          <h2 id="history-heading" className="text-lg font-semibold">
            Các lần làm trước
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {summary.history
              .filter((entry) => entry.id !== attempt.id)
              .map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3"
                >
                  <span>
                    {formatDate(entry.submittedAt ?? entry.startedAt)} ·{" "}
                    {attemptStatusLabel(entry.status, "short")}
                  </span>
                  <span className="font-medium">
                    {formatPercent(entry.result?.total ?? 0)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "correct" | "wrong";
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border px-3 py-2",
        tone === "correct" && "border-success-border bg-success-surface",
        tone === "wrong" && "border-destructive-border bg-destructive-surface",
      )}
    >
      <dt className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        {tone === "correct" ? (
          <Check aria-hidden="true" className="size-3 text-success" />
        ) : tone === "wrong" ? (
          <X aria-hidden="true" className="size-3 text-destructive" />
        ) : (
          <Minus aria-hidden="true" className="size-3" />
        )}
        {label}
      </dt>
      <dd
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "correct" && "text-success-foreground",
          tone === "wrong" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
