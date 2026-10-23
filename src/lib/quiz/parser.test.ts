import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuizJson } from "./parser";

const moodleFile = path.resolve(import.meta.dirname, "../../../moodle_quiz_merged.json");
/** The seam is fed the real Moodle export; fs lives in the test, never in the parser. */
function parseRealMoodleExport() {
  return parseQuizJson(JSON.parse(readFileSync(moodleFile, "utf8")));
}

describe("parseQuizJson on the real Moodle export", () => {
  it("accounts for every Question the giảng viên uploaded: 180 in, 180 out", () => {
    const { questions } = parseRealMoodleExport();

    expect(questions).toHaveLength(180);
    expect(questions[0].id).toBe("Q001");
    expect(questions[179].id).toBe("Q180");
    expect(new Set(questions.map((question) => question.id)).size).toBe(180);
  });

  it("keeps the Moodle Question number so the sinh viên sees the same thứ tự", () => {
    const { questions } = parseRealMoodleExport();

    expect(questions.every((question, index) => question.no === index + 1)).toBe(true);
  });

  it("classifies 161 multichoice Questions and 19 multianswer Questions", () => {
    const { stats } = parseRealMoodleExport();

    expect(stats.byType).toEqual({ multichoice: 161, multianswer: 19 });
  });

  it("flags at least 88 ungradeable Questions as needs_review for the giảng viên to review", () => {
    const { questions } = parseRealMoodleExport();
    const needsReview = questions.filter((question) => question.status === "needs_review");

    expect(needsReview.length).toBeGreaterThanOrEqual(88);
    // The 88 notyetanswered Questions Moodle exported have no correct option.
    expect(needsReview.filter((question) => question.type === "multichoice")).toHaveLength(88);
  });

  it("marks every multichoice Question without a correct option as needs_review", () => {
    const { questions } = parseRealMoodleExport();
    const withoutAnswer = questions.filter(
      (question) =>
        question.type === "multichoice" && !question.options.some((option) => option.correct),
    );

    expect(withoutAnswer.length).toBeGreaterThan(0);
    expect(withoutAnswer.every((question) => question.status === "needs_review")).toBe(true);
  });

  it("marks multianswer Questions with an empty blank as needs_review without inventing an answer", () => {
    const { questions } = parseRealMoodleExport();
    const withEmptyBlank = questions.filter((question) =>
      question.blanks.some((blank) => blank.acceptedAnswer === ""),
    );

    expect(withEmptyBlank.map((question) => question.id)).toEqual([
      "Q066",
      "Q070",
      "Q091",
      "Q097",
      "Q098",
      "Q103",
      "Q128",
      "Q130",
      "Q150",
      "Q176",
    ]);
    expect(withEmptyBlank.every((question) => question.status === "needs_review")).toBe(true);
    // Q150/Q176 keep the first blank Moodle did record.
    expect(withEmptyBlank.find((question) => question.id === "Q150")?.blanks[0].acceptedAnswer).toBe(
      "a",
    );
  });

  it("leaves gradeable multichoice Questions ready so sinh viên only sees answerable Questions", () => {
    const { questions } = parseRealMoodleExport();
    const q001 = questions.find((question) => question.id === "Q001");

    expect(q001?.type).toBe("multichoice");
    expect(q001?.status).toBe("ready");
    expect(q001?.options.filter((option) => option.correct).map((option) => option.key)).toEqual([
      "e",
    ]);
  });

  it("keeps moot-sounding answers Moodle recorded (Q144, Q153, Q156, Q165) and does not block them", () => {
    const { questions } = parseRealMoodleExport();

    for (const id of ["Q144", "Q153", "Q156", "Q165"]) {
      const question = questions.find((candidate) => candidate.id === id);
      expect(question, id).toBeDefined();
      if (question?.type !== "multichoice") continue;
      expect(question.status, id).toBe("ready");
      expect(question.options.some((option) => option.correct), id).toBe(true);
    }
  });

  it("reports the review workload in the stats the upload preview shows", () => {
    const { stats } = parseRealMoodleExport();

    // 88 multichoice without a correct option + 10 multianswer with an empty blank
    // + the 2 known-bad Q143/Q179.
    expect(stats.needsReview).toBe(100);
    expect(stats.total).toBe(180);
  });

  it("sends Q143 and Q179 back to needs_review because Moodle's recorded answers are garbage", () => {
    const { questions } = parseRealMoodleExport();

    const q143 = questions.find((question) => question.id === "Q143");
    const q179 = questions.find((question) => question.id === "Q179");

    expect(q143?.status).toBe("needs_review");
    expect(q179?.status).toBe("needs_review");
    // The parser never invents an answer: the giảng viên's review decides it.
    expect(q143?.blanks.map((blank) => blank.acceptedAnswer)).toEqual(['fruits[0]', '"kiwi"']);
    expect(q179?.blanks.map((blank) => blank.acceptedAnswer)).toEqual(["d"]);
  });

  it("keeps Q066 and Q070 content exactly as Moodle exported it, without auto-fixing them", () => {
    const { questions } = parseRealMoodleExport();
    const raw = JSON.parse(readFileSync(moodleFile, "utf8")) as { id: string; question: string }[];

    for (const id of ["Q066", "Q070"]) {
      const parsed = questions.find((question) => question.id === id);
      const original = raw.find((question) => question.id === id);
      expect(parsed?.content, id).toBe(original?.question);
      expect(parsed?.status, id).toBe("needs_review");
    }
    // The warning-only Questions still carry their placeholders.
    expect(questions.find((question) => question.id === "Q066")?.content).toContain("[[4]]");
    expect(questions.find((question) => question.id === "Q070")?.content).toContain("[[1]]");
  });

  it("keeps every [[n]] placeholder verbatim for the client to lay out the blanks", () => {
    const { questions } = parseRealMoodleExport();
    const raw = JSON.parse(readFileSync(moodleFile, "utf8")) as { id: string; question: string }[];

    expect(
      questions.filter((question) => /\[\[\d+\]\]/.test(question.content)).map((q) => q.id),
    ).toHaveLength(19);
    for (const question of questions) {
      const original = raw.find((candidate) => candidate.id === question.id);
      expect(question.content, question.id).toBe(original?.question);
    }
  });

  it("keeps the image URLs Moodle attached to Q020 and Q114", () => {
    const { questions } = parseRealMoodleExport();
    const withImages = questions.filter((question) => question.images.length > 0);

    expect(withImages.map((question) => question.id)).toEqual(["Q020", "Q114"]);
    expect(withImages[0].images[0]).toBe(
      "https://utexlms.hcmute.edu.vn/theme/image.php/maker/core/1777526534/s/no",
    );
  });

  it("lists each multichoice Question that Moodle exported without a correct option", () => {
    const { errors } = parseRealMoodleExport();

    expect(errors).toHaveLength(88);
    expect(errors.every((error) => error.questionId.startsWith("Q"))).toBe(true);
    expect(errors.map((error) => error.questionId)).toContain("Q046");
    expect(errors.find((error) => error.questionId === "Q046")?.reason).toMatch(
      /không có đáp án đúng|không có lựa chọn đúng/i,
    );
  });

  it("counts the Questions whose blanks Moodle left empty", () => {
    const { stats } = parseRealMoodleExport();

    expect(stats.emptyAnswers).toBe(10);
  });

  it("gives each Question a content+answer hash so an edited answer invalidates the Gemini explanation", () => {
    const { questions } = parseRealMoodleExport();

    expect(questions.every((question) => /^[0-9a-f]{64}$/.test(question.hash))).toBe(true);
    expect(new Set(questions.map((question) => question.hash)).size).toBe(180);
  });
});

