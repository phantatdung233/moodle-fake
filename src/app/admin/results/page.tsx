import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, Search } from "lucide-react";
import { listResults, type ResultRow } from "@/lib/admin/results-repository";
import {
  attemptStatusLabel,
  formatDate,
  formatPercent,
} from "@/lib/admin/result-format";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AdminDatabaseError, AdminHeader } from "@/app/admin/admin-header";
import { ResetAttemptsButton } from "./reset-attempts-button";

export const metadata: Metadata = {
  title: "Kết quả sinh viên",
};

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    quizId?: string | string[];
    studentId?: string | string[];
    cursor?: string | string[];
  }>;
};

/** One string from a query parameter, tolerating `?x=a&x=b`. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * `/admin/results` — every Attempt of every Quiz, newest first, with the
 * filters the giảng viên asked for: by Quiz and by MSSV. The same filter runs
 * the CSV export, so the file always matches the table (user stories 67–69).
 *
 * The table shows RESULTS_PAGE_SIZE rows per page with "Trang sau"; the CSV
 * export always holds every row the filter matches.
 */
export default async function ResultsPage({ searchParams }: Props) {
  const params = await searchParams;
  const quizId = one(params.quizId);
  const studentId = one(params.studentId).trim();
  const cursor = one(params.cursor);

  let page: Awaited<ReturnType<typeof listResults>>;
  try {
    page = await listResults({
      quizId: quizId || undefined,
      studentId: studentId || undefined,
      cursor: cursor || undefined,
    });
  } catch {
    return (
      <main className={adminShell}>
        <AdminHeader active="results" />
        <AdminDatabaseError />
      </main>
    );
  }

  // Same query string for both the export button and "Xoá lọc".
  const exportQuery = new URLSearchParams();
  if (page.query.quizId) exportQuery.set("quizId", page.query.quizId);
  if (page.query.studentId) exportQuery.set("studentId", page.query.studentId);
  const exportHref = `/admin/results/export.csv${
    exportQuery.size > 0 ? `?${exportQuery.toString()}` : ""
  }`;
  const filtered = page.query.quizId !== "" || page.query.studentId !== "";

  // The same filters, plus where the page should continue from.
  const pageHref = (nextCursor: string) => {
    const query = new URLSearchParams(exportQuery);
    if (nextCursor) query.set("cursor", nextCursor);
    return `/admin/results${query.size > 0 ? `?${query.toString()}` : ""}`;
  };
  // "Trang trước" restarts from the newest row: the cursor only looks forward.
  const firstPageHref = pageHref("");

  const quizzes = page.quizzes;
  const selectedQuizTitle = quizzes.find(
    (quiz) => quiz.id === page.query.quizId,
  )?.title;

  return (
    <main className={adminShell}>
      <AdminHeader active="results" />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Kết quả sinh viên</h1>
        </div>
        <Button asChild variant="outline">
          <a href={exportHref}>
            <Download /> Xuất CSV
          </a>
        </Button>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Lọc kết quả</CardTitle>
          <CardDescription>
            Lọc theo đề hoặc MSSV.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex flex-col gap-1 sm:min-w-56">
              <label
                htmlFor="filter-quiz"
                className="text-xs text-muted-foreground"
              >
                Đề
              </label>
              <select
                id="filter-quiz"
                name="quizId"
                defaultValue={page.query.quizId}
                className="h-8 rounded-md border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Tất cả đề</option>
                {quizzes.map((quiz) => (
                  <option key={quiz.id} value={quiz.id}>
                    {quiz.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:w-56">
              <label
                htmlFor="filter-student"
                className="text-xs text-muted-foreground"
              >
                MSSV
              </label>
              <Input
                id="filter-student"
                name="studentId"
                defaultValue={page.query.studentId}
                placeholder="vd B2012345"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">
                <Search /> Lọc
              </Button>
              {filtered ? (
                <Button asChild variant="outline">
                  <Link href="/admin/results">Xoá lọc</Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <a href={exportHref}>
                  <Download /> Xuất CSV
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <section
        aria-labelledby="results-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="text-lg font-semibold">
            {page.totalRows} lượt làm
            {selectedQuizTitle ? ` · ${selectedQuizTitle}` : ""}
            {page.query.studentId
              ? ` · MSSV chứa “${page.query.studentId}”`
              : ""}
          </h2>
          {page.truncated ? (
            <p className="text-sm text-muted-foreground">
              Hiện {page.rows.length}/{page.totalRows} lượt. CSV có đủ dữ liệu.
            </p>
          ) : null}
        </div>

        {page.rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Chưa có lượt làm nào</CardTitle>
              <CardDescription>
                {filtered
                  ? "Không lượt làm nào khớp bộ lọc. Thử xoá lọc."
                  : "Chưa có lượt làm. Publish đề để bắt đầu."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <ResultsTable rows={page.rows} />
            {cursor !== "" || page.hasNext ? (
              <nav
                aria-label="Phân trang kết quả"
                className="flex items-center justify-between gap-3"
              >
                {cursor !== "" ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={firstPageHref}>
                      <ArrowLeft /> Trang đầu
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground">
                  {page.rows.length} lượt mỗi trang
                </span>
                {page.nextCursor ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={pageHref(page.nextCursor)}>
                      Trang sau <ArrowRight />
                    </Link>
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Hết danh sách
                  </span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

/**
 * One row per Attempt. Mobile shows the same data as stacked cards; from `md`
 * up it is a real table with sticky header so 200 rows stay scannable.
 */
function ResultsTable({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border bg-card">
      <table className="w-full min-w-[52rem] text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left">
          <tr>
            <Th>MSSV</Th>
            <Th>Họ tên</Th>
            <Th>Đề</Th>
            <Th className="text-center">Lượt</Th>
            <Th className="text-right">Điểm</Th>
            <Th>Bắt đầu</Th>
            <Th>Nộp bài</Th>
            <Th>Trạng thái</Th>
            <Th className="text-right">Thao tác</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.attemptId} className="align-top even:bg-muted/20">
              <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">
                {row.studentId}
              </td>
              <td className="px-3 py-2">{row.studentName}</td>
              <td className="px-3 py-2">
                <span
                  className="block max-w-80 truncate"
                  title={`/q/${row.quizSlug}`}
                >
                  {row.quizTitle}
                </span>
              </td>
              <td className="px-3 py-2 text-center">{row.attemptNumber}</td>
              <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {row.scorePercent === null ? (
                  <span
                    className="font-normal text-muted-foreground"
                    title="Chưa nộp bài nên chưa có điểm"
                  >
                    chưa nộp
                  </span>
                ) : (
                  formatPercent(row.scorePercent)
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(row.startedAt)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {row.submittedAt ? formatDate(row.submittedAt) : "—"}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap justify-end gap-1">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/results/${row.attemptId}`}>
                      Chi tiết
                    </Link>
                  </Button>
                  <ResetAttemptsButton
                    quizId={row.quizId}
                    quizTitle={row.quizTitle}
                    studentId={row.studentId}
                    studentName={row.studentName}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-2 font-medium whitespace-nowrap", className)}
    >
      {children}
    </th>
  );
}

function StatusBadge({ status }: { status: ResultRow["status"] }) {
  return (
    <Badge
      variant={
        status === "submitted"
          ? "secondary"
          : status === "expired"
            ? "destructive"
            : "outline"
      }
    >
      {attemptStatusLabel(status)}
    </Badge>
  );
}
