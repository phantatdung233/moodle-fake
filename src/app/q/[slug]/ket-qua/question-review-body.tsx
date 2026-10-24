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

/**
 * The Question's own text for the summary page: markdown, the program with its
 * syntax highlighting (shiki runs on the server), the blank boxes already
 * coloured by whether they were right, and attached images.
 *
 * Kept apart from `question-review.tsx` so that component can be a client
 * component — highlighting cannot happen in the browser bundle — while this
 * one stays a server component and is handed in as `body`.
 */
export async function QuestionReviewBody({
  question,
  grade,
  blankValues,
}: {
  question: Pick<QuizQuestion, "content" | "blanks" | "images" | "no">;
  grade: AttemptQuestionResult;
  blankValues: string[];
}) {
  const blankIndex = new Map(
    question.blanks.map((blank, position) => [
      blankNumber(blank.name, position),
      position,
    ]),
  );
  const blocks = await prepareQuestionContent(
    question.content,
    question.blanks.length,
  );

  return (
    <>
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
    </>
  );
}
