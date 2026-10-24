/**
 * `POST /api/admin/explain` — "Giải thích bằng AI" on the answer-review page
 * (Spec, user story 21, in its smallest useful form).
 *
 * Same soft-error contract as the sinh viên's `/api/explain`: a route handler
 * streaming `{text}` / `{error}` / `{done}` frames, never a 500 with a stack
 * trace. The Question is read from the Quiz the admin names (the session is
 * checked here too — middleware is only a UX gate), and the prompt carries no
 * student answer: the AI helps the giảng viên re-read the Question, it never
 * grades and never decides by itself that an answer looks wrong.
 */
import type { NextRequest } from "next/server";

import { explainQuestion, EXPLANATION } from "@/lib/gemini/explain";
import { encodeFrame, encodeFrames, readReviewExplanationRequest } from "@/lib/gemini/request";
import { hasAdminSession } from "@/lib/admin/session";
import { getQuestionForReview } from "@/lib/quiz/review-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_SESSION = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.";
const QUESTION_NOT_FOUND = "Không tìm thấy câu hỏi này trong đề.";

function softFailure(message: string, status = 200): Response {
  return new Response(encodeFrames([{ error: message }]), {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await hasAdminSession())) return softFailure(NO_SESSION, 401);

  const payload = (await request.json().catch(() => null)) as { quizId?: unknown } | null;
  const body = readReviewExplanationRequest(payload);
  if (!body.ok) return softFailure(body.error, 400);

  const quizId = typeof payload?.quizId === "string" ? payload.quizId : "";
  let question: Awaited<ReturnType<typeof getQuestionForReview>>;
  try {
    question = await getQuestionForReview(quizId, body.questionId);
  } catch {
    return softFailure("Không đọc được đề. Kiểm tra kết nối rồi thử lại.");
  }
  if (!question) return softFailure(QUESTION_NOT_FOUND, 404);

  let result: Awaited<ReturnType<typeof explainQuestion>>;
  try {
    result = await explainQuestion({ question });
  } catch {
    return softFailure(EXPLANATION.unavailable);
  }

  const encoder = new TextEncoder();
  const frames = result.stream[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await frames.next();
        if (!done && value) controller.enqueue(encoder.encode(encodeFrame(value)));
        if (done) {
          controller.enqueue(encoder.encode(encodeFrame({}, true)));
          controller.close();
        }
      } catch {
        controller.enqueue(encoder.encode(encodeFrame({ error: EXPLANATION.unavailable })));
        controller.enqueue(encoder.encode(encodeFrame({}, true)));
        controller.close();
      }
    },
    async cancel() {
      // The admin navigated away: stop pulling, so a half-finished text is
      // never cached.
      await frames.return?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(result.ok ? {} : { "X-Explain-Status": "soft-error" }),
    },
  });
}