/** One Question of each type, shaped exactly like the Moodle export. */
function fixtureQuestion(overrides: Record<string, unknown>) {
  return [
    {
      no: 1,
      id: "Q900",
      type: "multichoice",
      state: "answersaved",
      question: "Cú pháp nào sắp xếp mảng?",
      options: [
        { key: "a", text: "orderby()", selected: false },
        { key: "b", text: "sort()", selected: true },
      ],
      blanks: [],
      images: [],
      ...overrides,
    },
    {
      no: 2,
      id: "Q901",
      type: "multianswer",
      state: "answersaved",
      question: "Điền … để in số chẵn:\nfor i in range(2, 10, [[1]]):\n    print(i)",
      options: [],
      blanks: [
        { name: "Q901_blank1", value: "2" },
        { name: "Q901_blank2", value: "" },
      ],
      images: [],
      ...overrides,
    },
  ];
}

describe("parseQuizJson mapping a Moodle fixture", () => {
  it("maps option.selected onto option.correct and keeps the option key and text", () => {
    const [question] = parseQuizJson(fixtureQuestion({})).questions;

    expect(question.type).toBe("multichoice");
    expect(question.options).toEqual([
      { key: "a", text: "orderby()", correct: false },
      { key: "b", text: "sort()", correct: true },
    ]);
    expect(question.blanks).toEqual([]);
    expect(question.status).toBe("ready");
  });

  it("lets a multichoice Question have several correct options without sending it to review", () => {
    const { questions, stats, errors } = parseQuizJson([
      {
        ...fixtureQuestion({})[0],
        options: [
          { key: "a", text: "sort()", selected: true },
          { key: "b", text: "sorted()", selected: true },
          { key: "c", text: "orderby()", selected: false },
        ],
      },
    ]);

    expect(questions[0].options.filter((option) => option.correct)).toHaveLength(2);
    expect(questions[0].status).toBe("ready");
    expect(errors).toEqual([]);
    expect(stats.needsReview).toBe(0);
  });

  it("marks a multichoice Question with no selected option as needs_review and explains why", () => {
    const { questions, stats, errors } = parseQuizJson([
      {
        ...fixtureQuestion({})[0],
        options: [
          { key: "a", text: "orderby()", selected: false },
          { key: "b", text: "rank()", selected: false },
        ],
      },
    ]);

    expect(questions[0].status).toBe("needs_review");
    expect(stats.needsReview).toBe(1);
    expect(errors).toEqual([{ questionId: "Q900", reason: expect.stringMatching(/đáp án đúng/) }]);
  });

  it("maps blank.value onto blank.acceptedAnswer and keeps the blank name", () => {
    const question = parseQuizJson(fixtureQuestion({})).questions[1];

    expect(question.type).toBe("multianswer");
    expect(question.blanks).toEqual([
      { name: "Q901_blank1", acceptedAnswer: "2" },
      { name: "Q901_blank2", acceptedAnswer: "" },
    ]);
    expect(question.options).toEqual([]);
  });

  it("sends a multianswer Question with any empty blank to needs_review but is not a parse error", () => {
    const { questions, stats, errors } = parseQuizJson([fixtureQuestion({})[1]]);

    expect(questions[0].status).toBe("needs_review");
    expect(stats.emptyAnswers).toBe(1);
    // Moodle simply has not been answered here yet; only the giảng viên fills it in.
    expect(errors).toEqual([]);
  });

  it("keeps the [[n]] placeholders and the Moodle content verbatim", () => {
    const content = "In [[1]] và [[2]]:\n  a = [[3]]\n  print(a)";
    const root = fixtureQuestion({})[1];
    const question = parseQuizJson([{ ...root, question: content }]).questions[0];

    expect(question.content).toBe(content);
  });

  it("keeps the image URLs Moodle gave, in order", () => {
    const images = ["https://lms.example/a.png", "https://lms.example/b.png"];
    const question = parseQuizJson([{ ...fixtureQuestion({})[0], images }]).questions[0];

    expect(question.images).toEqual(images);
  });

  it("keeps the Question number and starts every Question enabled", () => {
    const { questions } = parseQuizJson(fixtureQuestion({}));

    expect(questions.map((question) => [question.id, question.no, question.enabled])).toEqual([
      ["Q900", 1, true],
      ["Q901", 2, true],
    ]);
  });

  it("changes the hash when the correct answer changes, so an old explanation is not reused", () => {
    const [original] = fixtureQuestion({});
    const [before] = parseQuizJson([original]).questions;
    const [after] = parseQuizJson([
      {
        ...original,
        options: [
          { key: "a", text: "orderby()", selected: true },
          { key: "b", text: "sort()", selected: false },
        ],
      },
    ]).questions;
    const [sameAgain] = parseQuizJson([original]).questions;

    expect(after.hash).not.toBe(before.hash);
    expect(sameAgain.hash).toBe(before.hash);
  });

  it("counts Questions by type in the stats", () => {
    const { stats } = parseQuizJson(fixtureQuestion({}));

    expect(stats).toEqual({
      total: 2,
      byType: { multichoice: 1, multianswer: 1 },
      needsReview: 1,
      emptyAnswers: 1,
    });
  });
});

