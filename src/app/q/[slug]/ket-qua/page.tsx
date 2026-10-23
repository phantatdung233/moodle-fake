import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getQuizForAdmin,
  getQuizBySlugAnyStatus,
  type QuizDetail,
} from "@/lib/quiz/repository";
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import { exhaustedAttemptsError } from "@/lib/quiz/attempt-repository";
import { loadSummary } from "@/lib/student/actions";
import { summaryCounts } from "@/lib/student/exam";
import { attemptStatusLabel, formatDate, formatPercent } from "@/lib/admin/result-format";
import { QuestionReview } from "./question-review";

export const metadata: Metadata = {
  title: "Kết quả bài làm",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * `/q/<slug>/ket-qua` — the sinh viên's own summary after submitting.
 *
 * Identity comes from the signed httpOnly cookie, never the URL: only this
 * browser's Attempts for this Quiz are read, so editing the address cannot
 * reveal another sinh viên's paper (Spec, user story 58).
 */
export default async function SummaryPage({ params }: Props) {
  const { slug } = await params;

  let quiz: QuizDetail | null;
  try {
    // A published Quiz is listed for students; a draft or archived one still
    // resolves so an old Attempt stays readable (Spec, user story 31). The
    // page only ever shows this browser's own Attempts.
    const anyStatus = await getQuizBySlugAnyStatus(slug);
    quiz = anyStatus ? await getQuizForAdmin(anyStatus.id) : null;
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-destructive">
          Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.
        </p>
      </main>
    );
  }

  // `getQuizForAdmin` returns null for a malformed id, so a bad slug would
  // notFound() anyway; listing keeps that one call out of the render path.
  if (!quiz) notFound();

  const summary = await loadSummary({ quizId: quiz.id });
  const latest = summary?.latest ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
      <nav className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:underline">
          ← Danh sách đề
        </Link>
        <Link href={`/q/${quiz.slug}`} className="text-muted-foreground hover:underline">
          Về trang làm bài
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Kết quả: {quiz.title}</h1>
        <p className="text-sm text-muted-foreground">
          {quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
          {latest ? ` · ${latest.studentName} (${latest.studentId})` : ""}
        </p>
      </header>

      {!summary || !latest ? (
        <Card>
          <CardHeader>
            <CardTitle>Chưa có bài nào đã nộp</CardTitle>
            <CardDescription>
              {summary
                ? "Bạn chưa nộp bài nào cho đề này. Vào làm bài để bắt đầu."
                : "Nhập MSSV và họ tên ở trang làm bài để xem kết quả của mình."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/q/${quiz.slug}`}>Vào làm bài</Link>
            </Button>
          </CardContent>
        </Card>
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Điểm: {formatPercent(counts.scorePercent)}
            {attempt.status === "expired" ? (
              <Badge variant="destructive">{attemptStatusLabel("expired")}</Badge>
            ) : (
              <Badge variant="secondary">{attemptStatusLabel(attempt.status)}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {attempt.submittedAt
              ? `Nộp lúc ${formatDate(attempt.submittedAt)}`
              : "Bài đã được chấm."}
            {summary.history.length > 1
              ? ` · ${attemptStatusLabel(attempt.status, "short")} ${summary.history.length - summary.history.findIndex((entry) => entry.id === attempt.id)}/${summary.history.length}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
                <Link href={`/q/${quiz.slug}`}>Làm lại</Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Đề đã đóng nên không mở lượt làm mới. Bài cũ vẫn xem lại được.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="review-heading" className="flex flex-col gap-3">
        <h2 id="review-heading" className="text-lg font-semibold">
          Xem lại từng câu ({counts.total} câu)
        </h2>
        {attempt.result?.perQuestion.map((grade, index) => {
          const question = attempt.questionsSnapshot.find(
            (candidate) => candidate.id === grade.questionId,
          );
          if (!question) return null;
          const answer = attempt.answers.find((entry) => entry.questionId === grade.questionId);
          return (
            <QuestionReview
              key={grade.questionId}
              index={index}
              question={question}
              grade={grade}
              selectedOptionKeys={answer?.selectedOptionKeys ?? []}
              blankValues={answer?.blankValues ?? []}
            />
          );
        })}
      </section>

      {summary.history.length > 1 ? (
        <section aria-labelledby="history-heading" className="flex flex-col gap-2">
          <h2 id="history-heading" className="text-lg font-semibold">
            Các lần làm trước
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {summary.history
              .filter((entry) => entry.id !== attempt.id)
              .map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3">
                  <span>
                    {formatDate(entry.submittedAt ?? entry.startedAt)} ·{" "}
                    {attemptStatusLabel(entry.status, "short")}
                  </span>
                  <span className="font-medium">{formatPercent(entry.result?.total ?? 0)}</span>
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
    <div className="flex flex-col rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === "correct"
            ? "text-lg font-semibold text-emerald-700"
            : tone === "wrong"
              ? "text-lg font-semibold text-destructive"
              : "text-lg font-semibold"
        }
      >
        {value}
      </dd>
    </div>
  );
}
