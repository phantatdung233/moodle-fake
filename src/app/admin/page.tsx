import type { Metadata } from "next";
import Link from "next/link";
import { logoutAdmin } from "@/lib/admin/actions";
import { listQuizzes, type QuizListItem } from "@/lib/quiz/repository";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = {
  title: "Đề thi",
};

export const dynamic = "force-dynamic";

const statusLabels: Record<QuizListItem["status"], string> = {
  draft: "Nháp",
  published: "Đã publish",
  archived: "Đã lưu trữ",
};

const modeLabels: Record<QuizListItem["mode"], string> = {
  practice: "Luyện tập",
  exam: "Kiểm tra",
};

async function loadQuizzes(): Promise<
  { quizzes: QuizListItem[] } | { error: string }
> {
  try {
    return { quizzes: await listQuizzes() };
  } catch {
    return {
      error: "Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.",
    };
  }
}

export default async function AdminHomePage() {
  const result = await loadQuizzes();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Quản trị đề thi</h1>
          <p className="text-sm text-muted-foreground">
            Upload file Moodle để tạo đề nháp, rồi duyệt đáp án trước khi publish.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={logoutAdmin}>
            <Button type="submit" variant="outline">
              Đăng xuất
            </Button>
          </form>
          <Button asChild variant="outline">
            <Link href="/admin/results">Kết quả sinh viên</Link>
          </Button>
        </div>
      </header>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Tạo đề từ file JSON</CardTitle>
          <CardDescription>
            Chọn file xuất từ Moodle, xem trước số câu và lỗi parse, rồi xác nhận để
            tạo đề nháp. Upload lại tạo một đề mới, không ghi đè đề cũ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      <section aria-labelledby="quiz-list-heading">
        <h2 id="quiz-list-heading" className="mb-3 text-lg font-semibold">
          Danh sách đề
        </h2>

        {"error" in result ? (
          <Card>
            <CardContent>
              <p className="text-sm text-destructive">{result.error}</p>
            </CardContent>
          </Card>
        ) : result.quizzes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Chưa có đề nào</CardTitle>
              <CardDescription>
                Upload file JSON Moodle ở trên (hoặc chạy{" "}
                <code className="font-mono">pnpm seed</code>) để tạo đề nháp.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.quizzes.map((quiz) => (
              <li key={quiz.id}>
                <QuizCard quiz={quiz} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function QuizCard({ quiz }: { quiz: QuizListItem }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link
            href={`/admin/quizzes/${quiz.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {quiz.title !== "" ? quiz.title : "(chưa đặt tên)"}
          </Link>
          <p className="text-sm break-all text-muted-foreground">
            /q/{quiz.slug} · {modeLabels[quiz.mode]}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:flex sm:items-center sm:gap-4">
          <Stat label="Trạng thái" value={statusLabels[quiz.status]} />
          <Stat label="Câu hỏi" value={String(quiz.questionCount)} />
          <Stat
            label="Cần duyệt"
            value={String(quiz.needsReviewCount)}
            highlight={quiz.needsReviewCount > 0}
          />
          <Stat label="Lượt làm" value={String(quiz.attemptCount)} />
        </dl>
        <div className="flex flex-col gap-2 sm:items-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/quizzes/${quiz.id}/review`}>
              {quiz.needsReviewCount > 0 ? "Duyệt đáp án" : "Xem lại đáp án"}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col sm:items-end">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={highlight ? "font-medium text-amber-600" : "font-medium"}>
        {value}
      </dd>
    </div>
  );
}
