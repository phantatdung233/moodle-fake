"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import {
  QuestionContent,
  QuestionImages,
} from "@/components/quiz/question-content";
import type { RenderedQuestionContent } from "@/components/quiz/question-blocks";
import { reviewAnswer, reviewRemoveQuestion } from "@/lib/admin/review-actions";
import { AdminExplanation } from "./admin-explanation";

export type ReviewPageMode = "review" | "recheck";

/** What the page shows once there is nothing left to review. */
export type ReviewQueueSummary = {
  quizId: string;
  reviewPath: string;
  readyCount: number;
  remaining: number;
  /** Draft copy may invite a publish; published/archived may not. */
  quizStatus: "draft" | "published" | "archived";
};

/** The "nothing left to review" sentence, which depends on the Quiz's status. */
function doneDescription(done: ReviewQueueSummary, allDone: boolean): string {
  if (!allDone)
    return "Mọi câu đang bật đều đã có đáp án, hoặc không còn câu nào trong đề.";
  const count = `Tất cả ${done.readyCount} câu đang bật đã có đáp án.`;
  if (done.quizStatus === "draft") {
    return `${count} Đề vẫn là nháp — bạn có thể xem lại đáp án hoặc publish.`;
  }
  if (done.quizStatus === "published") {
    return `${count} Đề đã publish. Bấm "Xem lại đáp án" nếu muốn rà lại từng câu.`;
  }
  return `${count} Đề đã lưu trữ nên chỉ xem lại được.`;
}

type Props = {
  /** `null` when the queue is empty (or the quiz is read-only with nothing left). */
  question: QuizQuestion | null;
  mode: ReviewPageMode;
  readOnly: boolean;
  /** Every enabled Question, the N of "X/N câu đã có đáp án". */
  totalCount: number;
  answeredCount: number;
  /** The enabled `ready` Question ids, for the "Xem lại đáp án" list. */
  readyQueue: string[];
  /** A stored explanation for the shown Question, or `null` when none. */
  /**
   * Each reviewed Question's body, pre-parsed and pre-highlighted on the server
   * (`questionId → blocks`) so this client component never awaits shiki.
   */
  questionBodies: Record<string, RenderedQuestionContent[]>;
  /** Where "Sửa đáp án" / "Quay lại duyệt" point on this page. */
  reviewPath: string;
  recheckPath: string;
  done: ReviewQueueSummary;
};

/**
 * One Question at a time, rendered as a form. Saving hands the answer to a
 * server action and then asks the router for fresh server output — the action
 * revalidates both admin pages, so the next Question (or the "đã duyệt xong"
 * state) arrives without a hard reload and back/refresh still work.
 */
