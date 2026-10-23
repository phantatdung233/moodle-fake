import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { splitPlaceholders } from "@/lib/quiz/content";
import { parseQuestionContent } from "@/lib/quiz/markdown";
import { blankNumber } from "@/lib/student/answers";
import { CodeBlock, Prose, QuestionImages } from "@/components/quiz/question-content";
import { ExplanationPanel } from "@/components/quiz/explanation-panel";

export type QuestionReviewProps = {
  index: number;
  question: QuizQuestion;
  grade: AttemptQuestionResult;
  selectedOptionKeys: string[];
  blankValues: string[];
};

/**
 * One Question on the summary page: what the sinh viên picked, which option is
 * correct, per-blank detail for a multianswer, and the score. Server-rendered
 * (shiki highlight), practice and exam alike.
 */
export function QuestionReview({
  index,
  question,
  grade,
  selectedOptionKeys,
  blankValues,
}: QuestionReviewProps) {
  const answered =
    selectedOptionKeys.length > 0 || blankValues.some((value) => value.trim() !== "");
  const tone = grade.correct ? "correct" : answered ? "wrong" : "blank";
  const blankIndex = new Map(
    question.blanks.map((blank, position) => [blankNumber(blank.name, position), position]),
  );
  const blocks = parseQuestionContent(splitPlaceholders(question.content, question.blanks.length));

  return (
    <article
      aria-label={`Câu ${index + 1}`}
      data-tone={tone}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        tone === "correct" && "border-emerald-600/50",
        tone === "wrong" && "border-destructive/40",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Câu {index + 1}</span>
        <Badge variant="outline">Mã {question.id}</Badge>
        {tone === "correct" ? (
          <Badge variant="secondary">Đúng</Badge>
        ) : tone === "wrong" ? (
          <Badge variant="destructive">Sai</Badge>
        ) : (
          <Badge variant="outline">Bỏ trống</Badge>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {formatScore(grade.score)} điểm
        </span>
      </header>

      <div className="flex flex-col gap-1 text-sm">
        {blocks.map((block, blockIndex) =>
          block.kind === "markdown" ? (
            <Prose key={blockIndex} text={block.text} />
          ) : (
            <CodeBlock
              key={blockIndex}
              lines={block.lines}
              renderBlank={(name) => {
                const position = blankIndex.get(name);
                const value = position === undefined ? "" : (blankValues[position] ?? "");
                const blank = position === undefined ? undefined : grade.perBlank?.[position];
                return (
                  <span
                    className={cn(
                      "inline-block min-w-24 rounded border px-2 font-mono",
                      blank?.correct
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                        : "border-destructive bg-destructive/10 text-destructive",
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
                  "flex gap-2 rounded border px-2 py-1",
                  option.correct && "border-emerald-600/50 bg-emerald-50",
                  picked && !option.correct && "border-destructive/40 bg-destructive/5",
                )}
              >
                <span className="font-mono text-muted-foreground">{option.key}.</span>
                <span className="min-w-0 flex-1">{option.text.replace(/\s*\n+\s*/g, " ")}</span>
                {option.correct ? (
                  <span className="shrink-0 text-xs font-medium text-emerald-700">đáp án đúng</span>
                ) : null}
                {picked ? (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
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
            <li key={blank.name} className={blank.correct ? "text-emerald-800" : "text-destructive"}>
              Ô {position + 1}: bạn gõ{" "}
              <span className="font-mono font-medium">
                “{blank.value === "" ? "(để trống)" : blank.value}”
              </span>
              {blank.correct ? (
                " — đúng"
              ) : (
                <>
                  {" "}
                  / đáp án đúng <span className="font-mono font-medium">“{blank.acceptedAnswer}”</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Ticket #9: the explanation streams in under the graded answer, practice
          or exam alike. A blank Question still shows the model's explanation. */}
      <ExplanationPanel
        questionId={question.id}
        questionHash={question.hash}
        mode="summary"
      />
    </article>
  );
}

function formatScore(score: number): string {
  return score.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}
