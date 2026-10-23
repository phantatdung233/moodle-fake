"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { previewQuizUpload, uploadFileFromPayload } from "@/lib/admin/upload";
import type { UploadFilePayload } from "@/lib/admin/upload-file";
import { hasAdminSession } from "@/lib/admin/session";
import { NO_SESSION_ERROR } from "@/lib/admin/review-messages";
import { GENERIC_ACTION_ERROR } from "@/lib/admin/with-admin";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import type { MoodleQuestionError, QuizParseStats } from "@/lib/quiz/parser";

/** Counts + parse errors shown before anything is saved. */
export type QuizUploadPreview = {
  questions: number;
  byType: QuizParseStats["byType"];
  needsReview: number;
  errors: MoodleQuestionError[];
};

export type UploadState = {
  error?: string;
  /** Kept visible after a failed confirm so only the title/slug needs fixing. */
  preview?: QuizUploadPreview;
};

/**
 * What `confirmUpload` hands back to the client. The redirect an action
 * performs is only followed inside a transition, so the client must dispatch
 * it from one; it returns this `null` state on success instead of relying on
 * the caller to catch.
 */
export type ConfirmUploadResult = UploadState | null;

export type ConfirmUploadInput = {
  title: string;
  slug: string;
};

function readFile(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File ? value : null;
}

function toPreview(
  stats: QuizParseStats,
  errors: MoodleQuestionError[],
): QuizUploadPreview {
  return {
    questions: stats.total,
    byType: stats.byType,
    needsReview: stats.needsReview,
    errors,
  };
}

/**
 * Step 1 — parse the chosen file and return the preview (counts, parse errors)
 * for the browser to render. Nothing is written to the database here.
 */
export async function previewUpload(
  _prevState: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = readFile(formData);
  if (!file) {
    return { error: "Hãy chọn một file JSON để tải lên." };
  }

  const preview = await previewQuizUpload(file);
  if (!preview.ok) {
    return { error: preview.error };
  }

  return { preview: toPreview(preview.stats, preview.errors) };
}

/**
 * Step 2 — the giảng viên confirmed the preview: re-parse the file server-side
 * (the browser's preview is not trusted) and create a new draft Quiz. On success
 * the browser lands on the new Quiz's admin page.
 *
 * Called from the client inside `startTransition` rather than as a form action:
 * a hydrated Next runtime carries only one useActionState action per form, and
 * step 1 already owns it. Wrap it before calling — see `ConfirmUploadResult`.
 *
 * Written out by hand instead of through `withAdmin`: a `"use server"` module
 * may only export async functions, and `export const confirmUpload = withAdmin(…)`
 * is a plain call at module scope. `withAdmin` rethrows Next's control flow, so
 * the redirect still leaves the handler.
 */
export async function confirmUpload(
  payload: UploadFilePayload,
  input: ConfirmUploadInput,
): Promise<ConfirmUploadResult> {
  // No session (rare: middleware already gates the page): keep the preview step
  // on screen with the same message every admin action uses.
  if (!(await hasAdminSession())) return { error: NO_SESSION_ERROR };

  try {
    const preview = await previewQuizUpload(uploadFileFromPayload(payload));
    if (!preview.ok) {
      return { error: preview.error };
    }

    const result = await createDraftQuizFromQuestions({
      title: input.title,
      slug: input.slug,
      questions: preview.questions,
    });

    if (!result.ok) {
      // Keep the preview on screen so only the title/slug needs fixing.
      return { preview: toPreview(preview.stats, preview.errors), error: result.error };
    }

    revalidatePath("/admin");
    redirect(`/admin/quizzes/${result.quizId}`);
  } catch (error) {
    // Same contract as withAdmin: Next's redirect/notFound pass through, every
    // other failure becomes one Vietnamese message, never a stack trace.
    unstable_rethrow(error);
    return { error: GENERIC_ACTION_ERROR };
  }
}
