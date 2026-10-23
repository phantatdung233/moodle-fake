"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createQuizFromUpload, previewQuizUpload } from "@/lib/admin/upload";

export type UploadState = {
  error?: string;
  /** Slug whose preview the giảng viên is confirming; absent before preview. */
  confirmSlug?: string;
  questions?: number;
  byType?: { multichoice: number; multianswer: number };
  needsReview?: number;
  errors?: { questionId: string; reason: string }[];
};

function readFile(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File ? value : null;
}

/**
 * Step 1 — parse the chosen file and return the preview (counts, errors) for
 * the client to render. Nothing is written to the database here.
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

  return {
    confirmSlug: "",
    questions: preview.stats.total,
    byType: preview.stats.byType,
    needsReview: preview.stats.needsReview,
    errors: preview.errors,
  };
}

/**
 * Step 2 — the giảng viên confirmed the preview: re-parse the file server-side
 * and create a new draft Quiz. On success the browser lands on the quiz list.
 */
export async function confirmUpload(
  _prevState: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = readFile(formData);
  if (!file) {
    return { error: "Hãy chọn lại file JSON rồi thử lại." };
  }

  const result = await createQuizFromUpload({
    file,
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/admin");
  redirect(`/admin/quizzes/${result.quizId}`);
}
