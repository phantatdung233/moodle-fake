"use server";

/**
 * Server actions behind `/admin/results`. As with every other admin action the
 * session is checked here via `withAdminAction` (middleware is a UX gate, not a
 * security boundary), and the data layer does the deleting.
 */
import { revalidatePath } from "next/cache";
import { resetStudentAttempts } from "@/lib/admin/results-repository";
import { withAdminAction } from "@/lib/admin/with-admin";

export type ResetStudentResult = { ok: true; deletedCount: number } | { ok: false; error: string };

/**
 * "Reset lượt của em này": removes one MSSV's Attempts for one Quiz only, so
 * the sinh viên can làm lại from lượt 1. Other students' rows and the same
 * student's Attempts on other Quizzes are left alone (user story 70).
 */
export const resetStudentAttemptsAction = withAdminAction(async function resetStudentAttemptsAction(input: {
  quizId: string;
  studentId: string;
}): Promise<ResetStudentResult> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Dữ liệu không hợp lệ." };
  }

  const result = await resetStudentAttempts({
    quizId: String(input.quizId ?? ""),
    studentId: String(input.studentId ?? ""),
  });
  if (result.ok) {
    revalidatePath("/admin/results");
    revalidatePath("/admin");
    revalidatePath("/q", "layout");
  }
  return result;
});
