"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { beginAttempt, type BeginAttemptError } from "@/lib/student/actions";

/**
 * MSSV + họ tên, no password (Spec, user story 34). Submitting either resumes
 * the in-progress Attempt for this MSSV or opens a new one, then lands on the
 * quiz screen. The button stays disabled while the action runs, and an error
 * from the server (blank fields, missing Quiz) shows above the fields.
 */
export function IdentityForm({ slug }: { slug: string }) {
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);

    // No `finally` resetting `pending`: a redirect unmounts this form, and
    // resetting in a `finally` would flash the idle button during navigation.
    try {
      const result = (await beginAttempt({ slug, studentId, studentName })) as
        | BeginAttemptError
        | undefined;
      // Success redirects; anything returned is an error to show.
      if (result?.error) {
        setError(result.error);
        setPending(false);
      }
    } catch (thrown) {
      // A redirect is thrown as control flow and must not become an error message.
      if (thrown instanceof Error && thrown.message.includes("NEXT_REDIRECT")) return;
      setError("Không vào được bài. Kiểm tra kết nối rồi thử lại.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="studentId">MSSV</Label>
        <Input
          id="studentId"
          name="studentId"
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          placeholder="B2012345"
          autoComplete="username"
          autoCapitalize="characters"
          required
          maxLength={30}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="studentName">Họ và tên</Label>
        <Input
          id="studentName"
          name="studentName"
          value={studentName}
          onChange={(event) => setStudentName(event.target.value)}
          placeholder="Nguyễn Văn An"
          autoComplete="name"
          required
          maxLength={100}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || studentId.trim() === "" || studentName.trim() === ""}>
        {pending ? "Đang vào bài…" : "Vào làm bài"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Vào lại bằng cùng MSSV để tiếp tục bài đang làm dở. Không cần mật khẩu.
      </p>
    </form>
  );
}
