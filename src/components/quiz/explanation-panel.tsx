"use client";

/**
 * "Giải thích bằng AI" — panel stream giải thích AI cho MỘT Question.
 *
 * Dùng chung cho chế độ luyện tập và trang tổng kết. Đáp án hiện ngay sau khi
 * chấm; lời giải thích chỉ được sinh khi sinh viên tự bấm — xem đáp án không
 * tốn một lời gọi model. Đúng/sai không bao giờ đến từ panel: nó chỉ là lời
 * giải thích đi kèm kết quả chấm cục bộ, và mọi lỗi model đều là thông báo mềm
 * kèm nút thử lại — không có màn hình vỡ.
 */
import { useCallback, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPLANATION } from "@/lib/gemini/messages";
import { readExplanationFrames } from "@/lib/gemini/frame-reader";
import { EXPLAIN_ROUTE } from "@/lib/gemini/request";
import type { ExplanationContext } from "@/lib/gemini/explanation-format";
import { ExplanationText } from "@/components/quiz/explanation-text";
import { cn } from "@/lib/utils";

export type ExplanationPanelProps = {
  /** The Attempt on screen; the server checks it belongs to this MSSV. */
  attemptId: string;
  questionId: string;
  /** The hash the page rendered; the server rejects a stale one. */
  questionHash: string;
  /**
   * `practice`: the Question is already revealed; `summary`: the paper is
   * submitted. Both show the panel, and both wait for a click.
   * `none`: nothing to explain yet (exam still open) — render nothing.
   */
  mode?: "practice" | "summary" | "none";
  /**
   * What the Question records (correct keys / accepted blanks) and what the
   * sinh viên did, so a stored explanation from before the agreed format still
   * gets a complete verdict line.
   */
  context?: ExplanationContext;
  /**
   * Called once the first text arrives. The summary page uses it to put the
   * explanation in place of the revealed answers instead of under them.
   */
  onLoaded?: () => void;
  className?: string;
};

type Status = "idle" | "streaming" | "done" | "error";

const NETWORK_ERROR =
  "Không tải được giải thích. Kiểm tra kết nối rồi thử lại.";

export function ExplanationPanel({
  attemptId,
  questionId,
  questionHash,
  mode = "practice",
  context,
  onLoaded,
  className,
}: ExplanationPanelProps) {
  const [text, setText] = useState("");
  const announced = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
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
        body: JSON.stringify({ attemptId, questionId, questionHash }),
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
          if (!announced.current) {
            announced.current = true;
            onLoaded?.();
          }
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
  }, [attemptId, questionId, questionHash, onLoaded]);

  if (mode === "none") return null;
  const streaming = status === "streaming";

  // Summary: one unobtrusive trigger under the graded answer. The panel's own
  // dashed card and heading are dropped — the answer is already visible, and a
  // second card per Question just made the page long.
  if (mode === "summary" && status === "idle") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void load()}
        className="-ml-2 self-start text-muted-foreground"
      >
        <Sparkles aria-hidden /> Giải thích bằng AI
      </Button>
    );
  }

  return (
    <section
      aria-live="polite"
      aria-busy={streaming}
      data-testid="explanation-panel"
      data-status={status}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-dashed bg-muted/30 p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="text-sm font-medium">Giải thích bằng AI</span>
        {streaming ? (
          <Loader2
            className="size-3 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
        {status === "done" ? (
          <span className="ml-auto text-xs text-muted-foreground">
            Do AI viết, chỉ để tham khảo
          </span>
        ) : null}
      </div>

      {status === "idle" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="shrink-0 bg-background"
          >
            <Sparkles aria-hidden /> Giải thích bằng AI
          </Button>
        </div>
      ) : null}

      {text ? <ExplanationText text={text} context={context} /> : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="shrink-0 bg-background"
          >
            <RotateCcw aria-hidden /> Thử lại
          </Button>
        </div>
      ) : null}
    </section>
  );
}
