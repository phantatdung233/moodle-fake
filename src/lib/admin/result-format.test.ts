/**
 * Shared presentation of an Attempt's status/score/date. The admin table, the
 * CSV export, the Attempt detail page and the student summary all read from
 * here, so the labels and number formats cannot drift apart again.
 */
import { describe, expect, it } from "vitest";
import { attemptStatusLabel, formatDate, formatPercent } from "./result-format";

describe("attemptStatusLabel", () => {
  it("gọi mọi trạng thái của Attempt bằng cùng một cụm từ ở mọi trang", () => {
    expect(attemptStatusLabel("in_progress")).toBe("Đang làm");
    expect(attemptStatusLabel("submitted")).toBe("Đã nộp");
    expect(attemptStatusLabel("expired", "badge")).toBe("Hết giờ — nộp tự động");
    expect(attemptStatusLabel("expired", "short")).toBe("Hết giờ");
    // The CSV column is narrow; it still uses the short form, never a new wording.
    expect(attemptStatusLabel("expired", "csv")).toBe("Hết giờ");
  });
});

describe("formatPercent", () => {
  it("dùng dấu phẩy thập phân kiểu Việt Nam và bỏ số 0 thừa", () => {
    expect(formatPercent(33.3333)).toBe("33,3%");
    expect(formatPercent(20)).toBe("20%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("hiện gạch ngang cho lượt chưa có điểm", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("hiện giờ Việt Nam, dd/MM/yyyy HH:mm", () => {
    // 2026-10-23T03:05:00Z = 10:05 sáng giờ Việt Nam.
    expect(formatDate(new Date("2026-10-23T03:05:00Z"))).toBe("23/10/2026 10:05");
  });

  it("hiện gạch ngang khi chưa có thời điểm", () => {
    expect(formatDate(null)).toBe("—");
  });
});
