import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getQuestionForReview,
  getQuizForReview,
  type AnswerReviewQuiz,
} from "@/lib/quiz/review-repository";
import { getCachedExplanation } from "@/lib/gemini/cache";
import { Button } from "@/components/ui/button";
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
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-destructive">
          Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và mongod.
        </p>
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

  // Cached Gemini text, read on the server so the admin sees it immediately and
  // only an explicit "Giải thích bằng AI" wakes the model.
  const cachedExplanation = shownQuestion ? await getCachedExplanation(shownQuestion.hash) : null;

  const readOnly = quiz.status !== "draft";
  const positionInQueue =
    shownQuestion && queue.includes(shownQuestion.id)
      ? queue.indexOf(shownQuestion.id) + 1
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <nav className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/admin" className="text-muted-foreground hover:underline">
          ← Danh sách đề
        </Link>
        <Link
          href={`/admin/quizzes/${quiz.id}`}
          className="text-muted-foreground hover:underline"
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
          <span className="rounded-full border px-3 py-1 text-xs">
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
        cachedExplanation={cachedExplanation}
        reviewPath={reviewPath}
        recheckPath={recheckPath}
        done={{
          quizId: quiz.id,
          reviewPath,
          readyCount: quiz.answeredCount,
          remaining: quiz.reviewQueue.length,
        }}
      />

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href={`/admin/quizzes/${quiz.id}`}>Về trang đề</Link>
        </Button>
      </div>
    </main>
  );
}
