import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getQuestionForReview,
  getQuizForReview,
  type AnswerReviewQuiz,
} from "@/lib/quiz/review-repository";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { prepareQuestionContent } from "@/components/quiz/question-blocks";
import { AdminDatabaseError, AdminHeader } from "@/app/admin/admin-header";
import { ReviewQuestion, type ReviewPageMode } from "./review-question";

export const metadata: Metadata = {
  title: "Duyệt đáp án",
};

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * "Duyệt đáp án" for one draft Quiz: one Question at a time, only the ones
 * that still `needs_review`, with the current Question in the query string so
 * refresh and the browser's back button land on the same Question.
 *
 * `?tab=ready` switches to editing answers of Questions that are already
 * `ready` (allowed while the Quiz is a draft). A published/archived Quiz is
 * read-only: the actions refuse writes server-side too.
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const mode: ReviewPageMode = first(query.tab) === "ready" ? "recheck" : "review";
  const requestedQuestionId = first(query.q);

  let quiz: AnswerReviewQuiz | null;
  try {
    quiz = await getQuizForReview(id);
  } catch {
    return (
      <main className={adminShell}>
        <AdminHeader active="quizzes" />
        <AdminDatabaseError />
      </main>
    );
  }

  if (!quiz) notFound();

  const reviewPath = `/admin/quizzes/${quiz.id}/review`;
  const recheckPath = `${reviewPath}?tab=ready`;

  // A `?q=` that is no longer in this tab's queue (just saved, removed, or a
  // stale bookmark) falls back to the first Question of the queue.
  const queue = mode === "review" ? quiz.reviewQueue : quiz.readyQuestionIds;
  const currentId =
    requestedQuestionId && queue.includes(requestedQuestionId)
      ? requestedQuestionId
      : (queue[0] ?? null);

  const question = currentId ? await getQuestionForReview(quiz.id, currentId) : null;
  // A Question removed between the two reads: show the queue's first instead.
  const shownQuestion =
    currentId !== null && question === null
      ? ((await getQuestionForReview(quiz.id, queue[0] ?? "")) ?? null)
      : question;

  // Every Question this page can show (both tabs), parsed and highlighted on
  // the server: the form below is a client component, which cannot await shiki.
  // Each Question is read once, even when it is also the one on screen.
  const byId = new Map<string, QuizQuestion | null>(
    shownQuestion ? [[shownQuestion.id, shownQuestion]] : [],
  );
  const bodies = await Promise.all(
    [...new Set([...quiz.reviewQueue, ...quiz.readyQuestionIds])].map(async (questionId) => {
      if (!byId.has(questionId)) byId.set(questionId, await getQuestionForReview(quiz.id, questionId));
      const candidate = byId.get(questionId);
      return [
        questionId,
        candidate ? await prepareQuestionContent(candidate.content, candidate.blanks.length) : [],
      ] as const;
    }),
  );
  const questionBodies = Object.fromEntries(bodies);

  const readOnly = quiz.status !== "draft";
  const positionInQueue =
    shownQuestion && queue.includes(shownQuestion.id)
      ? queue.indexOf(shownQuestion.id) + 1
      : null;

  return (
    <main className={adminShell}>
      <AdminHeader active="quizzes" />

      <nav aria-label="Đường dẫn" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Đề thi
        </Link>
        <Link
          href={`/admin/quizzes/${quiz.id}`}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Chi tiết đề
        </Link>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Duyệt đáp án</h1>
          <p className="text-sm break-all text-muted-foreground">
            {quiz.title} · /q/{quiz.slug}
          </p>
        </div>
        {positionInQueue ? (
          <span className="rounded-sm border px-3 py-1 text-xs">
            Câu {positionInQueue}/{queue.length} trong danh sách
          </span>
        ) : null}
      </header>

      <ReviewQuestion
        question={shownQuestion}
        mode={mode}
        readOnly={readOnly}
        totalCount={quiz.totalCount}
        answeredCount={quiz.answeredCount}
        readyQueue={quiz.readyQuestionIds}
        questionBodies={questionBodies}
        reviewPath={reviewPath}
        recheckPath={recheckPath}
        done={{
          quizId: quiz.id,
          reviewPath,
          readyCount: quiz.answeredCount,
          remaining: quiz.reviewQueue.length,
          quizStatus: quiz.status,
        }}
      />
    </main>
  );
}
