import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuizForAdmin, type QuizDetail } from "@/lib/quiz/repository";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Chi tiết đề",
};

export const dynamic = "force-dynamic";

const statusLabels: Record<QuizDetail["status"], string> = {
  draft: "Nháp",
  published: "Đã publish",
  archived: "Đã lưu trữ",
};

const modeLabels: Record<QuizDetail["mode"], string> = {
  practice: "Luyện tập",
  exam: "Kiểm tra",
};

type Props = { params: Promise<{ id: string }> };

/**
 * Summary of one Quiz. Editing Questions, the review page and publish controls
 * are added by the later admin tickets; this page only proves the upload landed.
 */
export default async function AdminQuizPage({ params }: Props) {
  const { id } = await params;

  let quiz: QuizDetail | null;
  try {
    quiz = await getQuizForAdmin(id);
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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <nav className="mb-4 text-sm">
        <Link href="/admin" className="text-muted-foreground hover:underline">
          ← Danh sách đề
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{quiz.title}</h1>
          <p className="text-sm break-all text-muted-foreground">
            /q/{quiz.slug} · {modeLabels[quiz.mode]} · bản {quiz.version}
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs">
          {statusLabels[quiz.status]}
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Tóm tắt đề</CardTitle>
          <CardDescription>
            {quiz.status === "draft"
              ? "Đề nháp: vẫn sửa được câu hỏi và đáp án trước khi publish."
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Tổng câu" value={quiz.questionCount} />
            <Stat label="Trắc nghiệm" value={quiz.multichoiceCount} />
            <Stat label="Điền khuyết" value={quiz.multianswerCount} />
            <Stat label="Cần duyệt đáp án" value={quiz.needsReviewCount} highlight />
            <Stat label="Lượt làm" value={quiz.attemptCount} />
            <Stat label="Đã publish lúc" value={formatDate(quiz.publishedAt)} />
          </dl>

          <p className="mt-4 text-sm text-muted-foreground">
            {quiz.needsReviewCount > 0
              ? `Còn ${quiz.needsReviewCount} câu chưa có đáp án. Mở trang duyệt đáp án để trả lời từng câu.`
              : "Mọi câu đang bật đã có đáp án."}
          </p>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/admin/quizzes/${quiz.id}/review`}>
            {quiz.needsReviewCount > 0 ? "Duyệt đáp án" : "Xem lại đáp án"}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Về danh sách đề</Link>
        </Button>
      </div>
    </main>
  );
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={highlight ? "text-lg font-semibold text-amber-600" : "text-lg font-semibold"}>
        {value}
      </dd>
    </div>
  );
}
