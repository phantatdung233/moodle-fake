import { describe, expect, it } from "vitest";
import { isValidQuizSlug, slugifyTitle } from "./slug";

describe("slugifyTitle", () => {
  it.each([
    ["Python cơ bản", "python-co-ban"],
    ["Đề kiểm tra giữa kỳ", "de-kiem-tra-giua-ky"],
    ["  Ôn tập: List & Dict!  ", "on-tap-list-dict"],
    ["Q001 - Biến  và  kiểu", "q001-bien-va-kieu"],
  ])("%j → %j", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });
});

describe("isValidQuizSlug", () => {
  it.each(["python-co-ban", "de2", "a"])("chấp nhận %j", (slug) => {
    expect(isValidQuizSlug(slug)).toBe(true);
  });

  it.each(["", "Python-co-ban", "-a", "a-", "a--b", "a_b", "a b", "đề"])(
    "từ chối %j",
    (slug) => {
      expect(isValidQuizSlug(slug)).toBe(false);
    },
  );
});
