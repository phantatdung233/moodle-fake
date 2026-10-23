import { describe, expect, it } from "vitest";
import { describeFeedback } from "./feedback";

describe("describeFeedback", () => {
  it("summarises a correct multichoice answer", () => {
    expect(describeFeedback({ correct: true, score: 1, correctOptionKeys: ["e"] })).toEqual({
      headline: "Chính xác!",
      tone: "correct",
      accepted: ["e"],
    });
  });

  it("names the correct option of a wrong multichoice answer", () => {
    expect(describeFeedback({ correct: false, score: 0, correctOptionKeys: ["e"] })).toEqual({
      headline: "Chưa đúng.",
      tone: "wrong",
      accepted: ["e"],
    });
  });

  it("lists the wrong blanks of a multianswer with what was typed", () => {
    const summary = describeFeedback({
      correct: false,
      score: 0.67,
      perBlank: [
        { name: "Q030_blank1", acceptedAnswer: "while:", value: "while:", correct: true },
        { name: "Q030_blank2", acceptedAnswer: "break", value: "Break ", correct: false },
        { name: "Q030_blank3", acceptedAnswer: "else:", value: "", correct: false },
      ],
    });

    expect(summary).toEqual({
      headline: "Đúng 1/3 ô.",
      tone: "wrong",
      accepted: [],
      wrongBlanks: [
        { name: "Q030_blank2", typed: "Break ", expected: "break" },
        { name: "Q030_blank3", typed: "", expected: "else:" },
      ],
    });
  });

  it("reports an all-correct multianswer", () => {
    expect(
      describeFeedback({
        correct: true,
        score: 1,
        perBlank: [{ name: "Q006_blank1", acceptedAnswer: "else:", value: "else:", correct: true }],
      }),
    ).toMatchObject({ headline: "Chính xác! 1/1 ô đúng.", tone: "correct", wrongBlanks: [] });
  });
});
