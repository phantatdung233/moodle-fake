"use client";

/**
 * "Giải thích bằng AI" — panel stream giải thích Gemini cho MỘT Question.
 *
 * Dùng chung cho chế độ luyện tập (tự chạy sau khi xem đáp án) và trang tổng
 * kết (chỉ đọc cache). Đúng/sai không bao giờ đến từ đây: panel chỉ là lời giải
 * thích đi kèm kết quả chấm cục bộ, và mọi lỗi Gemini đều là thông báo mềm kèm
 * nút thử lại — không có màn hình vỡ.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPLANATION } from "@/lib/gemini/messages";
import { readExplanationFrames } from "@/lib/gemini/frame-reader";
import { EXPLAIN_ROUTE } from "@/lib/gemini/request";
import { cn } from "@/lib/utils";

export type ExplanationPanelProps = {
  questionId: string;
  /** The hash the page rendered; the server rejects a stale one. */
  questionHash: string;
  /**
   * `practice`: the Question is already revealed, so stream right away.
   * `summary`: exam paper submitted, so also stream right away.
   * `none`: nothing to explain yet (exam still open) — render nothing.
   */
  mode?: "practice" | "summary" | "none";
  /** Cached text rendered by the server, so a seen Question never flashes empty. */
  initialText?: string | null;
  className?: string;
};

type Status = "idle" | "streaming" | "done" | "error";

const NETWORK_ERROR = "Không tải được giải thích. Kiểm tra kết nối rồi thử lại.";

export function ExplanationPanel({
  questionId,
  questionHash,
  mode = "practice",
  initialText = null,
  className,
}: ExplanationPanelProps) {
  const [text, setText] = useState(initialText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(initialText ? "done" : "idle");
  // A retry or a jump to another Question must abandon the previous request.
  const requestId = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setStatus("streaming");
    setError(null);
    setText("");

    try {
      const response = await fetch(EXPLAIN_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, questionHash }),
        signal: controller.signal,
      });

      if (!response.body) throw new Error("empty response");
      let received = "";
      let failure: string | null = null;
      for await (const frame of readExplanationFrames(response.body)) {
        if (id !== requestId.current) return;
        if (frame.text) {
          received += frame.text;
          setText(received);
        }
        if (frame.error) failure = frame.error;
      }
      if (id !== requestId.current) return;

      if (failure) {
        setError(failure);
        setStatus("error");
      } else if (received === "") {
        setError(EXPLANATION.unavailable);
        setStatus("error");
      } else {
        setStatus("done");
      }
    } catch {
      if (id !== requestId.current || controller.signal.aborted) return;
      // A mid-stream network drop keeps whatever text already arrived.
      setError(NETWORK_ERROR);
      setStatus("error");
    }
  }, [questionId, questionHash]);

  // Auto-start once for practice/summary; the Question is already revealed there.
  useEffect(() => {
    if (mode === "none" || initialText) return;
    void load();
    return () => {
      requestId.current += 1;
      abort.current?.abort();
    };
  }, [mode, questionId, questionHash, initialText, load]);

  if (mode === "none") return null;

  const streaming = status === "streaming";

  return (
    <section
      aria-live="polite"
      aria-busy={streaming}
      data-testid="explanation-panel"
      data-status={status}
      className={cn("flex flex-col gap-2 rounded-lg border bg-muted/20 p-4", className)}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        Giải thích bằng AI
        {streaming ? <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden /> : null}
      </p>

      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-pretty">{text}</div>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="self-start">
            <RotateCcw /> Thử lại
          </Button>
        </div>
      ) : null}
    </section>
  );
}
