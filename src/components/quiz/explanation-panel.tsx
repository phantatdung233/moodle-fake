"use client";

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
  attemptId: string;
  questionId: string;
  questionHash: string;
  mode?: "practice" | "summary" | "none";
  context?: ExplanationContext;
  onLoaded?: () => void;
  initialText?: string;
  onTextChange?: (text: string) => void;
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
  initialText = "",
  onTextChange,
  className,
}: ExplanationPanelProps) {
  const [text, setText] = useState(initialText);
  const announced = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(
    initialText === "" ? "idle" : "done",
  );
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
        onTextChange?.(received);
        setStatus("done");
      }
    } catch {
      if (id !== requestId.current || controller.signal.aborted) return;
      setError(NETWORK_ERROR);
      setStatus("error");
    }
  }, [attemptId, questionId, questionHash, onLoaded, onTextChange]);

  if (mode === "none") return null;
  const streaming = status === "streaming";

  if (status === "idle") {
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
        <span className="text-sm font-medium">Giải thích</span>
        {streaming ? (
          <Loader2
            className="size-3 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

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
