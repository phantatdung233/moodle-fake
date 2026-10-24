import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudentHeader } from "@/components/student-header";
import { getQuizBySlug } from "@/lib/quiz/repository";
import { exhaustedAttemptsError } from "@/lib/quiz/attempt-repository";
import {
  loadAttempt,
  loadOwnedAttempt,
  loadStudent,
  loadSummary,
  startAttempt,
} from "@/lib/student/actions";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import {
  prepareQuestionContent,
  type RenderedQuestionContent,
} from "@/components/quiz/question-blocks";
import { IdentityForm } from "./identity-form";

export const metadata: Metadata = {
  title: "Làm bài",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * Every snapshot Question's body, parsed and highlighted on the server so the
 * client runner receives finished blocks (a client component cannot await
 * shiki while it renders).
 */
async function questionBodiesOf(
  attempt: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>,
): Promise<Record<string, RenderedQuestionContent[]>> {
  const entries = await Promise.all(
    attempt.questionsSnapshot.map(
      async (question) =>
        [
          question.id,
          await prepareQuestionContent(
            question.content,
            question.blanks.length,
          ),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * `/q/<slug>`: the quiz-taking screen while an Attempt is open, the summary
 * when the Attempt is already submitted, and the identity form only when this
 * browser has no identity at all. A student who entered MSSV on the home page
 * gets the paper opened for them (`startAttempt`) — identity is asked once, not
 * per Quiz. Resuming is keyed by the student cookie, never by a URL parameter,
 * so one sinh viên cannot open another's Attempt by editing the address.
 */
export default async function QuizPage({ params }: Props) {
  const { slug } = await params;

  let quiz: Awaited<ReturnType<typeof getQuizBySlug>>;
  try {
    quiz = await getQuizBySlug(slug);
  } catch {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
        <StudentHeader actions={<ThemeToggle />} />
        <p className="mt-10 text-sm text-muted-foreground">
          Mất kết nối máy chủ. Thử tải lại trang sau ít phút.
        </p>
      </main>
    );
  }

  if (!quiz) notFound();

  // An exam Attempt past its deadline is auto-submitted by `loadAttempt`.
  let attempt = await loadAttempt({ slug });
  if (!attempt) {
    const done = await loadOwnedAttempt({ slug });
    if (done) redirect(`/q/${slug}/ket-qua`);

    // Signed in but has not opened this Quiz yet: the home-page identity
    // applies here too, so the paper opens without asking for MSSV again.
    // Without a cookie the identity form below does the same job.
    const signedIn = await loadStudent();
    if (signedIn) {
      const started = await startAttempt({ slug });
      if (started.ok) attempt = await loadAttempt({ slug });
    }
  }

  const student = await loadStudent();
  const summary = attempt ? null : await loadSummary({ quizId: quiz.id });
  const exhausted = quiz.mode === "exam" && summary?.attemptsExhausted === true;

  // A fresh identity exchange is only possible on a published Quiz (checked by
  // `resumeOrStartAttempt`) and while the limit is not used up.
  // `canStartNew` is false for an archived Quiz and for a used-up exam limit.
  const canStart = summary === null || summary.canStartNew;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
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

      <header className="mb-5 mt-8 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {quiz.questionCount} câu
          </span>
          {quiz.timeLimit !== undefined ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {quiz.timeLimit} phút
            </span>
          ) : null}
          {quiz.maxAttempts !== undefined ? (
            <span className="text-xs text-muted-foreground">
              Tối đa {quiz.maxAttempts} lần
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold text-balance sm:text-3xl">
          {quiz.title}
        </h1>
        {attempt ? (
          <p className="text-sm text-muted-foreground">
            {attempt.studentName} ({attempt.studentId})
          </p>
        ) : null}
      </header>

      {attempt ? (
        <QuizRunner
          attempt={attempt}
          questionBodies={await questionBodiesOf(attempt)}
          summaryHref={`/q/${quiz.slug}/ket-qua`}
        />
      ) : exhausted ? (
        <Card>
          <CardHeader>
            <CardTitle>Đã hết lượt làm bài</CardTitle>
            <CardDescription>
              {exhaustedAttemptsError(quiz.maxAttempts ?? 0)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/q/${quiz.slug}/ket-qua`}>
                Xem kết quả
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : canStart ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Nhập tên để bắt đầu</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <IdentityForm slug={quiz.slug} />
            {summary && summary.attemptCount > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
                <span>Đã làm {summary.attemptCount} lần.</span>
                <Link
                  href={`/q/${quiz.slug}/ket-qua`}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Xem kết quả
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Đề đã đóng</CardTitle>
            <CardDescription>
              Đề đã lưu trữ, không thể làm mới.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
