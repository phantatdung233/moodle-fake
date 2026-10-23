import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getQuizBySlug } from "@/lib/quiz/repository";
import { loadAttempt } from "@/lib/student/actions";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { IdentityForm } from "./identity-form";

export const metadata: Metadata = {
  title: "Làm bài",
};

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * `/q/<slug>`: the identity form when this browser has no Attempt for the
 * Quiz, otherwise the quiz-taking screen resuming the in-progress Attempt.
 * Resuming is keyed by the student cookie, never by a URL parameter, so one
 * sinh viên cannot open another's Attempt by editing the address.
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

  const attempt = await loadAttempt({ slug });

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
          {attempt ? ` · ${attempt.studentName} (${attempt.studentId})` : ""}
        </p>
      </header>

      {attempt ? (
        <QuizRunner attempt={attempt} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Vào làm bài</CardTitle>
            <CardDescription>
              Nhập MSSV và họ tên để bắt đầu. Vào lại bằng cùng MSSV để tiếp tục bài đang làm
              dở.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IdentityForm slug={quiz.slug} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
