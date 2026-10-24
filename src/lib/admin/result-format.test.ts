/**
 * Shared presentation of an Attempt's status/score/date. The admin table, the
 * CSV export, the Attempt detail page and the student summary all read from
 * here, so the labels and number formats cannot drift apart again.
 */
import { describe, expect, it } from "vitest";
import {
  attemptStatusLabel,
  formatDate,
  formatPercent,
  formatScoreOutOfTen,
} from "./result-format";

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

  describe("formatScoreOutOfTen", () => {
    it("rounds to half points on a 10-point scale", () => {
      expect(formatScoreOutOfTen(10)).toBe("1/10");
      expect(formatScoreOutOfTen(15)).toBe("1,5/10");
      expect(formatScoreOutOfTen(24)).toBe("2,5/10");
      expect(formatScoreOutOfTen(100)).toBe("10/10");
    });
  });

  it("hiện gạch ngang cho lượt chưa có điểm", () => {
    expect(formatPercent(null)).toBe("—");
  });

  it("ghim dấu phẩy thập phân dù máy chạy locale nào", () => {
    // The Node ICU order (`vi-VN` vs `en-US` separators) must not leak into the UI.
    const original = Intl.NumberFormat;
    try {
      Intl.NumberFormat = function () {
        return { format: (value: number) => String(value) };
      } as unknown as typeof Intl.NumberFormat;
      expect(formatPercent(33.3333)).toBe("33,3%");
      expect(formatPercent(100)).toBe("100%");
    } finally {
      Intl.NumberFormat = original;
    }
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