describe("parseQuizJson on a damaged Moodle export", () => {
  it("rejects a top-level value that is not an array with a Vietnamese error", () => {
    expect(() => parseQuizJson({ questions: [] })).toThrow(TypeError);
    expect(() => parseQuizJson({ questions: [] })).toThrow(/mảng câu hỏi/);
  });

  it("reports one malformed Question as an error instead of throwing away the whole file", () => {
    const { questions, errors, stats } = parseQuizJson([
      fixtureQuestion({})[0],
      "không phải object",
      { id: "Q903", type: "shortanswer", question: "x" },
      null,
    ]);

    expect(questions.map((question) => question.id)).toEqual(["Q900"]);
    expect(stats.total).toBe(1);
    expect(errors).toHaveLength(3);
    expect(errors[1].questionId).toBe("Q903");
    expect(errors[1].reason).toMatch(/shortanswer/);
    expect(errors.map((error) => error.reason).join("\n")).toMatch(/Câu thứ 2/);
  });

  it("reports a multianswer Question with no blank as an error and needs_review", () => {
    const { questions, errors } = parseQuizJson([
      { ...fixtureQuestion({})[1], blanks: [] },
    ]);

    expect(questions[0].status).toBe("needs_review");
    expect(errors).toEqual([{ questionId: "Q901", reason: expect.stringMatching(/ô trống/) }]);
  });

  it("treats an empty Question list as a valid upload with nothing to review", () => {
    expect(parseQuizJson([])).toEqual({
      questions: [],
      stats: { total: 0, byType: { multichoice: 0, multianswer: 0 }, needsReview: 0, emptyAnswers: 0 },
      errors: [],
    });
  });
});
