"use client";

/**
 * "Giải thích bằng AI" on the admin's review page (Spec, user story 21 in its
 * smallest useful form).
 *
 * The admin asks the AI explicitly for the Question on screen; nothing is
 * stored, since an explanation depends on the answer being explained. No
 * heuristics here: the system never decides by itself that a recorded answer
 * looks wrong (Q066, Q070 are examples a human noticed, not rules the code
 * applies).
 */
import { useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readExplanationFrames } from "@/lib/gemini/frame-reader";
import { ExplanationText } from "@/components/quiz/explanation-text";

export type AdminExplanationProps = {
  quizId: string;
  questionId: string;
  questionHash: string;
  /** Option keys / accepted blanks the giảng viên is reviewing, for the verdict line. */
  acceptedAnswers?: string[];
};

const NETWORK_ERROR = "Không tải được giải thích. Kiểm tra kết nối rồi thử lại.";
const NO_TEXT = "Model không trả về giải thích nào. Thử lại sau.";

type Status = "idle" | "streaming" | "done" | "error";

export function AdminExplanation({
  quizId,
  questionId,
  questionHash,
  acceptedAnswers = [],
}: AdminExplanationProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  async function generate() {
    setStatus("streaming");
    setError(null);
    setText("");
    try {
      const response = await fetch("/api/admin/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server takes the hash from the Quiz it reads; this copy only
        // helps identify the Question in logs.
        body: JSON.stringify({ questionId, quizId, questionHash }),
      });
      if (!response.body) throw new Error("empty response");

      let received = "";
      let failure: string | null = null;
      for await (const frame of readExplanationFrames(response.body)) {
        if (frame.text) {
          received += frame.text;
          setText(received);
        }
        if (frame.error) failure = frame.error;
      }
      if (failure) {
        setError(failure);
        setStatus("error");
      } else if (received === "") {
        setError(NO_TEXT);
        setStatus("error");
      } else {
        setStatus("done");
      }
    } catch {
      setError(NETWORK_ERROR);
      setStatus("error");
    }
  }

  const streaming = status === "streaming";

  return (
    <section
      aria-live="polite"
      aria-busy={streaming}
      data-testid="admin-explanation"
      data-status={status}
      className="flex flex-col gap-2 rounded-sm border border-l-2 border-border border-l-primary bg-muted/40 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        Giải thích bằng AI
        {streaming ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </p>

      {text ? <ExplanationText text={text} context={{ correctOptionKeys: acceptedAnswers }} /> : null}

      {error ? (
        <p role="alert" className="text-muted-foreground">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={streaming}
        onClick={() => void generate()}
      >
        {text ? <RotateCcw /> : <Sparkles />}
        {text ? "Sinh lại giải thích" : "Giải thích bằng AI"}
      </Button>
    </section>
  );
}
