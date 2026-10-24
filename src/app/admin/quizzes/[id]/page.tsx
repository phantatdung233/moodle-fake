import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getQuizForAdmin, type QuizDetail } from "@/lib/quiz/repository";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AdminDatabaseError, AdminHeader } from "@/app/admin/admin-header";
import { QuizSettingsForm } from "./settings-form";
import { QuestionSelectionList } from "./question-selection";
import { QuizLifecycleCard } from "./lifecycle-card";
import { formatDate } from "@/lib/admin/result-format";

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
 * One Quiz for the giảng viên: summary, lifecycle controls (publish /
 * unpublish / archive) and — while the Quiz is a draft — the settings and the
 * Question selection. A published Quiz shows the same page read-only; the
 * actions refuse writes server-side regardless (Spec, "Publish state machine").
 */
export default async function AdminQuizPage({ params }: Props) {
  const { id } = await params;

  let quiz: QuizDetail | null;
  try {
    quiz = await getQuizForAdmin(id);
  } catch {
    return (
      <main className={adminShell}>
        <AdminHeader active="quizzes" />
        <AdminDatabaseError />
      </main>
    );
  }

  if (!quiz) notFound();

  return (
    <main className={adminShell}>
      <AdminHeader active="quizzes" />

      <nav aria-label="Đường dẫn" className="mb-3 text-sm">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Đề thi
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-balance">{quiz.title}</h1>
          <p className="text-sm break-all text-muted-foreground">
            /q/{quiz.slug} · {modeLabels[quiz.mode]} · bản {quiz.version}
            {quiz.mode === "exam" && quiz.timeLimit !== null
              ? ` · ${quiz.timeLimit} phút`
              : ""}
            {quiz.mode === "exam" && quiz.maxAttempts !== null
              ? ` · tối đa ${quiz.maxAttempts} lần`
              : ""}
          </p>
        </div>
        <span className="rounded-md border px-3 py-1 text-xs font-medium">
          {statusLabels[quiz.status]}
        </span>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Tóm tắt đề</CardTitle>
            <CardDescription>
              {quiz.status === "draft"
                ? "Đề nháp: còn sửa được câu hỏi và đáp án."
                : quiz.status === "published"
                  ? "Đã publish: đề được đóng băng."
                  : "Đã lưu trữ. Kết quả cũ vẫn đọc được."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Tổng câu" value={quiz.questionCount} />
              <Stat label="Trắc nghiệm" value={quiz.multichoiceCount} />
              <Stat label="Điền khuyết" value={quiz.multianswerCount} />
              <Stat label="Cần duyệt đáp án" value={quiz.needsReviewCount} highlight />
              <Stat label="Sẽ publish" value={quiz.publishableCount} />
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

        <Card>
          <CardHeader>
            <CardTitle>Publish & khoá đề</CardTitle>
            <CardDescription>
              Publish chỉ đưa ra những câu đang bật và đã có đáp án.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuizLifecycleCard quiz={quiz} />
          </CardContent>
        </Card>
      </div>

      {quiz.status === "draft" ? (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-4">
            <CardHeader>
              <CardTitle>Cài đặt đề</CardTitle>
              <CardDescription>
                Chế độ, thời gian và số lần làm. Chỉ sửa được khi đề còn nháp.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QuizSettingsForm
                quizId={quiz.id}
                title={quiz.title}
                slug={quiz.slug}
                mode={quiz.mode}
                timeLimit={quiz.timeLimit}
                maxAttempts={quiz.maxAttempts}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chọn câu đưa vào đề</CardTitle>
              <CardDescription>
                Bật/tắt từng câu. Câu đang tắt hoặc chưa duyệt đáp án sẽ bị loại khi publish.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QuestionSelectionList
                quizId={quiz.id}
                questions={quiz.questions}
                readOnly={false}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Câu trong đề</CardTitle>
            <CardDescription>
              Đề đã đóng băng: danh sách chỉ để xem lại. Câu đang tắt không phát cho sinh viên.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuestionSelectionList quizId={quiz.id} questions={quiz.questions} readOnly />
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/admin/quizzes/${quiz.id}/review`}>
            {quiz.needsReviewCount > 0 ? "Duyệt đáp án" : "Xem lại đáp án"}
          </Link>
        </Button>
        {quiz.status === "published" ? (
          <Button asChild variant="outline">
            <Link href={`/q/${quiz.slug}`} target="_blank">
              Mở đề như sinh viên
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={`/admin/results?quizId=${quiz.id}`}>Xem kết quả đề này</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Về danh sách đề</Link>
        </Button>
      </div>
    </main>
  );
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
    <div className="flex flex-col border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={highlight ? "text-lg font-semibold text-warning" : "text-lg font-semibold"}>
        {value}
      </dd>
    </div>
  );
}
