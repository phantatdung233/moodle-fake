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
