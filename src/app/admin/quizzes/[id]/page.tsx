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
            {quiz.mode === "exam" && quiz.timeLimit !== null
              ? ` · ${quiz.timeLimit} phút`
              : ""}
            {quiz.mode === "exam" && quiz.maxAttempts !== null
              ? ` · tối đa ${quiz.maxAttempts} lần`
              : ""}
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
              : quiz.status === "published"
                ? "Đề đã publish và đóng băng. Sinh viên đang làm theo bản đã publish."
                : "Đề đã lưu trữ. Các lượt làm cũ vẫn đọc được."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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

      <Card className="mt-6">
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

      {quiz.status === "draft" ? (
        <>
          <Card className="mt-6">
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

          <Card className="mt-6">
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
        </>
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
    <div className="flex flex-col rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={highlight ? "text-lg font-semibold text-amber-600" : "text-lg font-semibold"}>
        {value}
      </dd>
    </div>
  );
}
