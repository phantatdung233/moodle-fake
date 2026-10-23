import { describe, expect, it } from "vitest";
import { formatCountdown, remainingMs, summaryCounts, isExpired } from "./exam";
import type { AttemptQuestionResult } from "@/lib/quiz/attempt.model";
import type { AttemptView } from "@/lib/quiz/attempt-repository";

const STARTED = new Date("2026-10-23T01:00:00.000Z");
const DEADLINE = new Date("2026-10-23T01:45:00.000Z");

describe("formatCountdown", () => {
  it("hiển thị mm:ss khi còn dưới một giờ", () => {
    expect(formatCountdown(45 * 60_000)).toBe("45:00");
    expect(formatCountdown(61_000)).toBe("01:01");
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("hiển thị h:mm:ss khi còn từ một giờ trở lên", () => {
    expect(formatCountdown(90 * 60_000)).toBe("1:30:00");
    expect(formatCountdown(120 * 60_000 + 5_000)).toBe("2:00:05");
  });

  it("không bao giờ âm", () => {
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("remainingMs", () => {
  it("tính từ deadline của lượt làm", () => {
    expect(remainingMs(DEADLINE, new Date("2026-10-23T01:30:00.000Z"))).toBe(15 * 60_000);
  });

  it("không có deadline thì không giới hạn", () => {
    expect(remainingMs(undefined, new Date())).toBeNull();
  });
});

describe("isExpired", () => {
  it("quá deadline là hết giờ", () => {
    expect(isExpired(DEADLINE, new Date("2026-10-23T01:45:00.000Z"))).toBe(true);
    expect(isExpired(DEADLINE, new Date("2026-10-23T01:44:59.999Z"))).toBe(false);
    expect(isExpired(undefined, new Date())).toBe(false);
  });
});

function attemptWith(perQuestion: AttemptQuestionResult[], answers: AttemptView["answers"]): AttemptView {
  return {
    id: "a1",
    studentId: "B1",
    studentName: "An",
    quizId: "q1",
    quizSlug: "python-co-ban",
    quizVersion: 2,
    mode: "exam",
    status: "submitted",
    startedAt: STARTED,
    questionsSnapshot: [],
    answers,
    result: { total: 40, perQuestion },
  };
}

describe("summaryCounts", () => {
  it("đếm đúng / sai / bỏ trống trên kết quả đã lưu", () => {
    const perQuestion: AttemptQuestionResult[] = [
      { questionId: "Q1", score: 1, correct: true },
      { questionId: "Q2", score: 0, correct: false },
      { questionId: "Q3", score: 0.5, correct: false },
      { questionId: "Q4", score: 0, correct: false },
    ];
    const attempt = attemptWith(perQuestion, [
      { questionId: "Q1", selectedOptionKeys: ["a"], blankValues: [], revealed: true },
      { questionId: "Q2", selectedOptionKeys: ["b"], blankValues: [], revealed: true },
      { questionId: "Q3", selectedOptionKeys: [], blankValues: ["x", ""], revealed: true },
    ]);

    expect(summaryCounts(attempt)).toEqual({
      total: 4,
      correct: 1,
      incorrect: 2,
      blank: 1,
      scorePercent: 40,
    });
  });

  it("câu chỉ trả lời một phần vẫn tính là sai, không phải bỏ trống", () => {
    const attempt = attemptWith(
      [{ questionId: "Q1", score: 0.33, correct: false }],
      [{ questionId: "Q1", selectedOptionKeys: [], blankValues: ["a", "b", ""], revealed: true }],
    );

    expect(summaryCounts(attempt)).toMatchObject({ incorrect: 1, blank: 0 });
  });

  it("lượt làm chưa có kết quả thì đếm 0 và coi mọi câu là bỏ trống", () => {
    const attempt = { ...attemptWith([], []), result: undefined };

    expect(summaryCounts(attempt)).toMatchObject({ total: 0, correct: 0, incorrect: 0, blank: 0 });
  });
});
