"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ListChecks,
  Loader2,
  Send,
  Timer,
  X,
} from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { describeFeedback, type FeedbackSummary } from "@/lib/student/feedback";
import {
  blankIndexByName,
  blankNumber,
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
  QuestionContent,
  Prose,
  QuestionImages,
} from "@/components/quiz/question-content";
import type { RenderedQuestionContent } from "@/components/quiz/question-blocks";
import { formatCountdown, isExpired, remainingMs } from "@/lib/student/exam";
import {
  saveAnswer,
  revealAnswer,
  submitMyAttempt,
} from "@/lib/student/actions";
import { ExplanationPanel } from "@/components/quiz/explanation-panel";
import type { ExplanationContext } from "@/lib/gemini/explanation-format";

/**
 * What the AI panel needs to complete a verdict the model did not spell out:
 * the recorded answer (option keys or accepted blanks) and what the sinh viên
 * picked. Revealed Questions are locked, so the draft is the final answer.
 */
function explanationContextOf(
  question: QuizQuestion,
  draft: Draft,
): ExplanationContext {
  return {
    selectedOptionKeys: draft.selectedOptionKeys,
    blankValues: draft.blankValues,
    blankNames: question.blanks.map((blank, index) =>
      blankNumber(blank.name, index),
    ),
    correctOptionKeys: question.options
      .filter((option) => option.correct)
      .map((option) => option.key),
    correctBlankAnswers: question.blanks.map((blank) => blank.acceptedAnswer),
  };
}

/** How long a text input waits before saving, so typing does not hit the DB per key. */
const SAVE_DEBOUNCE_MS = 600;

function feedbackFromAttempt(
  questionId: string,
  attempt: AttemptView,
): FeedbackSummary | null {
  const graded = gradesOf(attempt, questionId);
  if (!graded) return null;
  const question = attempt.questionsSnapshot.find(
    (candidate) => candidate.id === questionId,
  );
  return describeFeedback({
    correct: graded.correct,
    score: graded.score,
    perBlank: graded.perBlank,
    correctOptionKeys: question?.options
      .filter((option) => option.correct)
      .map((option) => option.key),
  });
}

export type QuizRunnerProps = {
  /** Plain data (no Mongoose) so it survives the server → client boundary. */
  attempt: AttemptView;
  /**
   * Each snapshot Question's body, already parsed and highlighted on the server
   * (`questionId → blocks`). A client component may not be async, so the runner
   * renders finished blocks instead of calling shiki itself.
   */
  questionBodies: Record<string, RenderedQuestionContent[]>;
  /** Where the "học" link goes: the student's own summary for this Quiz. */
  summaryHref: string;
};

/**
 * One Question per screen. Answers save as they change; a revealed Question is
 * locked by the server and shows đúng/sai + the correct answer. This component
 * owns all client state and makes sure a debounced keystroke is flushed before
 * any navigation, before a reveal, and on page unload.
 */
