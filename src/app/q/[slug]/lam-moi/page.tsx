import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudentHeader } from "@/components/student-header";
import { getQuizBySlug } from "@/lib/quiz/repository";
import { exhaustedAttemptsError } from "@/lib/quiz/attempt-repository";
import { loadStudent, loadSummary, retryAttempt } from "@/lib/student/actions";

export const metadata: Metadata = { title: "Làm lại" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * `/q/<slug>/lam-moi` — the target of every "Làm lại" button.
 *
 * It exists because `/q/<slug>` means "continue the paper you have open": a
 * retry link pointing there would resume the Attempt it just left and bounce
 * back to the summary. This page closes the open paper (if any), opens a fresh
 * one and sends the student to the runner. It refuses politely when the Quiz is
 * closed or its attempt limit is used up — the same rule `retryAttempt`
 * enforces — rather than redirecting into another bounce.
 */
export default async function RetryPage({ params }: Props) {
  const { slug } = await params;

  const quiz = await getQuizBySlug(slug).catch(() => null);
  if (!quiz) notFound();

  const [student, summary] = await Promise.all([
    loadStudent(),
    loadSummary({ quizId: quiz.id }),
  ]);

  const notice = !student
    ? "Nhập MSSV ở trang chủ để làm đề này."
    : summary?.attemptsExhausted
      ? exhaustedAttemptsError(quiz.maxAttempts ?? 0)
      : null;

  if (!notice) {
    const refused = await retryAttempt({ slug });
    // A page may not revalidate during render, so only the redirect happens
    // here; `startNewAttempt` (the form action) revalidates the home page.
    if (!refused) redirect(`/q/${quiz.slug}`);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <StudentHeader
        student={student}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/q/${slug}/ket-qua`}>
                <ArrowLeft aria-hidden />
                Kết quả
              </Link>
            </Button>
            <ThemeToggle />
          </>
        }
      />
      <div className="mt-10 flex max-w-xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">Chưa mở được lượt mới</h1>
        <p className="text-sm text-muted-foreground">
          {notice ?? "Đề này hiện không mở lượt làm mới. Xem lại kết quả đã làm."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="self-start">
            <Link href="/">Về trang chủ</Link>
          </Button>
          <Button asChild variant="ghost" className="self-start">
            <Link href={`/q/${slug}/ket-qua`}>Xem kết quả</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
