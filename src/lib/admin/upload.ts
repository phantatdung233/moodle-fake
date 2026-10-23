/**
 * Upload → draft Quiz: the domain seam between the admin form and MongoDB.
 *
 * No `"use server"` here so tests can call these functions directly; the thin
 * server action in `actions.ts` imports them and only adds revalidation and
 * redirects. The parser stays untouched — this module owns file reading,
 * size/JSON guards and the hand-off to the Quiz data layer.
 */
import {
  parseQuizJson,
  type MoodleQuestionError,
  type QuizParseStats,
} from "@/lib/quiz/parser";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import {
  createDraftQuizFromQuestions,
  NO_QUESTIONS_ERROR,
  type CreateDraftQuizResult,
} from "@/lib/quiz/repository";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type QuizUploadFile = Pick<File, "size" | "text">;

export type QuizUploadPreview = {
  questions: QuizQuestion[];
  stats: QuizParseStats;
  /** Questions Moodle damaged: shown with their id and reason in Vietnamese. */
  errors: MoodleQuestionError[];
};

export type PreviewQuizUploadResult =
  | ({ ok: true } & QuizUploadPreview)
  | { ok: false; error: string };

/**
 * Reads and parses an uploaded Moodle export without touching the database, so
 * the giảng viên sees counts, parse errors and review load before anything is
 * saved.
 */
export async function previewQuizUpload(
  file: QuizUploadFile,
): Promise<PreviewQuizUploadResult> {
  if (file.size === 0) {
    return { ok: false, error: "Hãy chọn một file JSON để tải lên." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File quá lớn (giới hạn 5 MB)." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return {
      ok: false,
      error: "File không phải JSON hợp lệ. Hãy kiểm tra lại file xuất từ Moodle.",
    };
  }

  try {
    const { questions, stats, errors } = parseQuizJson(raw);
    // A well-formed array with nothing usable parses cleanly; reject it here so
    // the preview says so, and the data layer enforces the same rule.
    if (questions.length === 0) {
      return { ok: false, error: NO_QUESTIONS_ERROR };
    }
    return { ok: true, questions, stats, errors };
  } catch (error) {
    // The parser rejects a non-array top level with a Vietnamese TypeError.
    if (error instanceof TypeError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type CreateQuizFromUploadInput = {
  file: QuizUploadFile;
  title: string;
  slug: string;
};

/**
 * Parses the file again on the server (the preview the browser showed is not
 * trusted) and persists every parsed Question as a new draft Quiz.
 */
export async function createQuizFromUpload(
  input: CreateQuizFromUploadInput,
): Promise<CreateDraftQuizResult> {
  const preview = await previewQuizUpload(input.file);
  if (!preview.ok) {
    return { ok: false, error: preview.error };
  }

  return createDraftQuizFromQuestions({
    title: input.title,
    slug: input.slug,
    questions: preview.questions,
  });
}
