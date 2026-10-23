import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getQuizBySlug } from "@/lib/quiz/repository";
import { exhaustedAttemptsError } from "@/lib/quiz/attempt-repository";
import { loadAttempt, loadOwnedAttempt, loadSummary } from "@/lib/student/actions";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { IdentityForm } from "./identity-form";

export const metadata: Metadata = {
  title: "Làm bài",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * `/q/<slug>`: the identity form when this browser has no Attempt for the
 * Quiz, the quiz-taking screen while an Attempt is open, and the summary when
 * the Attempt is already submitted. Resuming is keyed by the student cookie,
 * never by a URL parameter, so one sinh viên cannot open another's Attempt by
 * editing the address.
 */
export default async function QuizPage({ params }: Props) {
  const { slug } = await params;

  let quiz: Awaited<ReturnType<typeof getQuizBySlug>>;
  try {
    quiz = await getQuizBySlug(slug);
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-destructive">
          Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.
        </p>
      </main>
    );
  }

  if (!quiz) notFound();

  // An exam Attempt past its deadline is auto-submitted by `loadAttempt`.
  const attempt = await loadAttempt({ slug });
  const owned = attempt ? null : await loadOwnedAttempt({ slug });
  if (owned) redirect(`/q/${slug}/ket-qua`);

  const summary = attempt ? null : await loadSummary({ quizId: quiz.id });
  const exhausted = quiz.mode === "exam" && summary?.attemptsExhausted === true;

  // A fresh identity exchange is only possible on a published Quiz (checked by
  // `resumeOrStartAttempt`) and while the limit is not used up.
  // `canStartNew` is false for an archived Quiz and for a used-up exam limit.
  const canStart = summary === null || summary.canStartNew;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
      <nav className="mb-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:underline">
          ← Danh sách đề
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">{quiz.title}</h1>
        <p className="text-sm text-muted-foreground">
          {quiz.questionCount} câu · {quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
          {quiz.timeLimit !== undefined ? ` · ${quiz.timeLimit} phút` : ""}
          {quiz.maxAttempts !== undefined ? ` · tối đa ${quiz.maxAttempts} lần` : ""}
          {attempt ? ` · ${attempt.studentName} (${attempt.studentId})` : ""}
        </p>
      </header>

      {attempt ? (
        <QuizRunner attempt={attempt} maxAttempts={quiz.maxAttempts} />
      ) : exhausted ? (
        <Card>
          <CardHeader>
            <CardTitle>Đã hết lượt làm bài</CardTitle>
            <CardDescription>
              {exhaustedAttemptsError(quiz.maxAttempts ?? 0)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/q/${quiz.slug}/ket-qua`}
              className="text-sm underline underline-offset-4"
            >
              Xem lại kết quả các lần đã làm
            </Link>
          </CardContent>
        </Card>
      ) : canStart ? (
        <Card>
          <CardHeader>
            <CardTitle>Vào làm bài</CardTitle>
            <CardDescription>
              {summary && summary.attemptCount > 0
                ? `Bạn đã làm ${summary.attemptCount} lần. Nhập MSSV và họ tên để làm lượt mới.`
                : "Nhập MSSV và họ tên để bắt đầu. Vào lại bằng cùng MSSV để tiếp tục bài đang làm dở."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IdentityForm slug={quiz.slug} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Đề đã đóng</CardTitle>
            <CardDescription>Giảng viên đã lưu trữ đề này nên không mở lượt làm mới.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
