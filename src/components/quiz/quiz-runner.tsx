"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ListChecks, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { splitPlaceholders } from "@/lib/quiz/content";
import { parseQuestionContent } from "@/lib/quiz/markdown";
import { describeFeedback, type FeedbackSummary } from "@/lib/student/feedback";
import {
  blankIndexByName,
  blankTone,
  draftFromAttempt,
  gradesOf,
  isRevealed,
  markRevealed,
  questionStatus,
  withAnswer,
  type Draft,
  type QuestionStatus,
} from "@/lib/student/answers";
import {
  CodeBlock,
  Prose,
  QuestionContent,
  QuestionImages,
} from "@/components/quiz/question-content";
import { saveAnswer, revealAnswer } from "@/lib/student/actions";

/** How long a text input waits before saving, so typing does not hit the DB per key. */
const SAVE_DEBOUNCE_MS = 600;

function feedbackFromAttempt(questionId: string, attempt: AttemptView): FeedbackSummary | null {
  const graded = gradesOf(attempt, questionId);
  if (!graded) return null;
  const question = attempt.questionsSnapshot.find((candidate) => candidate.id === questionId);
  return describeFeedback({
    correct: graded.correct,
    score: graded.score,
    perBlank: graded.perBlank,
    correctOptionKeys: question?.options.filter((option) => option.correct).map((option) => option.key),
  });
}

export type QuizRunnerProps = {
  /** Plain data (no Mongoose) so it survives the server → client boundary. */
  attempt: AttemptView;
};

/**
 * One Question per screen. Answers save as they change; a revealed Question is
 * locked by the server and shows đúng/sai + the correct answer. This component
 * owns all client state and makes sure a debounced keystroke is flushed before
 * any navigation, before a reveal, and on page unload.
 */
