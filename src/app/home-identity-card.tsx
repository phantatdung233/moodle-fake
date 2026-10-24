"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInStudent } from "@/lib/student/actions";

/**
 * First thing on the home page: MSSV + họ tên, entered once and then used by
 * every Quiz. No password (Spec, user story 34). The action stores the
 * identity in the httpOnly cookie and revalidates, so the page simply
 * re-renders as signed in — no navigation to a particular Quiz.
 */
export function HomeIdentityCard() {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const ready = studentId.trim() !== "" && studentName.trim() !== "";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !ready) return;
    setError(null);
    setPending(true);
    try {
      const result = (await signInStudent({ studentId, studentName })) as
        | { ok: false; error: string }
        | undefined;
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      router.refresh();
      // Keep `pending` on: the card unmounts once the server confirms.
    } catch {
      setError("Không lưu được thông tin. Kiểm tra kết nối rồi thử lại.");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 overflow-hidden rounded-2xl border border-brand-border bg-brand-surface"
    >
      <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <IdCard aria-hidden className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-brand-ink">Nhập thông tin để bắt đầu</h2>
          <p className="mt-0.5 text-xs text-brand-ink/80">
            Dùng cho mọi đề — vào đề nào cũng không hỏi lại.
          </p>
        </div>
      </div>

      <div className="grid gap-3 px-4 pt-4 sm:grid-cols-2 sm:px-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="home-student-id" className="text-brand-ink">
            MSSV
          </Label>
          <Input
            id="home-student-id"
            name="studentId"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                nameRef.current?.focus();
              }
            }}
            placeholder="B2012345"
            autoComplete="username"
            autoCapitalize="characters"
            enterKeyHint="next"
            required
            maxLength={30}
            className="bg-card"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="home-student-name" className="text-brand-ink">
            Họ và tên
          </Label>
          <Input
            id="home-student-name"
            name="studentName"
            ref={nameRef}
            value={studentName}
            onChange={(event) => setStudentName(event.target.value)}
            placeholder="Nguyễn Văn An"
            autoComplete="name"
            enterKeyHint="done"
            required
            maxLength={100}
            className="bg-card"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 pb-4 pt-3 sm:px-5">
        <Button type="submit" disabled={pending || !ready} className="gap-1.5">
          {pending ? "Đang lưu…" : "Lưu thông tin"}
          {pending ? null : <ArrowRight aria-hidden />}
        </Button>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-brand-ink/80">
            Bài làm và điểm được lưu theo MSSV.
          </p>
        )}
      </div>
    </form>
  );
}
