import { describe, expect, it } from "vitest";
import type { AttemptView } from "@/lib/quiz/attempt-repository";
import {
  blankIndexByName,
  blankNumber,
  blankTone,
  draftFromAttempt,
  isRevealed,
  markRevealed,
  questionStatus,
  toggleOptionKey,
  withAnswer,
  type Draft,
} from "./answers";

function attemptWith(answers: AttemptView["answers"]): AttemptView {
  return {
    id: "a1",
    studentId: "B2012345",
    studentName: "An",
    quizId: "q1",
    quizSlug: "python-co-ban",
    quizVersion: 1,
    mode: "practice",
    status: "in_progress",
    startedAt: new Date(),
    questionsSnapshot: [],
    answers,
  };
}

const saved: Draft = { selectedOptionKeys: ["b"], blankValues: ["x", ""] };

describe("toggleOptionKey", () => {
  it("adds an option the sinh viên just picked", () => {
    expect(toggleOptionKey([], "a")).toEqual(["a"]);
  });

  it("removes an option they unpick", () => {
    expect(toggleOptionKey(["a", "c"], "a")).toEqual(["c"]);
  });

  it("keeps the order the options were picked, so answers are stable", () => {
    expect(toggleOptionKey(["c"], "a")).toEqual(["c", "a"]);
  });
});

describe("draftFromAttempt", () => {
  it("seeds the inputs with the saved answer", () => {
    const attempt = attemptWith([{ questionId: "Q031", ...saved, revealed: false }]);
    const draft = draftFromAttempt("Q031", attempt);

    expect(draft).toEqual(saved);
    // A copy, so typing never mutates the Attempt object the panel reads.
    expect(draft).not.toBe(attempt.answers[0]);
  });

  it("starts empty for a Question never answered", () => {
    expect(draftFromAttempt("Q002", attemptWith([]))).toEqual({
      selectedOptionKeys: [],
      blankValues: [],
    });
  });
});

describe("questionStatus", () => {
  it("counts a picked option or a typed blank as answered", () => {
    const attempt = attemptWith([
      { questionId: "A", selectedOptionKeys: ["b"], blankValues: [], revealed: false },
      { questionId: "B", selectedOptionKeys: [], blankValues: ["x"], revealed: false },
    ]);

    expect(questionStatus("A", attempt)).toBe("answered");
    expect(questionStatus("B", attempt)).toBe("answered");
  });

  it("treats whitespace-only blanks and a missing answer as unanswered", () => {
    const attempt = attemptWith([
      { questionId: "A", selectedOptionKeys: [], blankValues: ["  ", ""], revealed: false },
    ]);

    expect(questionStatus("A", attempt)).toBe("unanswered");
    expect(questionStatus("B", attempt)).toBe("unanswered");
  });

  it("reports a revealed Question as locked, even when it is empty", () => {
    const attempt = attemptWith([
      { questionId: "A", selectedOptionKeys: [], blankValues: [], revealed: true },
    ]);

    expect(questionStatus("A", attempt)).toBe("revealed");
  });
});

describe("isRevealed / markRevealed", () => {
  it("locks the Question and keeps the draft the reveal was graded from", () => {
    const before = attemptWith([{ questionId: "Q031", ...saved, revealed: false }]);
    const after = markRevealed(before, "Q031", saved);

    expect(isRevealed(before, "Q031")).toBe(false);
    expect(isRevealed(after, "Q031")).toBe(true);
    expect(after.answers[0]).toMatchObject(saved);
  });

  it("adds a record for a Question revealed without an answer", () => {
    const after = markRevealed(attemptWith([]), "Q002", { selectedOptionKeys: [], blankValues: [] });

    expect(after.answers).toEqual([
      { questionId: "Q002", selectedOptionKeys: [], blankValues: [], revealed: true },
    ]);
  });
});

describe("withAnswer", () => {
  it("replaces the Question's record without duplicating it", () => {
    const attempt = withAnswer(attemptWith([{ questionId: "Q031", ...saved, revealed: false }]), "Q031", {
      selectedOptionKeys: ["c"],
      blankValues: ["y", "z"],
    });

    expect(attempt.answers).toEqual([
      { questionId: "Q031", selectedOptionKeys: ["c"], blankValues: ["y", "z"], revealed: false },
    ]);
  });

  it("keeps the grading of a revealed Question", () => {
    const graded = { correct: true, score: 1 };
    const attempt = withAnswer(
      attemptWith([{ questionId: "Q031", ...saved, revealed: true, graded }]),
      "Q031",
      saved,
    );

    expect(attempt.answers[0]).toMatchObject({ revealed: true, graded });
  });
});

describe("blank markers", () => {
  it("maps a blank's trailing number to the marker in the content", () => {
    expect(blankNumber("Q031_blank2", 0)).toBe("2");
    expect(blankNumber("Q006_blank1", 4)).toBe("1");
  });

  it("falls back to the 1-based position when the name has no number", () => {
    expect(blankNumber("blank", 2)).toBe("3");
  });

  it("points each marker at its index in blankValues", () => {
    const index = blankIndexByName([
      { name: "Q103_blank1" },
      { name: "Q103_blank2" },
      { name: "Q103_blank3" },
    ]);

    expect(index.get("1")).toBe(0);
    expect(index.get("3")).toBe(2);
    expect(index.get("4")).toBeUndefined();
  });
});

describe("blankTone", () => {
  it("marks right and wrong blanks from the grade", () => {
    expect(blankTone({ name: "1", value: "a", acceptedAnswer: "a", correct: true })).toBe("correct");
    expect(blankTone({ name: "1", value: "b", acceptedAnswer: "a", correct: false })).toBe("wrong");
    expect(blankTone(undefined)).toBeUndefined();
  });
});
