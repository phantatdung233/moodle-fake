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
});