export function QuizRunner({ attempt: initialAttempt }: QuizRunnerProps) {
  const questions = initialAttempt.questionsSnapshot;
  const [current, setCurrent] = useState(0);
  const [attempt, setAttempt] = useState(initialAttempt);
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromAttempt(questions[0]?.id ?? "", initialAttempt),
  );
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(() =>
    feedbackFromAttempt(questions[0]?.id ?? "", initialAttempt),
  );
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const question = questions[current];

  /** A save still waiting on the debounce; a newer draft replaces it. */
  const pending = useRef<{ questionId: string; draft: Draft; timer: ReturnType<typeof setTimeout> | null } | null>(
    null,
  );
  // The unload listener is registered once, so read the pending save through a ref.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const flush = useCallback(async (): Promise<boolean> => {
    const queued = pending.current;
    if (!queued) return true;
    if (queued.timer) clearTimeout(queued.timer);
    pending.current = null;
    setSaving(true);
    try {
      const result = await saveAnswer({ questionId: queued.questionId, ...queued.draft });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setAttempt((previous) => withAnswer(previous, queued.questionId, queued.draft));
      return true;
    } catch {
      setError("Không lưu được câu trả lời. Kiểm tra kết nối rồi thử lại.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  // Never lose a debounced keystroke on reload / tab close.
  useEffect(() => {
    function onBeforeUnload() {
      const queued = pendingRef.current.current;
      if (!queued) return;
      pendingRef.current.current = null;
      void saveAnswer({ questionId: queued.questionId, ...queued.draft });
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function queueSave(nextDraft: Draft, immediate: boolean) {
    if (!question || isRevealed(attempt, question.id)) return;
    if (pending.current?.timer) clearTimeout(pending.current.timer);
    pending.current = { questionId: question.id, draft: nextDraft, timer: null };
    if (immediate) {
      void flush();
      return;
    }
    pending.current.timer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  async function goTo(index: number) {
    if (index < 0 || index >= questions.length || index === current) return;
    setError(null);
    // A failed save keeps the sinh viên on this Question so the answer is not lost.
    if (!(await flush())) return;

    const nextQuestion = questions[index];
    setCurrent(index);
    setDraft(draftFromAttempt(nextQuestion.id, attempt));
    setFeedback(feedbackFromAttempt(nextQuestion.id, attempt));
    setPanelOpen(false);
    window.scrollTo({ top: 0 });
  }

  async function onReveal() {
    if (!question || revealing) return;
    setError(null);
    if (!(await flush())) return;

    setRevealing(true);
    try {
      const result = await revealAnswer({ questionId: question.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAttempt((previous) => markRevealed(previous, question.id, draft));
      setFeedback(describeFeedback(result.feedback));
    } catch {
      setError("Không chấm được câu này. Kiểm tra kết nối rồi thử lại.");
    } finally {
      setRevealing(false);
    }
  }

  if (!question) {
    return <p className="text-sm text-muted-foreground">Đề này chưa có câu hỏi nào để làm.</p>;
  }

  const revealed = isRevealed(attempt, question.id);
  const statuses = questions.map((candidate) => questionStatus(candidate.id, attempt));
  const done = statuses.filter((status) => status !== "unanswered").length;
  const progress = Math.round((done / questions.length) * 100);
  const graded = gradesOf(attempt, question.id);

  const blocks = parseQuestionContent(splitPlaceholders(question.content, question.blanks.length));
  const blankIndex = blankIndexByName(question.blanks);

  function renderBlank(name: string): React.ReactNode {
    const index = blankIndex.get(name);
    if (index === undefined) return <span className="text-muted-foreground">____</span>;

    const value = draft.blankValues[index] ?? "";
    const tone = blankTone(graded?.perBlank?.[index]);

    return (
      <input
        aria-label={`Ô trống ${name}`}
        data-blank={name}
        value={value}
        disabled={revealed}
        onChange={(event) => {
          const blankValues = question.blanks.map((_, position) =>
            position === index ? event.target.value : (draft.blankValues[position] ?? ""),
          );
          const nextDraft = { ...draft, blankValues };
          setDraft(nextDraft);
          queueSave(nextDraft, false);
        }}
        className={cn(
          "inline-block h-8 min-w-24 rounded border border-input bg-background px-2 font-mono text-sm",
          tone === "wrong" && "border-destructive bg-destructive/10 text-destructive",
          tone === "correct" && "border-emerald-600 bg-emerald-50 text-emerald-900",
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">
            Câu {current + 1}/{questions.length}
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex items-center gap-1 text-xs" aria-live="polite">
              {saving ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Đang lưu…
                </>
              ) : (
                <>
                  <Check className="size-3" /> Đã lưu
                </>
              )}
            </span>
            <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListChecks /> Danh sách câu
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    Danh sách câu ({done}/{questions.length} đã làm)
                  </DialogTitle>
                  <DialogDescription>
                    Bấm số câu để nhảy tới. Câu đã xem đáp án sẽ bị khoá.
                  </DialogDescription>
                </DialogHeader>
                <QuestionPanel
                  questions={questions}
                  statuses={statuses}
                  current={current}
                  onJump={goTo}
                />
              </DialogContent>
            </Dialog>
          </span>
        </div>
        <Progress value={progress} aria-label={`Đã làm ${done}/${questions.length} câu`} />
      </div>

      <main className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Câu {question.no || current + 1}</Badge>
          {revealed ? <Badge variant="secondary">Đã khoá</Badge> : null}
        </div>

        <QuestionContent blocks={blocks} renderBlank={renderBlank} />
        <QuestionImages images={question.images} questionNo={question.no} />

        {question.options.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Lựa chọn</legend>
            {question.options.map((option) => {
              const checked = draft.selectedOptionKeys.includes(option.key);
              return (
                <label
                  key={option.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
                    checked && !revealed && "border-primary bg-primary/5",
                    revealed && option.correct && "border-emerald-600 bg-emerald-50",
                    revealed && checked && !option.correct && "border-destructive bg-destructive/10",
                    revealed && "cursor-default",
                  )}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.key}
                    checked={checked}
                    disabled={revealed}
                    onChange={() => {
                      // A radio only ever holds one key; saving immediately keeps it simple.
                      const nextDraft: Draft = { selectedOptionKeys: [option.key], blankValues: draft.blankValues };
                      setDraft(nextDraft);
                      queueSave(nextDraft, true);
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 font-mono text-muted-foreground">{option.key}.</span>
                    <OptionText text={option.text} />
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {feedback ? (
          <FeedbackPanel feedback={feedback} options={question.options} />
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">
              {attempt.mode === "practice"
                ? "Trả lời xong, bấm “Xem đáp án” để biết đúng/sai. Câu sẽ bị khoá sau đó."
                : "Chế độ kiểm tra: đáp án hiện sau khi nộp bài."}
            </p>
            {attempt.mode === "practice" ? (
              <Button type="button" onClick={onReveal} disabled={revealing} className="self-start">
                {revealing ? "Đang chấm…" : "Xem đáp án"}
              </Button>
            ) : null}
            {/* Ticket #9 renders the Gemini explanation panel here. */}
          </div>
        )}
      </main>

      <nav className="flex items-center justify-between gap-3 border-t pt-4">
        <Button variant="outline" onClick={() => goTo(current - 1)} disabled={current === 0}>
          <ArrowLeft /> Câu trước
        </Button>
        <Button
          onClick={() => goTo(current + 1)}
          disabled={current === questions.length - 1}
        >
          Câu sau <ArrowRight />
        </Button>
      </nav>
    </div>
  );
}

function QuestionPanel({
  questions,
  statuses,
  current,
  onJump,
}: {
  questions: readonly QuizQuestion[];
  statuses: readonly QuestionStatus[];
  current: number;
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-6 gap-2 sm:grid-cols-10" aria-label="Danh sách câu hỏi">
        {questions.map((question, index) => {
          const status = statuses[index];
          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => onJump(index)}
                aria-current={index === current ? "step" : undefined}
                aria-label={`Câu ${index + 1}: ${STATUS_LABEL[status]}`}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border text-sm transition-colors",
                  status === "revealed" && "border-emerald-600 bg-emerald-50 text-emerald-900",
                  status === "answered" && "border-primary bg-primary/10 font-medium",
                  status === "unanswered" && "border-input text-muted-foreground",
                  index === current && "ring-2 ring-ring ring-offset-1",
                )}
              >
                {index + 1}
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <li className="flex items-center gap-1">
          <span className="size-3 rounded border border-primary bg-primary/10" /> Đã trả lời
        </li>
        <li className="flex items-center gap-1">
          <span className="size-3 rounded border border-input" /> Chưa trả lời
        </li>
        <li className="flex items-center gap-1">
          <span className="size-3 rounded border border-emerald-600 bg-emerald-50" /> Đã khoá
        </li>
      </ul>
    </div>
  );
}

const STATUS_LABEL: Record<QuestionStatus, string> = {
  revealed: "đã khoá",
  answered: "đã trả lời",
  unanswered: "chưa trả lời",
};

function FeedbackPanel({
  feedback,
  options,
}: {
  feedback: FeedbackSummary;
  options: readonly { key: string; text: string; correct: boolean }[];
}) {
  const correct = feedback.tone === "correct";
  return (
    <section
      aria-live="polite"
      data-tone={feedback.tone}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4",
        correct ? "border-emerald-600/50 bg-emerald-50" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <p className={cn("text-base font-semibold", correct ? "text-emerald-900" : "text-destructive")}>
        {feedback.headline}
      </p>

      {feedback.accepted.length > 0 ? (
        <p className="text-sm">
          Đáp án đúng:{" "}
          <span className="font-medium">
            {feedback.accepted
              .map((key) => {
                const option = options.find((candidate) => candidate.key === key);
                return option ? `${key}. ${option.text.replace(/\s*\n+\s*/g, " ")}` : key;
              })
              .join(" · ")}
          </span>
        </p>
      ) : null}

      {feedback.wrongBlanks && feedback.wrongBlanks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {feedback.wrongBlanks.map((blank) => (
            <li key={blank.name} className="text-destructive">
              Ô này: bạn gõ{" "}
              <span className="font-mono font-medium">
                “{blank.typed === "" ? "(để trống)" : blank.typed}”
              </span>{" "}
              / đáp án đúng <span className="font-mono font-medium">“{blank.expected}”</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Option text can itself be a code snippet (`print(arr[1, 2])`), so it gets the
 * same treatment as the Question body — without blanks.
 */
function OptionText({ text }: { text: string }) {
  const blocks = parseQuestionContent(splitPlaceholders(text, 0));

  return (
    <span className="flex flex-col gap-1">
      {blocks.map((block, index) =>
        block.kind === "markdown" ? (
          <Prose key={index} text={block.text} />
        ) : (
          <CodeBlock key={index} lines={block.lines} renderBlank={() => null} />
        ),
      )}
    </span>
  );
}
