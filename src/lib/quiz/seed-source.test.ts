import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MoodleJsonError,
  loadMoodleQuestions,
  summarizeQuestions,
} from "./seed-source";

const moodleFile = path.resolve(__dirname, "../../../moodle_quiz_merged.json");

describe("summarizeQuestions on the real Moodle export", () => {
  const questions = loadMoodleQuestions(moodleFile);

  it("reads 180 Questions from moodle_quiz_merged.json", () => {
    expect(questions).toHaveLength(180);
    expect(questions[0].id).toBe("Q001");
    expect(questions[179].id).toBe("Q180");
  });

  it("breaks the Questions down by type for the seed summary", () => {
    const summary = summarizeQuestions(questions);

    expect(summary.total).toBe(180);
    expect(summary.byType).toEqual({ multichoice: 161, multianswer: 19 });
  });
});

describe("loadMoodleQuestions validation", () => {
  it("rejects a top-level JSON value that is not an array", () => {
    expect(() => loadMoodleQuestionsText('{"questions": []}')).toThrow(MoodleJsonError);
  });

  it("rejects malformed JSON", () => {
    expect(() => loadMoodleQuestionsText("[{")).toThrow(MoodleJsonError);
  });

  it("rejects an entry without a Question id", () => {
    expect(() => loadMoodleQuestionsText('[{"type": "multichoice"}]')).toThrow(
      /id/,
    );
  });

  it("rejects a Question type outside multichoice / multianswer", () => {
    const shortanswer = [{ id: "Q001", no: 1, type: "shortanswer", question: "x" }];
    expect(() => loadMoodleQuestionsText(JSON.stringify(shortanswer))).toThrow(
      /shortanswer/,
    );
  });
});

function loadMoodleQuestionsText(text: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "moodle-seed-"));
  const file = path.join(dir, "moodle.json");
  writeFileSync(file, text);
  return loadMoodleQuestions(file);
}

// Guards the fixture path itself so a broken path fails loudly, not silently.
it("fixture path exists", () => {
  expect(readFileSync(moodleFile, "utf8").length).toBeGreaterThan(0);
});
