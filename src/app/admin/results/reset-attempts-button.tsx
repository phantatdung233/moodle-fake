"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
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
import { resetStudentAttemptsAction } from "@/lib/admin/results-actions";

export type ResetAttemptsButtonProps = {
  quizId: string;
  quizTitle: string;
  studentId: string;
  studentName: string;
};

/**
 * "Reset lượt" on one student's row. The dialog names the student and the Quiz
 * and says exactly what is deleted, because the action is destructive and
 * irreversible; the server action enforces the same scope regardless.
 */
export function ResetAttemptsButton({
  quizId,
  quizTitle,
  studentId,
  studentName,
}: ResetAttemptsButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetStudentAttemptsAction({ quizId, studentId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("Không reset được. Kiểm tra kết nối rồi thử lại.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            <RotateCcw /> Reset lượt
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset lượt làm của {studentId}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  Xoá <strong>mọi lượt làm</strong> của <strong>{studentName}</strong> ({studentId}) cho
                  đề <strong>{quizTitle}</strong>. Kết quả của sinh viên khác và các đề khác không bị
                  ảnh hưởng.
                </p>
                <p>
                  Không khôi phục được. Sau khi reset, sinh viên làm lại được từ lượt 1 (kể cả khi đề
                  đã hết số lần làm).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Thôi</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Reset lượt</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
