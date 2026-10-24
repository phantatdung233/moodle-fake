"use client";

import { useCallback, useState } from "react";
import { Check, Eye, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { blankNumber } from "@/lib/student/answers";
import { ExplanationPanel } from "@/components/quiz/explanation-panel";
import { ExplanationText } from "@/components/quiz/explanation-text";
import type { ExplanationContext } from "@/lib/gemini/explanation-format";

export type QuestionReviewProps = {
  attemptId?: string;
  index: number;
  question: Pick<QuizQuestion, "id" | "type" | "options" | "blanks" | "hash">;
  grade: AttemptQuestionResult;
  selectedOptionKeys: string[];
  blankValues: string[];
  body: React.ReactNode;
  explanation?: string | null;
};

export function QuestionReview({
  attemptId,
  index,
  question,
  grade,
  selectedOptionKeys,
  blankValues,
  body,
  explanation,
}: QuestionReviewProps) {
  const [showAnswers, setShowAnswers] = useState(explanation !== undefined);
  const hideAnswers = useCallback(() => setShowAnswers(false), []);
  const answered =
    selectedOptionKeys.length > 0 ||
    blankValues.some((value) => value.trim() !== "");
  const tone = grade.correct ? "correct" : answered ? "wrong" : "blank";
  const explanationContext: ExplanationContext = {
    selectedOptionKeys,
    blankValues,
    blankNames: question.blanks.map((blank, index) =>
      blankNumber(blank.name, index),
    ),
    correctOptionKeys: question.options
      .filter((option) => option.correct)
      .map((option) => option.key),
    correctBlankAnswers: question.blanks.map((blank) => blank.acceptedAnswer),
  };

  return (
    <article
      aria-label={`Câu ${index + 1}`}
      data-tone={tone}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5",
        tone === "correct" && "border-success-border",
        tone === "wrong" && "border-destructive-border",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b pb-3">
        <span className="font-medium tabular-nums">Câu {index + 1}</span>
        <Badge variant="outline" className="font-mono">
          {question.id}
        </Badge>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            tone === "correct" && "bg-success-surface text-success-foreground",
            tone === "wrong" && "bg-destructive-surface text-destructive",
            tone === "blank" && "bg-muted text-muted-foreground",
          )}
        >
          {tone === "correct" ? (
            <Check aria-hidden="true" className="size-3" />
          ) : tone === "wrong" ? (
            <X aria-hidden="true" className="size-3" />
          ) : (
            <Minus aria-hidden="true" className="size-3" />
          )}
          {tone === "correct" ? "Đúng" : tone === "wrong" ? "Sai" : "Bỏ trống"}
        </span>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {formatScore(grade.score)} điểm
        </span>
      </header>

      {body}

      {grade.perBlank && grade.perBlank.length > 0 && !showAnswers ? (
        <p className="text-sm text-muted-foreground">
          {grade.perBlank.filter((blank) => blank.correct).length}/
          {grade.perBlank.length} ô đúng
        </p>
      ) : null}

      {showAnswers ? (
        <>
          {question.type === "multichoice" ? (
            <ul className="flex flex-col gap-1 text-sm">
              {question.options.map((option) => {
                const picked = selectedOptionKeys.includes(option.key);
                const marker = option.correct
                  ? "correct"
                  : picked
                    ? "wrong"
                    : null;
                return (
                  <li
                    key={option.key}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5",
                      marker === "correct" &&
                        "border-success-border bg-success-surface",
                      marker === "wrong" &&
                        "border-destructive-border bg-destructive-surface",
                    )}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {option.key}.
                    </span>
                    <span className="min-w-0 flex-1">
                      {option.text.replace(/\s*\n+\s*/g, " ")}
                    </span>
                    {marker === null ? null : (
                      <span
                        className={cn(
                          "shrink-0 self-center",
                          marker === "correct"
                            ? "text-success-foreground"
                            : "text-destructive",
                        )}
                      >
                        {marker === "correct" ? (
                          <Check aria-hidden="true" className="size-4" />
                        ) : (
                          <X aria-hidden="true" className="size-4" />
                        )}
                        <span className="sr-only">
                          {marker === "correct"
                            ? "Đáp án đúng"
                            : "Bạn chọn, sai"}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {grade.perBlank && grade.perBlank.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {grade.perBlank.map((blank, position) => (
                <li
                  key={blank.name}
                  className={cn(
                    "flex flex-wrap items-center gap-x-1 gap-y-0.5",
                    blank.correct
                      ? "text-success-foreground"
                      : "text-destructive",
                  )}
                >
                  {blank.correct ? (
                    <Check aria-hidden="true" className="size-3 shrink-0" />
                  ) : (
                    <X aria-hidden="true" className="size-3 shrink-0" />
                  )}
                  <span className="text-muted-foreground">
                    Ô {position + 1}: bạn gõ
                  </span>{" "}
                  <span className="font-mono font-medium">
                    “{blank.value === "" ? "(để trống)" : blank.value}”
                  </span>
                  {blank.correct ? (
                    " — đúng"
                  ) : (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        / đáp án đúng
                      </span>{" "}
                      <span className="font-mono font-medium">
                        “{blank.acceptedAnswer}”
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {explanation === undefined && attemptId !== undefined ? (
            <ExplanationPanel
              attemptId={attemptId}
              questionId={question.id}
              questionHash={question.hash}
              mode="summary"
              context={explanationContext}
              onLoaded={hideAnswers}
            />
          ) : explanation === undefined ? null : (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium">
                Giải thích
              </p>
              {explanation ? (
                <ExplanationText
                  text={explanation}
                  context={explanationContext}
                />
              ) : (
                <p className="text-muted-foreground">
                  Chưa có giải thích.
                </p>
              )}
            </div>
          )}
        </>
      ) : explanation === undefined && attemptId !== undefined ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAnswers(true)}
          className="self-start"
        >
          <Eye aria-hidden /> Xem đáp án
        </Button>
      ) : null}
    </article>
  );
}

function formatScore(score: number): string {
  return score.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}
