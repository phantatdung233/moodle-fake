import type { Metadata } from "next";
import Link from "next/link";
import { listTestableQuizzes, type TestableQuiz } from "@/lib/quiz/repository";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Luyện tập Python",
};

export const dynamic = "force-dynamic";

/**
 * Home: the published Quizzes a sinh viên can open. Drafts and archived Quizzes
 * belong to the giảng viên and only appear under `/admin` (Spec, user story 24).
 */
export default async function HomePage() {
  let quizzes: TestableQuiz[];
  try {
    quizzes = await listTestableQuizzes();
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold">Luyện tập Python</h1>
        <p className="mt-4 text-sm text-destructive">
          Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-12">
      <h1 className="text-3xl font-semibold">Luyện tập Python</h1>
      <p className="mt-2 text-muted-foreground">
        Chọn một đề để làm. Làm xong mỗi câu ở chế độ luyện tập là thấy ngay đúng/sai và đáp án.
      </p>

      <section aria-labelledby="quiz-list-heading" className="mt-8">
        <h2 id="quiz-list-heading" className="sr-only">
          Danh sách đề
        </h2>

        {quizzes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Chưa có đề nào</CardTitle>
              <CardDescription>
                Giảng viên upload đề tại{" "}
                <Link className="underline underline-offset-4" href="/admin">
                  /admin
                </Link>{" "}
                (hoặc chạy <code className="font-mono">pnpm seed</code>).
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {quizzes.map((quiz) => (
              <li key={quiz.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <Link
                      href={`/q/${quiz.slug}`}
                      className="font-medium text-lg underline-offset-4 hover:underline"
                    >
                      {quiz.title !== "" ? quiz.title : "(chưa đặt tên)"}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {quiz.questionCount} câu ·{" "}
                      {quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-sm text-muted-foreground">
        Giảng viên quản lý đề tại{" "}
        <Link className="underline underline-offset-4" href="/admin">
          /admin
        </Link>
        .
      </p>
    </main>
  );
}
