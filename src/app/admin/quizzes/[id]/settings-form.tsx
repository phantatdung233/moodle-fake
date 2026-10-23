"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveQuizSettings } from "@/lib/admin/lifecycle-actions";
import type { QuizMode } from "@/lib/quiz/quiz.model";

export type QuizSettingsFormProps = {
  quizId: string;
  title: string;
  slug: string;
  mode: QuizMode;
  timeLimit: number | null;
  maxAttempts: number | null;
};

/**
 * Draft-only settings: name, slug, mode and the exam limits. A published Quiz
 * never renders this form, and the action refuses writes anyway — the server
 * is the boundary, this is only the editor (Spec, "Publish state machine").
 */
export function QuizSettingsForm(props: QuizSettingsFormProps) {
  const [title, setTitle] = useState(props.title);
  const [slug, setSlug] = useState(props.slug);
  const [mode, setMode] = useState<QuizMode>(props.mode);
  const [timeLimit, setTimeLimit] = useState(props.timeLimit === null ? "" : String(props.timeLimit));
  const [maxAttempts, setMaxAttempts] = useState(
    props.maxAttempts === null ? "" : String(props.maxAttempts),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const result = await saveQuizSettings(props.quizId, {
        title,
        slug,
        mode,
        // An empty field means "no limit"; practice ignores both anyway.
        timeLimit: timeLimit.trim() === "" ? null : Number(timeLimit),
        maxAttempts: maxAttempts.trim() === "" ? null : Number(maxAttempts),
      });
      if (result.ok) {
        setSaved(true);
        // Refresh server components so the header and publish card show the new values.
        window.location.reload();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Không lưu được cài đặt. Kiểm tra kết nối rồi thử lại.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="quiz-title">Tên đề</Label>
          <Input
            id="quiz-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="quiz-slug">Slug (URL)</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">/q/</span>
            <Input
              id="quiz-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="font-mono"
              maxLength={100}
              required
            />
          </div>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Chế độ</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="practice"
              checked={mode === "practice"}
              onChange={() => setMode("practice")}
            />
            Luyện tập — xem đáp án ngay, không giới hạn thời gian
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="exam"
              checked={mode === "exam"}
              onChange={() => setMode("exam")}
            />
            Kiểm tra — ẩn đáp án tới khi nộp, có thể đặt giờ và số lần
          </label>
        </div>
      </fieldset>

      {mode === "exam" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="quiz-time-limit">Thời gian (phút)</Label>
            <Input
              id="quiz-time-limit"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={timeLimit}
              onChange={(event) => setTimeLimit(event.target.value)}
              placeholder="Để trống = không giới hạn"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="quiz-max-attempts">Số lần làm tối đa</Label>
            <Input
              id="quiz-max-attempts"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={maxAttempts}
              onChange={(event) => setMaxAttempts(event.target.value)}
              placeholder="Để trống = không giới hạn"
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-emerald-700">Đã lưu cài đặt.</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Đang lưu…" : "Lưu cài đặt"}
      </Button>
    </form>
  );
}
