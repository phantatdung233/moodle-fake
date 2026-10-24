import { Check, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { blankNumber } from "@/lib/student/answers";
import {
  CodeBlock,
  Prose,
  QuestionImages,
} from "@/components/quiz/question-content";
import { prepareQuestionContent } from "@/components/quiz/question-blocks";
import { ExplanationPanel } from "@/components/quiz/explanation-panel";
import { ExplanationText } from "@/components/quiz/explanation-text";

export type QuestionReviewProps = {
  /**
   * The Attempt these answers belong to; the AI panel names it so the server
   * can check the cookie's MSSV owns it. Omitted on the admin's read-only view,
   * which shows stored explanations instead of calling the model.
   */
  attemptId?: string;
  index: number;
  question: QuizQuestion;
  grade: AttemptQuestionResult;
  selectedOptionKeys: string[];
  blankValues: string[];
  /**
   * A stored explanation shown instead of the AI panel. Only the admin's
   * attempt detail passes one; `null` means "ask the model".
   */
  explanation?: string | null;
};

/**
 * One Question on the summary page: what the sinh viên picked, which option is
 * correct, per-blank detail for a multianswer, and the score. Server-rendered
 * (shiki highlight), practice and exam alike.
 */
export async function QuestionReview({
  attemptId,
  index,
  question,
  grade,
  selectedOptionKeys,
  blankValues,
  explanation,
}: QuestionReviewProps) {
  const answered =
    selectedOptionKeys.length > 0 ||
    blankValues.some((value) => value.trim() !== "");
  const tone = grade.correct ? "correct" : answered ? "wrong" : "blank";
  const blankIndex = new Map(
    question.blanks.map((blank, position) => [
      blankNumber(blank.name, position),
      position,
    ]),
  );
  const blanks = await prepareQuestionContent(
    question.content,
    question.blanks.length,
  );
  const explanationContext = {
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

      <div className="flex flex-col gap-1 text-sm">
        {blanks.map((block, blockIndex) =>
          block.kind === "markdown" ? (
            <Prose key={blockIndex} text={block.text} />
          ) : (
            <CodeBlock
              key={blockIndex}
              lines={block.lines}
              renderBlank={(name) => {
                const position = blankIndex.get(name);
                const value =
                  position === undefined ? "" : (blankValues[position] ?? "");
                const blank =
                  position === undefined
                    ? undefined
                    : grade.perBlank?.[position];
                return (
                  <span
                    className={cn(
                      "inline-block min-w-24 rounded-md border px-2 font-mono",
                      blank?.correct
                        ? "border-success-border bg-success-surface text-success-foreground"
                        : "border-destructive-border bg-destructive-surface text-destructive",
                    )}
                  >
                    {value === "" ? "(trống)" : value}
                  </span>
                );
              }}
            />
          ),
        )}
      </div>
      <QuestionImages images={question.images} questionNo={question.no} />

      {question.type === "multichoice" ? (
        <ul className="flex flex-col gap-1 text-sm">
          {question.options.map((option) => {
            const picked = selectedOptionKeys.includes(option.key);
            return (
              <li
                key={option.key}
                className={cn(
                  "flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5",
                  option.correct && "border-success-border bg-success-surface",
                  picked &&
                    !option.correct &&
                    "border-destructive-border bg-destructive-surface",
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {option.key}.
                </span>
                <span className="min-w-0 flex-1">
                  {option.text.replace(/\s*\n+\s*/g, " ")}
                </span>
                {option.correct ? (
                  <span className="flex shrink-0 items-center gap-1 self-center text-xs font-medium text-success-foreground">
                    <Check aria-hidden="true" className="size-3" /> đáp án đúng
                  </span>
                ) : null}
                {picked ? (
                  <span className="shrink-0 self-center text-xs font-medium text-muted-foreground">
                    bạn chọn
                  </span>
                ) : null}
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
                blank.correct ? "text-success-foreground" : "text-destructive",
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

      {/* The explanation sits under the graded answer, practice or exam alike,
          but only appears once the sinh viên clicks — the answer itself is
          already visible. A blank Question still gets one. The admin's attempt
          detail passes a stored explanation instead of the panel, so reading an
          old paper never calls the model. */}
      {explanation === undefined && attemptId !== undefined ? (
        <ExplanationPanel
          attemptId={attemptId}
          questionId={question.id}
          questionHash={question.hash}
          mode="summary"
          context={explanationContext}
        />
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">
            Giải thích{explanation ? " đã lưu" : ""}
          </p>
          {explanation ? (
            <ExplanationText text={explanation} context={explanationContext} />
          ) : (
            <p className="text-muted-foreground">
              Chưa có giải thích cho câu này.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function formatScore(score: number): string {
  return score.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}
