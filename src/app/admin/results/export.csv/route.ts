/**
 * `GET /admin/results/export.csv` — the class results as a file the giảng viên
 * opens in Excel.
 *
 * Same filter as `/admin/results` (`quizId`, `studentId`), no row cap. The
 * admin cookie is checked here too: middleware is a UX gate, not the security
 * boundary. The body starts with a UTF-8 BOM so Excel decodes Vietnamese.
 */
import type { NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/admin/session";
import { exportResultsCsv } from "@/lib/admin/results-csv-export";
import { csvFileName } from "@/lib/admin/results-csv";
import { getQuizForAdmin } from "@/lib/quiz/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOM = "\uFEFF";

export async function GET(request: NextRequest): Promise<Response> {
  if (!(await hasAdminSession())) {
    return new Response("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const params = request.nextUrl.searchParams;
  const quizId = params.get("quizId")?.trim() || undefined;
  const studentId = params.get("studentId")?.trim() || undefined;

  let body: string;
  let quizTitle: string | null = null;
  try {
    body = await exportResultsCsv({ quizId, studentId });
    if (quizId) quizTitle = (await getQuizForAdmin(quizId))?.title ?? null;
  } catch {
    return new Response("Không đọc được kết quả. Kiểm tra kết nối rồi thử lại.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(`${BOM}${body}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(quizTitle)}"`,
      "Cache-Control": "no-store",
    },
  });
}