export function QuizRunner({
  attempt: initialAttempt,
  questionBodies,
  summaryHref,
}: QuizRunnerProps) {
  const router = useRouter();
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
  const [remaining, setRemaining] = useState<number | null>(() =>
    remainingMs(initialAttempt.deadline, new Date()),
  );
  const [timeUp, setTimeUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const question = questions[current];
  const exam = initialAttempt.mode === "exam";

  /** A save still waiting on the debounce; a newer draft replaces it. */
  const pending = useRef<{
    questionId: string;
    draft: Draft;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
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
      const result = await saveAnswer({
        attemptId: initialAttempt.id,
        questionId: queued.questionId,
        ...queued.draft,
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setAttempt((previous) =>
        withAnswer(previous, queued.questionId, queued.draft),
      );
      return true;
    } catch {
      setError("Không lưu được câu trả lời. Kiểm tra kết nối rồi thử lại.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [initialAttempt.id]);

  // Exam countdown. The clock drives the display; the server re-checks the
  // deadline on every save and on submit, so a paused tab buys nothing.
  useEffect(() => {
    if (!initialAttempt.deadline) return;
    const tick = () =>
      setRemaining(remainingMs(initialAttempt.deadline, new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [initialAttempt.deadline]);

  // Auto-submit at expiry: flush whatever is still debounced, then submit.
  // `submitExpiredIfDue` on the server marks the Attempt `expired`, so even a
  // closed tab ends up submitted.
  useEffect(() => {
    // The tick sets `remaining` to exactly 0 at the deadline, so waiting for
    // `remaining === null` (no limit) also means this never fires for practice.
    if (remaining === null || remaining > 0 || timeUp) return;
    if (!isExpired(initialAttempt.deadline, new Date())) return;

    let cancelled = false;
    setTimeUp(true);
    void (async () => {
      await flush();
      try {
        await submitMyAttempt({ attemptId: initialAttempt.id });
      } catch {
        // The summary page will show the stored result; nothing to recover here.
      }
      if (!cancelled) router.replace(summaryHrefOf(initialAttempt.quizSlug));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    initialAttempt.deadline,
    initialAttempt.id,
    initialAttempt.quizSlug,
    remaining,
    timeUp,
    flush,
    router,
  ]);

  // Never lose a debounced keystroke on reload / tab close.
  useEffect(() => {
    function onBeforeUnload() {
      const queued = pendingRef.current.current;
      if (!queued) return;
      pendingRef.current.current = null;
      void saveAnswer({ attemptId: initialAttempt.id, questionId: queued.questionId, ...queued.draft });
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [initialAttempt.id]);

  function queueSave(nextDraft: Draft, immediate: boolean) {
    if (!question || isRevealed(attempt, question.id) || timeUp) return;
    if (pending.current?.timer) clearTimeout(pending.current.timer);
    pending.current = {
      questionId: question.id,
      draft: nextDraft,
      timer: null,
    };
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
      const result = await revealAnswer({
        attemptId: initialAttempt.id,
        questionId: question.id,
      });
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

  async function onSubmitPaper() {
    if (submitting) return;
    setError(null);
    // The last keystroke must be saved before grading, or it would score 0.
    if (!(await flush())) return;

    setSubmitting(true);
    try {
      const result = await submitMyAttempt({ attemptId: initialAttempt.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace(summaryHrefOf(initialAttempt.quizSlug));
    } catch {
      setError("Không nộp được bài. Kiểm tra kết nối rồi thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!question) {
    return (
      <p className="text-sm text-muted-foreground">
        Đề này chưa có câu hỏi nào để làm.
      </p>
    );
  }

  const revealed = isRevealed(attempt, question.id);
  const statuses = questions.map((candidate) =>
    questionStatus(candidate.id, attempt),
  );
  const done = statuses.filter((status) => status !== "unanswered").length;
  const progress = Math.round((done / questions.length) * 100);
  const graded = gradesOf(attempt, question.id);

  const blankIndex = blankIndexByName(question.blanks);

  function renderBlank(name: string): React.ReactNode {
    const index = blankIndex.get(name);
    if (index === undefined)
      return <span className="text-muted-foreground">____</span>;

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
            position === index
              ? event.target.value
              : (draft.blankValues[position] ?? ""),
          );
          const nextDraft = { ...draft, blankValues };
          setDraft(nextDraft);
          queueSave(nextDraft, false);
        }}
        className={cn(
          "inline-block h-7 min-w-24 rounded-md border border-input bg-background px-2 font-mono text-sm",
          tone === "wrong" &&
            "border-destructive-border bg-destructive-surface text-destructive",
          tone === "correct" &&
            "border-success-border bg-success-surface text-success-foreground",
        )}
      />
    );
  }

  const last = current === questions.length - 1;

  /** The mini map: always visible on a phone, the whole rail on a desktop. */
  const panel = (
    <QuestionPanel
      questions={questions}
      statuses={statuses}
      current={current}
      onJump={goTo}
    />
  );

  /**
   * Everything that used to sit in a side rail lives in two bars now: "Nộp
   * bài" at the top, page-turning at the bottom, both fixed, so they stay put
   * while the Question scrolls. One column of content in between.
   */
  const listButton = (
    <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Danh sách câu">
          <ListChecks aria-hidden />
          <span className="hidden sm:inline">Danh sách câu</span>
          <span className="tabular-nums sm:hidden" aria-hidden>
            {current + 1}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Danh sách câu ({done}/{questions.length} đã làm)
          </DialogTitle>
          <DialogDescription>
            Chọn câu để chuyển. Câu đã khoá không thể sửa.
          </DialogDescription>
        </DialogHeader>
        {panel}
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {/* Fixed on every screen size: the Question scrolls underneath it, so
          Nộp bài is always one click away. Full width, content centred. */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 pb-2 pt-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex items-center gap-3 text-sm">
              <Link
                href="/"
                aria-label="Về danh sách đề"
                className="inline-flex items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </Link>
              <span className="font-medium tabular-nums">
                {done}/{questions.length} câu
              </span>
              <span className="hidden text-xs text-muted-foreground md:inline">
                {questions.length - done === 0
                  ? "Đã làm hết"
                  : `Còn ${questions.length - done} câu`}
              </span>
              <span className="text-muted-foreground" aria-live="polite">
                {saving ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Đang
                    lưu…
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3" aria-hidden /> Đã lưu
                  </span>
                )}
              </span>
              {exam && remaining !== null ? (
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
                    remaining <= 5 * 60_000
                      ? "border-destructive-border bg-destructive-surface text-destructive"
                      : "border-border text-foreground",
                  )}
                  role="timer"
                  aria-live={remaining <= 5 * 60_000 ? "assertive" : "off"}
                  aria-label="Thời gian còn lại"
                >
                  <Timer className="size-3.5" aria-hidden />
                  {timeUp ? "Hết giờ" : formatCountdown(remaining)}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {/* Below `xl` the list only exists in this dialog; from `xl` up
                  it sits beside the Question, so the button would be a rerun. */}
              <span className="xl:hidden">{listButton}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={submitting}
                    variant={
                      questions.length - done === 0 ? "default" : "outline"
                    }
                  >
                    <Send aria-hidden />
                    {submitting ? "Đang nộp…" : "Nộp bài"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Nộp bài?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {questions.length - done === 0
                        ? "Bài không sửa được nữa sau khi nộp."
                        : `Còn ${questions.length - done} câu chưa trả lời sẽ tính 0 điểm. Bài không sửa được nữa sau khi nộp.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Làm tiếp</AlertDialogCancel>
                    <AlertDialogAction onClick={onSubmitPaper}>
                      Nộp bài
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <Progress
            value={progress}
            aria-label={`Đã làm ${done}/${questions.length} câu`}
            className="h-1"
          />
        </div>
      </div>

      {/* The bars are fixed over the content: the padding keeps the last line
          of the Question clear of the bottom bar. From `xl` up the list of
          Questions is a real second column, in the page flow like the Question
          itself: it scrolls away with it, then sticks once it reaches the bar. */}
      <div className="flex flex-col gap-4 pb-28 pt-5 xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-start xl:gap-6">
        <div className="flex flex-col gap-4">
          <article className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
            <header className="flex flex-wrap items-center gap-2 border-b pb-3">
              <Badge variant="outline" className="font-mono tabular-nums">
                Câu {question.no || current + 1}
                <span className="text-muted-foreground">
                  /{questions.length}
                </span>
              </Badge>
              <span className="text-xs text-muted-foreground">
                {question.type === "multianswer"
                  ? `Điền ${question.blanks.length} chỗ trống`
                  : "Chọn một đáp án"}
              </span>
              {revealed ? (
                <Badge variant="secondary" className="ml-auto">
                  Đã khoá
                </Badge>
              ) : null}
            </header>

            <QuestionContent
              blocks={questionBodies[question.id] ?? []}
              renderBlank={renderBlank}
            />
            <QuestionImages images={question.images} questionNo={question.no} />

            {question.options.length > 0 ? (
              <fieldset
                data-layout={
                  question.options.every((option) => option.text.length <= 60)
                    ? "grid"
                    : "list"
                }
                className="flex flex-col gap-2 data-[layout=grid]:sm:grid data-[layout=grid]:sm:grid-cols-2"
              >
                <legend className="sr-only">Lựa chọn</legend>
                {question.options.map((option) => {
                  const checked = draft.selectedOptionKeys.includes(option.key);
                  const showCorrect = revealed && option.correct;
                  const showWrongPick = revealed && checked && !option.correct;
                  return (
                    <label
                      key={option.key}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors duration-200",
                        "border-border hover:border-foreground/25 hover:bg-muted/60",
                        checked &&
                          !revealed &&
                          "border-primary bg-primary/5 hover:bg-primary/5",
                        showCorrect &&
                          "border-success-border bg-success-surface hover:bg-success-surface",
                        showWrongPick &&
                          "border-destructive-border bg-destructive-surface hover:bg-destructive-surface",
                        revealed && "cursor-default hover:border-[inherit]",
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
                          const nextDraft: Draft = {
                            selectedOptionKeys: [option.key],
                            blankValues: draft.blankValues,
                          };
                          setDraft(nextDraft);
                          queueSave(nextDraft, true);
                        }}
                        className="mt-0.5 size-4 shrink-0 accent-primary disabled:accent-muted-foreground disabled:opacity-100"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {option.key}.
                        </span>
                        <OptionText text={option.text} />
                      </span>
                      {showCorrect ? (
                        <span className="flex shrink-0 items-center gap-1 self-center text-xs font-medium text-success-foreground">
                          <Check className="size-3.5" aria-hidden />
                          đáp án đúng
                        </span>
                      ) : null}
                      {showWrongPick ? (
                        <span className="flex shrink-0 items-center gap-1 self-center text-xs font-medium text-destructive">
                          <X className="size-3.5" aria-hidden />
                          bạn chọn
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </article>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {feedback ? (
            <FeedbackPanel feedback={feedback} options={question.options} />
          ) : null}

          {/* Practice only: the Question is revealed, so the panel offers an
              explanation under the feedback — it waits for a click, so seeing the
              answer is instant. Exam mode never reveals here — its panel lives on
              the summary page after submission. */}
          {revealed && attempt.mode === "practice" ? (
            <ExplanationPanel
              key={question.id}
              attemptId={initialAttempt.id}
              questionId={question.id}
              questionHash={question.hash}
              mode="practice"
              context={explanationContextOf(question, draft)}
            />
          ) : null}

          {timeUp ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-sm text-destructive"
            >
              Đã hết giờ. Bài đang được nộp tự động…
            </p>
          ) : null}
        </div>

        {/* Only when the screen is truly wide: the list of Questions beside the
          Question, so jumping between them needs no dialog. It scrolls with
          the page and sticks under the top bar once it gets there. */}
        <aside
          aria-label="Danh sách câu"
          className="scroll-quiet hidden xl:sticky xl:top-36 xl:block xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto xl:rounded-xl xl:border xl:bg-card xl:p-3"
        >
          {panel}
        </aside>
      </div>

      {/* Fixed at the bottom: previous / the one action that teaches / next,
          so neither turning the page nor seeing why you were right needs a
          scroll. Practice only — exam reveals nothing before submitting. */}
      <nav
        aria-label="Chuyển câu"
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-6">
          <Button
            variant="outline"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
            aria-label="Câu trước"
            className="size-9 shrink-0 px-0 sm:h-8 sm:w-auto sm:px-2.5"
          >
            <ArrowLeft aria-hidden />
            <span className="hidden sm:inline">Câu trước</span>
          </Button>

          {!exam && !revealed ? (
            <Button
              type="button"
              onClick={onReveal}
              disabled={revealing}
              className="min-w-0 flex-1 gap-1.5 bg-brand text-brand-foreground hover:bg-brand/85 sm:max-w-xs"
            >
              <Check aria-hidden />
              {revealing ? "Đang chấm…" : "Kiểm tra câu này"}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground tabular-nums">
              {current + 1}/{questions.length}
            </span>
          )}

          {last && !exam && !revealed ? (
            <Button asChild variant="outline" className="shrink-0">
              <Link href={summaryHref}>Kết quả</Link>
            </Button>
          ) : (
            <Button
              onClick={() => goTo(current + 1)}
              disabled={last}
              aria-label="Câu sau"
              className="shrink-0 gap-1.5"
            >
              <span className="hidden sm:inline">Câu sau</span>
              <span className="sm:hidden">Tiếp</span>
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </nav>
    </>
  );
}

/** Where "nộp bài" lands: the student's own summary for this Quiz. */
function summaryHrefOf(slug: string): string {
  return `/q/${slug}/ket-qua`;
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
      <ul
        className="scroll-quiet grid max-h-[22rem] auto-cols-[minmax(0,1fr)] grid-flow-row grid-cols-6 gap-1.5 overflow-y-auto overflow-x-hidden pr-2"
        aria-label="Danh sách câu hỏi"
      >
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
                  "flex aspect-square w-full items-center justify-center rounded-md border text-sm tabular-nums transition-colors duration-200 hover:border-foreground/40",
                  status === "revealed" &&
                    "border-success-border bg-success-surface text-success-foreground",
                  status === "answered" &&
                    "border-primary bg-primary/10 font-medium hover:bg-primary/15",
                  status === "unanswered" &&
                    "border-input text-muted-foreground",
                  index === current && "ring-2 ring-ring",
                )}
              >
                {index + 1}
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-primary bg-primary/10" />{" "}
          Đã trả lời
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-input" /> Chưa trả
          lời
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-success-border bg-success-surface" />{" "}
          Đã khoá
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
        "flex flex-col gap-2 rounded-xl border p-4",
        correct
          ? "border-success-border bg-success-surface"
          : "border-destructive-border bg-destructive-surface",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 text-base font-semibold",
          correct ? "text-success-foreground" : "text-destructive",
        )}
      >
        {correct ? (
          <Check aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <X aria-hidden="true" className="size-4 shrink-0" />
        )}
        {feedback.headline}
      </p>

      {feedback.accepted.length > 0 ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Đáp án đúng: </span>
          <span className="font-medium">
            {feedback.accepted
              .map((key) => {
                const option = options.find(
                  (candidate) => candidate.key === key,
                );
                return option
                  ? `${key}. ${option.text.replace(/\s*\n+\s*/g, " ")}`
                  : key;
              })
              .join(" · ")}
          </span>
        </p>
      ) : null}

      {feedback.wrongBlanks && feedback.wrongBlanks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {feedback.wrongBlanks.map((blank) => (
            <li
              key={blank.name}
              className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-destructive"
            >
              <X aria-hidden="true" className="size-3 shrink-0" />
              <span className="text-muted-foreground">Bạn gõ</span>
              <span className="font-mono font-medium">
                “{blank.typed === "" ? "(để trống)" : blank.typed}”
              </span>
              <span className="text-muted-foreground">/ đáp án đúng</span>
              <span className="font-mono font-medium text-success-foreground">
                “{blank.expected}”
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Option text can itself contain inline markdown/backticks, but never a code
 * block (checked across the export), so it skips the shiki path entirely — no
 * highlighting ever runs in the browser. No blanks in option text either.
 */
function OptionText({ text }: { text: string }) {
  return <Prose text={text.replace(/\s*\n+\s*/g, " ")} />;
}
