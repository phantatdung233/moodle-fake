/**
 * `POST /api/explain` — stream giải thích AI cho một Question (Spec, "AI").
 *
 * Luồng: cookie sinh viên → Attempt → Question trong snapshot (hash do server
 * quyết định) → lưu kết quả hoặc stream. Response luôn là `text/event-stream` gồm các
 * frame `{text}` / `{error}` / `{done}`; lỗi thiếu key hay model hỏng vẫn là
 * frame lỗi mềm, chưa bao giờ là 500 kèm stack trace.
 */
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { readStudentSession, STUDENT_SESSION_COOKIE } from "@/lib/student/session";
import { explainQuestion, EXPLANATION } from "@/lib/gemini/explain";
import { hashMatches, questionForExplanation } from "@/lib/gemini/explanation-question";
import { saveAttemptExplanation } from "@/lib/quiz/attempt-repository";
import { encodeFrame, encodeFrames, readExplanationRequest, type ExplanationFrame } from "@/lib/gemini/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_IDENTITY = "Bạn cần nhập MSSV và họ tên trước khi xem giải thích.";
const QUESTION_NOT_FOUND = "Không tìm thấy câu hỏi trong bài.";
const STALE_QUESTION = "Câu hỏi đã thay đổi. Tải lại trang rồi thử lại.";

function frameResponse(frames: readonly ExplanationFrame[], status = 200): Response {
  return new Response(encodeFrames(frames), {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function softFailure(message: string, status = 200): Response {
  return frameResponse([{ error: message }], status);
}

export async function POST(request: NextRequest): Promise<Response> {
  // Identity first: without it the body cannot buy anything, and 401 is the
  // message the panel shows ("nhập MSSV và họ tên").
  const jar = await cookies();
  const identity = await readStudentSession(
    jar.get(STUDENT_SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET,
  );
  if (!identity) {
    return softFailure(NO_IDENTITY, 401);
  }

  const body = readExplanationRequest(await request.json().catch(() => null));
  if (!body.ok) return softFailure(body.error, 400);

  // The body names the Attempt on screen; `questionForExplanation` only returns
  // a Question whose Attempt belongs to the cookie's MSSV.
  let resolved: Awaited<ReturnType<typeof questionForExplanation>>;
  try {
    resolved = await questionForExplanation({
      attemptId: body.attemptId,
      studentId: identity.studentId,
      questionId: body.questionId,
    });
  } catch {
    return softFailure("Không đọc được bài làm. Kiểm tra kết nối rồi thử lại.");
  }
  if (!resolved) return softFailure(QUESTION_NOT_FOUND, 404);

  // The panel may render an older snapshot than the current Quiz; the answer is
  // still fine, but a differing hash means the page is stale, so ask for a reload
  // instead of silently explaining a Question the sinh viên is not looking at.
  if (!hashMatches(resolved.question, body.questionHash)) return softFailure(STALE_QUESTION, 409);

  let result: Awaited<ReturnType<typeof explainQuestion>>;
  try {
    result = await explainQuestion({
      question: resolved.question,
      studentAnswer: resolved.studentAnswer,
    });
  } catch {
    return softFailure(EXPLANATION.unavailable);
  }

  const encoder = new TextEncoder();
  const frames = result.stream[Symbol.asyncIterator]();
  const chunks: string[] = [];
  let failed = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await frames.next();
        if (!done && value) {
          if (value.text) chunks.push(value.text);
          if (value.error) failed = true;
          controller.enqueue(encoder.encode(encodeFrame(value)));
        }
        if (done) {
          if (result.ok && !failed && chunks.join("").trim() !== "") {
            const saved = await saveAttemptExplanation({
              attemptId: body.attemptId,
              studentId: identity.studentId,
              questionId: body.questionId,
              explanation: chunks.join(""),
            });
            if (!saved) {
              controller.enqueue(
                encoder.encode(encodeFrame({ error: "Không lưu được giải thích." })),
              );
            }
          }
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
      // The browser navigated away: stop pulling from the model. The finishing
      // frames never run, so a half-finished explanation is never persisted.
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
