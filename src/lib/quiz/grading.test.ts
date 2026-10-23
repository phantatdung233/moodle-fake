import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuizJson } from "./parser";
import type { QuizOption, QuizQuestion } from "./quiz.model";
import { gradeAnswer, normalizeBlank } from "./grading";

const moodleFile = path.resolve(import.meta.dirname, "../../../moodle_quiz_merged.json");
const realQuestions = parseQuizJson(JSON.parse(readFileSync(moodleFile, "utf8"))).questions;

function realQuestion(id: string): QuizQuestion {
  const question = realQuestions.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`Không có Question ${id} trong đề Moodle`);
  return question;
}

describe("gradeAnswer on a multichoice Question", () => {
  it("scores 1 when the sinh viên picks exactly the correct option", () => {
    const grade = gradeAnswer(realQuestion("Q001"), { selectedOptionKeys: ["e"], blankValues: [] });

    expect(grade).toEqual({ correct: true, score: 1 });
  });

  it("scores 0 when the sinh viên picks exactly the correct two options of a two-answer Question", () => {
    const question = multichoice(["a", "c"]);

    const grade = gradeAnswer(question, { selectedOptionKeys: ["a", "c"], blankValues: [] });

    expect(grade.correct).toBe(true);
    expect(grade.score).toBe(1);
  });

  it("scores 0 when the sinh viên picks only one of the two correct options", () => {
    const question = multichoice(["a", "c"]);

    const grade = gradeAnswer(question, { selectedOptionKeys: ["a"], blankValues: [] });

    expect(grade.correct).toBe(false);
    expect(grade.score).toBe(0);
  });

  it("scores 0 when the sinh viên adds a wrong option to the correct one", () => {
    const grade = gradeAnswer(realQuestion("Q001"), {
      selectedOptionKeys: ["e", "b"],
      blankValues: [],
    });

    expect(grade.score).toBe(0);
  });

  it("scores 0 when the sinh viên picks nothing", () => {
    const grade = gradeAnswer(realQuestion("Q001"), { selectedOptionKeys: [], blankValues: [] });

    expect(grade).toEqual({ correct: false, score: 0 });
  });

  it("does not care about the order or the duplicates of the picked options", () => {
    const question = multichoice(["a", "c"]);

    const grade = gradeAnswer(question, { selectedOptionKeys: ["c", "a", "c"], blankValues: [] });

    expect(grade.score).toBe(1);
  });
});

describe("normalizeBlank on a blank the sinh viên typed", () => {
  it('treats " While:" and "while:" as the same code', () => {
    expect(normalizeBlank(" While:")).toBe("while:");
    expect(normalizeBlank(" While:")).toBe(normalizeBlank("while:"));
  });

  it("collapses repeated whitespace, so \"a  b\" is the same blank as \"a b\"", () => {
    expect(normalizeBlank("a  b")).toBe("a b");
    expect(normalizeBlank("a\t\tb")).toBe("a b");
  });

  it("ignores surrounding whitespace and letter case", () => {
    expect(normalizeBlank("  def my_Function()  ")).toBe("def my_function()");
  });

  it("does not strip Vietnamese diacritics: \"Đúng\" is not \"dung\"", () => {
    expect(normalizeBlank("Đúng")).not.toBe(normalizeBlank("dung"));
    expect(normalizeBlank("Đúng")).toBe("đúng");
  });
});

describe("gradeAnswer on a multianswer Question", () => {
  it("gives full marks when every blank matches its acceptedAnswer", () => {
    const grade = gradeAnswer(realQuestion("Q031"), {
      selectedOptionKeys: [],
      blankValues: [
        "(1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)",
        "(1, 9, 6, 3, 4, 5, 2, 7, 8)",
      ],
    });

    expect(grade.correct).toBe(true);
    expect(grade.score).toBe(1);
  });

  it("scores 0.67 when 2 of 3 blanks are right", () => {
    const question = multianswer(["else:", "and", "False"], ["else:", "and", "True"]);

    const grade = gradeAnswer(question, {
      selectedOptionKeys: [],
      blankValues: ["else:", "and", "True"],
    });

    expect(grade.score).toBe(0.67);
    expect(grade.correct).toBe(false);
  });

  it("scores 0 when none of the blanks are right", () => {
    const grade = gradeAnswer(realQuestion("Q006"), {
      selectedOptionKeys: [],
      blankValues: ["if:"],
    });

    expect(grade.correct).toBe(false);
    expect(grade.score).toBe(0);
  });

  it("reports every blank by name with right/wrong so the UI can mark the wrong ones", () => {
    const question = multianswer(["else:", "and", "False"], ["else:", "and", "True"]);

    const grade = gradeAnswer(question, {
      selectedOptionKeys: [],
      blankValues: [" else: ", "or", "True"],
    });

    expect(grade.perBlank).toEqual([
      { name: "Q901_blank1", correct: true },
      { name: "Q901_blank2", correct: false },
      { name: "Q901_blank3", correct: false },
    ]);
  });

  it("judges blanks with normalization, so case and extra spaces do not cost a point", () => {
    const question = multianswer(["While:", "a  b"], ["while:", "a b"]);

    const grade = gradeAnswer(question, {
      selectedOptionKeys: [],
      blankValues: ["  while:  ", "a b"],
    });

    expect(grade.score).toBe(1);
  });

  it("scores 0 when the sinh viên leaves every blank empty", () => {
    const grade = gradeAnswer(realQuestion("Q031"), { selectedOptionKeys: [], blankValues: [] });

    expect(grade.score).toBe(0);
    expect(grade.perBlank?.every((blank) => !blank.correct)).toBe(true);
  });
});

/** A multichoice Question the giảng viên marked with the given correct option keys. */
function multichoice(correctKeys: string[], allKeys = ["a", "b", "c"]): QuizQuestion {
  const options: QuizOption[] = allKeys.map((key) => ({
    key,
    text: `Lựa chọn ${key}`,
    correct: correctKeys.includes(key),
  }));
  return {
    id: "Q900",
    no: 1,
    type: "multichoice",
    content: "Cú pháp để sắp xếp các phần tử của mảng là?",
    options,
    blanks: [],
    images: [],
    enabled: true,
    status: "ready",
    hash: "",
  };
}

/** A multianswer Question with one blank per accepted answer, named Q901_blank1… */
function multianswer(acceptedAnswers: string[]): QuizQuestion {
  return {
    id: "Q901",
    no: 2,
    type: "multianswer",
    content: "Điền … vào chỗ trống",
    options: [],
    blanks: acceptedAnswers.map((acceptedAnswer, index) => ({
      name: `Q901_blank${index + 1}`,
      acceptedAnswer,
    })),
    images: [],
    enabled: true,
    status: "ready",
    hash: "",
  };
}
