"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { previewQuizUpload } from "@/lib/admin/upload";
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
