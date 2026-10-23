import type { Metadata } from "next";
import { Quiz } from "@/lib/quiz/quiz.model";
import { connectToDatabase } from "@/lib/db";
import { logoutAdmin } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Đề thi",
};

export const dynamic = "force-dynamic";

type QuizListItem = {
  id: string;
  title: string;
  slug: string;
  mode: "practice" | "exam";
  status: "draft" | "published" | "archived";
  questionCount: number;
};

async function listQuizzes(): Promise<
  { quizzes: QuizListItem[] } | { error: string }
> {
  try {
    await connectToDatabase();
    const quizzes = await Quiz.find({})
      .select("title slug mode status questions")
      .sort({ createdAt: -1 })
      .lean();

    return {
      quizzes: quizzes.map((quiz) => ({
        id: String(quiz._id),
        title: quiz.title,
        slug: quiz.slug,
        mode: quiz.mode,
        status: quiz.status,
        questionCount: quiz.questions.length,
      })),
    };
  } catch {
    return {
      error: "Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.",
    };
  }
}

const statusLabels: Record<QuizListItem["status"], string> = {
  draft: "Nháp",
  published: "Đã publish",
  archived: "Đã lưu trữ",
};

export default async function AdminHomePage() {
  const result = await listQuizzes();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Quản trị đề thi</h1>
          <p className="text-sm text-muted-foreground">
            Danh sách các đề đã tạo từ file Moodle.
          </p>
        </div>
        <form action={logoutAdmin}>
          <Button type="submit" variant="outline">
            Đăng xuất
          </Button>
        </form>
      </header>

      {"error" in result ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{result.error}</p>
          </CardContent>
        </Card>
      ) : result.quizzes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Chưa có đề nào</CardTitle>
            <CardDescription>
              Chạy <code className="font-mono">pnpm seed</code> hoặc upload file
              JSON Moodle để tạo đề nháp.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
                  <div>
                    <p className="font-medium">{quiz.title}</p>
                    <p className="text-sm text-muted-foreground">
                      /q/{quiz.slug} · {quiz.questionCount} câu · {quiz.mode}
                    </p>
                  </div>
                  <span className="rounded-full border px-3 py-1 text-xs">
                    {statusLabels[quiz.status]}
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
