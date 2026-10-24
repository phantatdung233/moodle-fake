import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { listQuizzes, type QuizListItem } from "@/lib/quiz/repository";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AdminDatabaseError, AdminHeader } from "./admin-header";
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
    return { error: "DB_ERROR" };
  }
}

export default async function AdminHomePage() {
  const result = await loadQuizzes();

  return (
    <main className={adminShell}>
      <AdminHeader active="quizzes" />

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Đề thi</h1>
          {"error" in result ? (
            <p className="text-sm text-muted-foreground">Cần kết nối lại.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {result.quizzes.length} đề · tạo mới bằng file JSON Moodle.
            </p>
          )}
        </div>
      </header>

      <div className="mb-8 grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-16">
          <CardHeader>
            <CardTitle>Tạo đề từ file JSON</CardTitle>
            <CardDescription>
              Xem trước số câu rồi xác nhận. Mỗi lần upload là một đề nháp mới.
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
            <AdminDatabaseError />
          ) : result.quizzes.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
              <p className="font-medium">Chưa có đề nào</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload file JSON Moodle ở bên trái để tạo đề nháp đầu tiên.
              </p>
            </div>
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
      </div>
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
            href={
              quiz.needsReviewCount > 0
                ? `/admin/quizzes/${quiz.id}/review`
                : undefined
            }
          />
          <Stat label="Lượt làm" value={String(quiz.attemptCount)} />
        </dl>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/quizzes/${quiz.id}/review`}>
              {quiz.needsReviewCount > 0 ? "Duyệt đáp án" : "Xem lại đáp án"}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/results?quizId=${quiz.id}`}>Kết quả</Link>
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
  href,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  /** Makes the number a link to where it can be acted on. */
  href?: string;
}) {
  return (
    <div className="flex flex-col sm:items-end">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={highlight ? "font-medium text-warning" : "font-medium"}>
        {href ? (
          <Link href={href} className="underline underline-offset-4">
            {value}
            <span className="sr-only"> — duyệt đáp án</span>
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
