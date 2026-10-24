import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Layers,
  PlayCircle,
  RotateCcw,
  Timer,
  Trophy,
} from "lucide-react";
import {
  listTestableQuizzes,
  type TestableQuiz,
} from "@/lib/quiz/repository";
import type { AttemptSummary, AttemptView } from "@/lib/quiz/attempt-repository";
import { loadHomeSummaries, loadStudent } from "@/lib/student/actions";
import { summaryCounts } from "@/lib/student/exam";
import { formatPercent } from "@/lib/admin/result-format";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/theme-toggle";
import { StudentHeader } from "@/components/student-header";
import { HomeIdentityCard } from "./home-identity-card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Luyện tập Python",
};

export const dynamic = "force-dynamic";

/**
 * Home: the published Quizzes a sinh viên can open. Drafts and archived Quizzes
 * belong to the giảng viên and only appear under `/admin` (Spec, user story 24).
 *
 * The page is built around doing, not reading: a short masthead, one strip of
 * the student's own numbers, then the list — with the Quiz they were in the
 * middle of pulled to the top and "Làm tiếp" on it. Explanations here are one
 * line each; the details live on the Quiz page.
 */
export default async function HomePage() {
  let quizzes: TestableQuiz[];
  try {
    quizzes = await listTestableQuizzes();
  } catch {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <StudentHeader actions={<ThemeToggle />} />
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold">Chưa tải được danh sách đề</h1>
          <p className="text-sm text-muted-foreground">
            Không kết nối được máy chủ. Thử lại sau.
          </p>
        </div>
      </main>
    );
  }

  const student = await loadStudent();
  if (!student) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-16 pt-4 sm:px-6">
        <StudentHeader actions={<ThemeToggle />} />
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-xl">
            <section className="mb-6 text-center">
              <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
                Học Python bằng cách làm bài.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                Nhập thông tin để tiếp tục.
              </p>
            </section>
            <HomeIdentityCard />
          </div>
        </div>
      </main>
    );
  }

  const summaries = await loadHomeSummaries(quizzes.map((quiz) => quiz.id));

  const progress = quizzes.map((quiz) => ({
    quiz,
    summary: summaries[quiz.id] ?? null,
  }));
  const resume = progress.find((entry) => entry.summary?.inProgress);
  // The open Attempt gets its own card above, so the grid only lists the rest.
  const listed = resume
    ? progress.filter((entry) => entry !== resume)
    : progress;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <StudentHeader student={student} actions={<ThemeToggle />} />

      <section className="mt-8 flex flex-col gap-1.5 sm:mt-10">
        <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
          Làm tiếp thôi.
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Chọn đề và làm bài. Câu đã làm vẫn xem lại được.
        </p>
      </section>

      <StudentStats progress={summaries} />
      {resume?.summary?.inProgress ? (
        <ResumeCard quiz={resume.quiz} attempt={resume.summary.inProgress} />
      ) : null}

      <section aria-labelledby="quiz-list-heading" className="mt-8">
        {listed.length === 0 && quizzes.length > 0 ? null : (
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="quiz-list-heading" className="text-lg font-semibold">
              {resume ? "Các đề khác" : "Đề đang mở"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {listed.length} đề
            </span>
          </div>
        )}

        {quizzes.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
            <Layers className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">Chưa có đề nào</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Giảng viên chưa mở đề.
            </p>
          </div>
        ) : listed.length === 0 ? null : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {listed.map(({ quiz, summary }) => (
              <li key={quiz.id}>
                <QuizCard quiz={quiz} summary={summary} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** The student's own numbers in one strip: what they finished and their best score. */
function StudentStats({ progress }: { progress: Record<string, AttemptSummary> }) {
  const done = Object.values(progress).filter((summary) => summary.history.length > 0);
  const best = done.reduce(
    (top, summary) =>
      Math.max(top, summary.history[0]?.result?.total ?? 0),
    0,
  );
  const inProgress = Object.values(progress).filter(
    (summary) => summary.inProgress,
  ).length;

  return (
    <dl className="mt-6 grid grid-cols-3 divide-x rounded-xl border border-brand-border/60 bg-brand-surface">
      <Stat
        icon={<CheckCircle2 aria-hidden className="size-4" />}
        label="Đề đã làm"
        value={String(done.length)}
      />
      <Stat
        icon={<Trophy aria-hidden className="size-4" />}
        label="Điểm cao nhất"
        labelShort="Cao nhất"
        value={done.length > 0 ? formatPercent(best) : "—"}
      />
      <Stat
        icon={<PencilDot aria-hidden />}
        label="Đang làm dở"
        labelShort="Đang dở"
        value={String(inProgress)}
      />
    </dl>
  );
}

function Stat({
  icon,
  label,
  /** Narrow screens: three columns at 375px cannot fit the full label. */
  labelShort,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  labelShort?: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 py-3 sm:px-4">
      <dt className="flex items-center gap-1.5 text-xs text-brand-ink/80">
        {icon}
        <span className="truncate">
          {labelShort ? (
            <>
              <span className="sm:hidden">{labelShort}</span>
              <span className="sr-only">{label}</span>
              <span aria-hidden className="hidden sm:inline">
                {label}
              </span>
            </>
          ) : (
            label
          )}
        </span>
      </dt>
      <dd className="text-xl font-semibold tabular-nums text-brand-ink">
        {value}
      </dd>
    </div>
  );
}

/** A dot and two lines: the "in progress" glyph, at the same scale as the other icons. */
function PencilDot({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props} className={cn("size-4", props.className)}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3.75V8l2.75 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The one card that can be the biggest thing on the page: the open Attempt. */
function ResumeCard({ quiz, attempt }: { quiz: TestableQuiz; attempt: AttemptView }) {
  const { answered, total } = attemptProgress(attempt);
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);

  return (
    <Link
      href={`/q/${quiz.slug}`}
      className="group mt-6 flex flex-col gap-4 rounded-2xl border-2 border-brand bg-card p-5 transition-colors hover:bg-brand-surface/50 sm:flex-row sm:items-center sm:gap-6"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
        <PlayCircle aria-hidden className="size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-xs font-medium text-brand-ink">
          Đang làm dở · {answered}/{total} câu
        </span>
        <span className="truncate text-lg font-semibold">{quiz.title}</span>
        <Progress
          value={percent}
          aria-label={`Đã làm ${answered}/${total} câu`}
          data-tone="brand"
          className="h-1.5"
        />
      </span>
      <span className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background">
        Làm tiếp
        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function QuizCard({
  quiz,
  summary,
}: {
  quiz: TestableQuiz;
  summary: AttemptSummary | null;
}) {
  const progress = summary?.inProgress ? attemptProgress(summary.inProgress) : null;
  const latest = summary?.history[0];
  const latestScore = latest ? summaryCounts(latest).scorePercent : null;
  const blocked = summary?.attemptsExhausted === true;

  return (
    <div className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            quiz.mode === "practice"
              ? "bg-brand-surface text-brand-ink"
              : "bg-brand-cool-surface text-brand-cool-foreground",
          )}
        >
          {quiz.mode === "practice" ? (
            <PlayCircle aria-hidden className="size-4.5" />
          ) : (
            <Timer aria-hidden className="size-4.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link
              href={`/q/${quiz.slug}`}
              className="rounded-sm group-hover:underline group-hover:underline-offset-4"
            >
              {quiz.title !== "" ? quiz.title : "(chưa đặt tên)"}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{quiz.mode === "practice" ? "Luyện tập" : "Kiểm tra"}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{quiz.questionCount} câu</span>
            {quiz.mode === "exam" && quiz.timeLimit !== undefined ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{quiz.timeLimit} phút</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {progress ? (
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Đã làm {progress.answered}/{progress.total}
            </span>
            <Link
              href={`/q/${quiz.slug}`}
              className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground"
            >
              Làm tiếp <ArrowRight aria-hidden className="size-3" />
            </Link>
          </div>
          <Progress
            value={
              progress.total === 0
                ? 0
                : Math.round((progress.answered / progress.total) * 100)
            }
            aria-label={`Đã làm ${progress.answered}/${progress.total} câu`}
            data-tone="brand"
            className="h-1"
          />
        </div>
      ) : latest ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 aria-hidden className="size-3.5" />
            <span className="font-medium tabular-nums">
              {formatPercent(latestScore)}
            </span>
          </span>
          <span className="text-muted-foreground">
            lần gần nhất{summary && summary.history.length > 1 ? ` · ${summary.history.length} lần` : ""}
          </span>
          {/* "Làm lại" opens a new paper; a used-up exam can only be reviewed. */}
          {blocked ? (
            <Link
              href={`/q/${quiz.slug}/ket-qua`}
              className="ml-auto inline-flex items-center gap-1 rounded-sm text-muted-foreground"
            >
              <RotateCcw aria-hidden className="size-3" />
              Xem lại
            </Link>
          ) : (
            <Link
              href={`/q/${quiz.slug}/lam-moi`}
              className="ml-auto inline-flex items-center gap-1 rounded-sm font-medium text-foreground"
            >
              <RotateCcw aria-hidden className="size-3" />
              Làm lại
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs">
          <span className="text-muted-foreground">
            {quiz.mode === "practice"
              ? "Chấm ngay từng câu"
              : "Chấm sau khi nộp"}
          </span>
          <Link
            href={`/q/${quiz.slug}`}
            className="inline-flex items-center gap-1 rounded-sm font-medium"
          >
            Vào làm <ArrowRight aria-hidden className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

/** How far into an open Attempt the student is, from the saved answers only. */
function attemptProgress(attempt: AttemptView): { answered: number; total: number } {
  const total = attempt.questionsSnapshot.filter((question) => question.enabled).length;
  const byId = new Map(
    attempt.answers.map((answer) => [answer.questionId, answer] as const),
  );
  const answered = attempt.questionsSnapshot.filter((question) => {
    if (!question.enabled) return false;
    const answer = byId.get(question.id);
    if (!answer) return false;
    return (
      answer.selectedOptionKeys.length > 0 ||
      answer.blankValues.some((value) => value.trim() !== "")
    );
  }).length;
  return { answered, total };
}