export function ReviewQuestion({
  question,
  mode,
  readOnly,
  totalCount,
  answeredCount,
  readyQueue,
  questionBodies,
  reviewPath,
  recheckPath,
  done,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    if (pending) return;
    setError(undefined);
    setPending(true);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          setError(result.error ?? "Không lưu được. Hãy thử lại.");
          return;
        }
        // Clears the "Xem lại đáp án" toggle so the next unreviewed Question shows first.
        setConfirmingRemove(false);
        router.replace(`${reviewPath}`);
        router.refresh();
      } catch {
        setError("Không lưu được. Kiểm tra kết nối rồi thử lại.");
      } finally {
        setPending(false);
      }
    });
  }

  function onSave(answer: Parameters<typeof reviewAnswer>[2]) {
    if (!question) return;
    run(() => reviewAnswer(done.quizId, question.id, answer));
  }

  function onRemove() {
    if (!question) return;
    run(() => reviewRemoveQuestion(done.quizId, question.id));
  }

  const finished = question === null;
  const shownReadyCount = readyQueue.length;

  return (
    <div className="flex flex-col gap-4">
      <Progress
        answeredCount={answeredCount}
        totalCount={totalCount}
        reviewPath={reviewPath}
        recheckPath={recheckPath}
        mode={mode}
        readyCount={shownReadyCount}
      />

      {readOnly ? (
        <p className="flex items-start gap-2 rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            Đề đã publish hoặc đã lưu trữ nên chỉ xem được đáp án. Muốn sửa, hãy
            huỷ publish trước.
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {finished ? (
        <FinishedCard done={done} mode={mode} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono">{question.id}</span>
              <span className="text-sm font-normal text-muted-foreground">
                Câu {question.no} ·{" "}
                {question.type === "multichoice"
                  ? "Trắc nghiệm"
                  : "Điền khuyết"}{" "}
                ·{" "}
                {question.status === "needs_review"
                  ? "Cần duyệt"
                  : "Đã có đáp án"}
              </span>
            </CardTitle>
            <CardDescription>
              {mode === "recheck"
                ? "Đề còn nháp nên vẫn sửa được đáp án đã duyệt."
                : "Chọn đáp án đúng của câu này rồi lưu để chuyển sang câu kế tiếp."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start xl:gap-8">
            {/* Wide screens: Question on the left, answer form on the right
                (sticky), so the giảng viên reads and types without scrolling
                back and forth. Narrow screens keep the single column. */}
            <div className="flex min-w-0 flex-col gap-5">
              <ReviewedQuestionContent
                blocks={questionBodies[question.id] ?? []}
                question={question}
              />

              {/* Story 21: the flag and the button only — no automatic guessing
                  at "this answer looks wrong". Tests inject a fake AI client. */}
              <AdminExplanation
                key={`${question.id}-explanation`}
                quizId={done.quizId}
                questionId={question.id}
                questionHash={question.hash}
                acceptedAnswers={acceptedAnswersOf(question)}
              />
            </div>

            <div className="flex flex-col gap-5 xl:sticky xl:top-4">
              {question.type === "multichoice" ? (
                <MultichoiceForm
                  key={`${question.id}-mc`}
                  question={question}
                  disabled={pending || readOnly}
                  onSubmit={onSave}
                />
              ) : (
                <MultianswerForm
                  key={`${question.id}-ma`}
                  question={question}
                  disabled={pending || readOnly}
                  onSubmit={onSave}
                />
              )}

              {readOnly ? null : (
                <div className="border-t pt-4">
                  {confirmingRemove ? (
                    <div className="flex flex-col gap-2 rounded-sm border border-destructive-border bg-destructive-surface p-3 text-sm">
                      <p>
                        Xoá câu{" "}
                        <span className="font-mono font-medium">
                          {question.id}
                        </span>{" "}
                        khỏi đề? Câu hỏi vẫn được lưu trong lịch sử nhưng không
                        còn tính vào đề và không hiện cho sinh viên.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={pending}
                          onClick={onRemove}
                        >
                          Xoá khỏi đề
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => setConfirmingRemove(false)}
                        >
                          Giữ lại
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmingRemove(true)}
                    >
                      Xoá câu này khỏi đề
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "recheck" && !finished ? (
        <div>
          <Button asChild variant="outline">
            <Link href={reviewPath}>← Quay lại duyệt câu chưa có đáp án</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Progress({
  answeredCount,
  totalCount,
  readyCount,
  reviewPath,
  recheckPath,
  mode,
}: {
  answeredCount: number;
  totalCount: number;
  readyCount: number;
  reviewPath: string;
  recheckPath: string;
  mode: ReviewPageMode;
}) {
  const percent =
    totalCount === 0 ? 100 : Math.round((answeredCount / totalCount) * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <p className="shrink-0 text-sm font-medium tabular-nums">
          {answeredCount}/{totalCount} câu đã có đáp án
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {percent}%
          </span>
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={answeredCount}
          aria-label="Tiến độ duyệt đáp án"
          className="h-2 w-full flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant={mode === "review" ? "secondary" : "ghost"}
          size="sm"
        >
          <Link href={reviewPath}>
            Duyệt câu cần đáp án ({totalCount - answeredCount})
          </Link>
        </Button>
        <Button
          asChild
          variant={mode === "recheck" ? "secondary" : "ghost"}
          size="sm"
          disabled={readyCount === 0}
        >
          {readyCount === 0 ? (
            <span aria-disabled="true" className="text-muted-foreground">
              Xem lại đáp án (0)
            </span>
          ) : (
            <Link href={recheckPath}>Xem lại đáp án ({readyCount})</Link>
          )}
        </Button>
      </div>
    </div>
  );
}

function FinishedCard({
  done,
  mode,
}: {
  done: ReviewQueueSummary;
  mode: ReviewPageMode;
}) {
  const allDone = done.remaining === 0 && done.readyCount > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {allDone ? "Đã duyệt xong đáp án" : "Không còn câu nào cần sửa ở đây"}
        </CardTitle>
        <CardDescription>{doneDescription(done, allDone)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/admin/quizzes/${done.quizId}`}>Về trang đề</Link>
        </Button>
        {mode === "recheck" ? (
          <Button asChild variant="outline">
            <Link href={done.reviewPath}>Duyệt câu chưa có đáp án</Link>
          </Button>
        ) : allDone ? (
          <Button asChild variant="outline">
            <Link href={`${done.reviewPath}?tab=ready`}>Xem lại đáp án</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/admin">Danh sách đề</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The Question body exactly as a sinh viên sees it — the same renderer, so
 * `[[n]]` markers sit at their real positions in prose and in code. Blanks are
 * read-only here: the giảng viên edits the answers in the form below. The
 * blocks are prepared on the server (`prepareQuestionContent`), since this
 * client component cannot await shiki.
 */
/**
 * What the Quiz records as correct, for the explanation's verdict line:
 * the correct option keys, or one accepted answer per blank.
 */
function acceptedAnswersOf(question: QuizQuestion): string[] {
  if (question.type === "multianswer") {
    return question.blanks
      .map((blank) => blank.acceptedAnswer)
      .filter((answer) => answer !== "");
  }
  return question.options
    .filter((option) => option.correct)
    .map((option) => option.key);
}

function ReviewedQuestionContent({
  blocks,
  question,
}: {
  blocks: readonly RenderedQuestionContent[];
  question: QuizQuestion;
}) {
  return (
    <div className="flex flex-col gap-2 text-base">
      <QuestionContent
        blocks={blocks}
        renderBlank={(name) => (
          <span className="mx-0.5 inline-block min-w-16 rounded border border-dashed border-input bg-muted px-2 text-center font-mono text-sm text-muted-foreground">
            [[{name}]]
          </span>
        )}
      />
      <QuestionImages images={question.images} questionNo={question.no} />
    </div>
  );
}

function MultichoiceForm({
  question,
  disabled,
  onSubmit,
}: {
  question: QuizQuestion;
  disabled: boolean;
  onSubmit: (answer: { selectedOptionKeys: string[] }) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    question.options
      .filter((option) => option.correct)
      .map((option) => option.key),
  );

  function toggle(key: string) {
    setPicked((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ selectedOptionKeys: picked });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Tick một hoặc nhiều đáp án đúng
        </legend>
        {question.options.length === 0 ? (
          <p className="text-sm text-destructive">
            Câu này không có lựa chọn nào — hãy xoá câu khỏi đề.
          </p>
        ) : null}
        {question.options.map((option) => {
          const checked = picked.includes(option.key);
          return (
            <label
              key={option.key}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2 transition-colors duration-200",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted/60",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="checkbox"
                name="option"
                value={option.key}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(option.key)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="font-mono text-xs text-muted-foreground">
                  {option.key}.
                </span>{" "}
                <span className="break-words">{option.text}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Lưu đáp án &amp; câu tiếp theo</Button>
          <p className="text-xs text-muted-foreground">
            Đã chọn {picked.length} đáp án.
          </p>
        </div>
      )}
    </form>
  );
}

function MultianswerForm({
  question,
  disabled,
  onSubmit,
}: {
  question: QuizQuestion;
  disabled: boolean;
  onSubmit: (answer: { blankAnswers: string[] }) => void;
}) {
  const [values, setValues] = useState<string[]>(() =>
    question.blanks.map((blank) => blank.acceptedAnswer),
  );
  const [localError, setLocalError] = useState<string | undefined>();

  const emptyCount = values.filter((value) => value.trim() === "").length;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (emptyCount > 0) {
      setLocalError("Hãy điền đáp án cho tất cả các ô trống.");
      return;
    }
    setLocalError(undefined);
    onSubmit({ blankAnswers: values });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {question.blanks.map((blank, index) => {
          const inputId = `${question.id}-blank-${index}`;
          return (
            <div key={blank.name} className="flex flex-col gap-2">
              <Label htmlFor={inputId} className="gap-2">
                Ô trống {index + 1} của {question.blanks.length}
                <code className="font-mono text-xs text-muted-foreground">
                  [[{index + 1}]]
                </code>
              </Label>
              <Input
                id={inputId}
                name={`blank-${index}`}
                value={values[index] ?? ""}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={
                  localError && values[index]?.trim() === "" ? true : undefined
                }
                onChange={(event) =>
                  setValues((current) =>
                    current.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  )
                }
                className="font-mono"
              />
            </div>
          );
        })}
      </div>

      {localError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {localError}
        </p>
      ) : null}

      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Lưu đáp án &amp; câu tiếp theo</Button>
          {emptyCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Còn {emptyCount} ô trống chưa điền.
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
