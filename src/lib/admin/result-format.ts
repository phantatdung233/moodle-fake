/**
 * Shared presentation of one Attempt: its status label and the score/date
 * formats. The results table, the CSV export, the Attempt detail page and the
 * student's summary all read from here — before, each kept its own copy and
 * the labels drifted ("Hết giờ" vs "Hết giờ — nộp tự động").
 *
 * Pure: no React, no DB, client-safe.
 */
import type { AttemptStatus } from "@/lib/quiz/attempt.model";

/**
 * How much room the caller has. `short` fits the CSV column and inline prose
 * ("Hết giờ"), `badge` spells out that the server submitted the paper.
 */
export type StatusLabelVariant = "badge" | "short" | "csv";

const LABELS: Record<AttemptStatus, { badge: string; short: string }> = {
  in_progress: { badge: "Đang làm", short: "Đang làm" },
  submitted: { badge: "Đã nộp", short: "Đã nộp" },
  expired: { badge: "Hết giờ — nộp tự động", short: "Hết giờ" },
};

/** Vietnamese label for an Attempt status. `csv` keeps the short form. */
export function attemptStatusLabel(
  status: AttemptStatus,
  variant: StatusLabelVariant = "badge",
): string {
  const label = LABELS[status] ?? LABELS.in_progress;
  return variant === "badge" ? label.badge : label.short;
}

/** `33,3%` (Vietnamese decimal comma), `—` while the Attempt has no score yet. */
export function formatPercent(total: number | null): string {
  if (total === null) return "—";
  return `${Number(total.toFixed(1)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

/** Formats the student's result on a 10-point scale in half-point steps. */
export function formatScoreOutOfTen(total: number | null): string {
  if (total === null) return "—";
  const score = Math.round((total / 10) * 2) / 2;
  return `${score.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}/10`;
}

/** `23/10/2026 10:05` in Vietnam time; `—` for a missing date. */
export function formatDate(date: Date | null): string {
  if (!date) return "—";
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
