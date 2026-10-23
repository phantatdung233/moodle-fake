/**
 * CSV for `/admin/results/export.csv`.
 *
 * A pure module: it turns the table's rows into one RFC 4180 document. Excel
 * needs two things to open Vietnamese correctly and keep 0123456 as text — a
 * UTF-8 BOM (added by the route) and correct quoting — so the format lives
 * here, away from the HTTP layer, and is tested on its own.
 */
import type { ResultRow } from "./results-repository";

export const CSV_HEADERS = [
  "MSSV",
  "Họ tên",
  "Đề",
  "Lượt",
  "Điểm (%)",
  "Trạng thái",
  "Bắt đầu",
  "Nộp bài",
] as const;

const STATUS_LABELS: Record<ResultRow["status"], string> = {
  in_progress: "Đang làm",
  submitted: "Đã nộp",
  expired: "Hết giờ",
};

/** `dd/MM/yyyy HH:mm` in Vietnam time — what a giảng viên reads in Excel. */
export function formatCsvDate(date: Date | null): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("day")}/${read("month")}/${read("year")} ${read("hour")}:${read("minute")}`;
}

/** Percent with one decimal, using a comma so Vietnamese Excel reads a number. */
export function formatCsvPercent(total: number | null): string {
  if (total === null) return "";
  return total.toLocaleString("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * One CSV field. Quoted only when needed (comma, quote, newline — or a leading
 * space/tab, which Excel would otherwise trim); inner quotes doubled.
 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function csvLine(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

export function toCsv(rows: readonly ResultRow[]): string {
  const lines = [csvLine(CSV_HEADERS)];
  for (const row of rows) {
    lines.push(
      csvLine([
        row.studentId,
        row.studentName,
        row.quizTitle,
        String(row.attemptNumber),
        formatCsvPercent(row.scorePercent),
        STATUS_LABELS[row.status],
        formatCsvDate(row.startedAt),
        formatCsvDate(row.submittedAt),
      ]),
    );
  }
  // CRLF: RFC 4180, and what Excel expects on Windows.
  return `${lines.join("\r\n")}\r\n`;
}

/** `ket-qua-python-co-ban-2026-10-23.csv`, safe for a `Content-Disposition` header. */
export function csvFileName(quizTitle: string | null, now: Date = new Date()): string {
  const slug = (quizTitle ?? "tat-ca-de")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const date = now.toISOString().slice(0, 10);
  return `ket-qua-${slug || "tat-ca-de"}-${date}.csv`;
}
