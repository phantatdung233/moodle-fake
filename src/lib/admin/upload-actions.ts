"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { previewQuizUpload } from "@/lib/admin/upload";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin/session";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import type { MoodleQuestionError, QuizParseStats } from "@/lib/quiz/parser";

export type UploadState = {
  error?: string;
  /** Counts + parse errors from a preview; kept visible after a failed confirm. */
  preview?: {
    questions: number;
    byType: QuizParseStats["byType"];
    needsReview: number;
    errors: MoodleQuestionError[];
  };
};

function readFile(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File ? value : null;
}

const NO_SESSION_ERROR =
  "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.";

/**
 * Middleware already blocks `/admin/**`, but a server action is reachable by
 * anyone who can POST to it, so the action that writes checks the session too.
 */
async function hasAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

function toPreviewState(stats: QuizParseStats, errors: MoodleQuestionError[]): UploadState {
  return {
    preview: {
      questions: stats.total,
      byType: stats.byType,
      needsReview: stats.needsReview,
      errors,
    },
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

  return toPreviewState(preview.stats, preview.errors);
}

/**
 * Step 2 — the giảng viên confirmed the preview: re-parse the file server-side
 * (the browser's preview is not trusted) and create a new draft Quiz. On success
 * the browser lands on the new Quiz's admin page.
 */
export async function confirmUpload(
  _prevState: UploadState,
  formData: FormData,
): Promise<UploadState> {
  if (!(await hasAdminSession())) {
    return { error: NO_SESSION_ERROR };
  }

  const file = readFile(formData);
  if (!file) {
    return { error: "Hãy chọn lại file JSON rồi thử lại." };
  }

  const preview = await previewQuizUpload(file);
  if (!preview.ok) {
    return { error: preview.error };
  }

  const result = await createDraftQuizFromQuestions({
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    questions: preview.questions,
  });

  if (!result.ok) {
    // Keep the preview on screen so only the title/slug needs fixing.
    return { ...toPreviewState(preview.stats, preview.errors), error: result.error };
  }

  revalidatePath("/admin");
  redirect(`/admin/quizzes/${result.quizId}`);
}
