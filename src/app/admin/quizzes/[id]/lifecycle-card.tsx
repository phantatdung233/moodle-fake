"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Lock, RotateCcw, Send, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  archiveQuizAction,
  deleteQuizAction,
  publishQuizAction,
  unpublishQuizAction,
} from "@/lib/admin/lifecycle-actions";
import type { QuizDetail } from "@/lib/quiz/repository";

export type QuizLifecycleCardProps = {
  quiz: Pick<QuizDetail, "id" | "status" | "attemptCount" | "questions">;
};

/**
 * Publish / unpublish / archive. The confirm dialogs explain what will happen
 * (how many Questions drop, whether unpublish is still possible); the server
 * actions enforce the same rules, so nothing here is a security boundary.
 */
export function QuizLifecycleCard({ quiz }: QuizLifecycleCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const total = quiz.questions.length;
  const ready = quiz.questions.filter((row) => row.enabled && row.status === "ready").length;
  const enabledNeedsReview = quiz.questions.filter(
    (row) => row.enabled && row.status === "needs_review",
  ).length;
  const disabled = quiz.questions.filter((row) => !row.enabled).length;
  const dropped = total - ready;

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    afterSuccess: () => void = () => window.location.reload(),
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error ?? "Không thực hiện được thao tác.");
        else afterSuccess();
      } catch {
        setError("Không thực hiện được thao tác. Kiểm tra kết nối rồi thử lại.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {quiz.status === "draft" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Publish sẽ khoá đề. Chỉ huỷ publish khi chưa có lượt làm.
          </p>
          {dropped > 0 ? (
            <p className="flex items-start gap-2 rounded-sm border border-warning-border bg-warning-surface p-3 text-sm text-warning-foreground">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>{dropped} câu bị loại</strong> — {enabledNeedsReview} câu chờ duyệt,
                {disabled} câu đang tắt. Còn <strong>{ready}</strong> câu.
              </span>
            </p>
          ) : (
            <p className="rounded-sm border bg-muted/40 p-3 text-sm">
              Publish <strong>{ready}</strong> câu.
            </p>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={pending || ready === 0} className="self-start">
                <Send /> Publish đề
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Publish đề này?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="flex flex-col gap-2 text-sm">
                    <p>
                      {dropped > 0
                        ? `${dropped} câu bị loại.`
                        : "Không câu nào bị loại."}{" "}
                      Sinh viên thấy <strong>{ready} câu</strong>.
                    </p>
                    <p>Đề bị khoá sau khi publish; chỉ huỷ publish khi chưa có lượt làm.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Huỷ</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => publishQuizAction(quiz.id))}>
                  Publish {ready} câu
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {ready === 0 ? (
            <p className="text-sm text-destructive">
              Chưa có câu sẵn sàng. Duyệt đáp án hoặc bật câu đã có đáp án.
            </p>
          ) : null}

          {/* The Quiz no longer exists, so the detail page cannot reload. */}
          <DeleteDraftDialog
            pending={pending}
            onConfirm={() => run(() => deleteQuizAction(quiz.id), () => router.push("/admin"))}
          />
        </>
      ) : null}

      {quiz.status === "published" ? (
        <>
          <p className="flex items-start gap-2 rounded-sm border bg-muted/40 p-3 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <span>
              Đề đã publish và bị khoá. Không thể chỉnh sửa.
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={pending || quiz.attemptCount > 0}>
                  <RotateCcw /> Huỷ publish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Huỷ publish về bản nháp?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Đề sẽ biến mất khỏi trang chủ và sửa lại được. Chỉ làm được khi chưa có lượt
                    làm nào (hiện có {quiz.attemptCount}).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Thôi</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(() => unpublishQuizAction(quiz.id))}>
                    Huỷ publish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <ArchiveQuizDialog pending={pending} onConfirm={() => run(() => archiveQuizAction(quiz.id))} />
          </div>

          {quiz.attemptCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              Đã có {quiz.attemptCount} lượt làm nên không thể huỷ publish. Lưu trữ để ẩn đề.
            </p>
          ) : null}
        </>
      ) : null}

      {quiz.status === "archived" ? (
        <p className="flex items-start gap-2 rounded-sm border bg-muted/40 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            Đề đã lưu trữ. Không hiện cho sinh viên mới; lượt cũ vẫn xem được.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function DeleteDraftDialog({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="self-start text-destructive" disabled={pending}>
          <Trash2 /> Xoá đề nháp
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá vĩnh viễn đề nháp này?</AlertDialogTitle>
          <AlertDialogDescription>
            Đề và dữ liệu liên quan sẽ bị xoá vĩnh viễn. Không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Thôi</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Xoá đề
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ArchiveQuizDialog({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending}>
          <Archive /> Lưu trữ
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lưu trữ đề?</AlertDialogTitle>
          <AlertDialogDescription>
            Đề sẽ bị ẩn và không thể khôi phục. Kết quả cũ vẫn giữ nguyên.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Thôi</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Lưu trữ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
