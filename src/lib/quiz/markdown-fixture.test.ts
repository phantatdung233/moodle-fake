import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitPlaceholders } from "./content";
import { parseQuestionContent, toMarkdown, type QuestionContentBlock } from "./markdown";
import { parseQuizJson } from "./parser";

/**
 * The real export is the only honest fixture for the code-block heuristic:
 * 94 of its 180 Questions are multi-line and none of them carry code fences.
 */
const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

function questions() {
  return parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;
}

function blocksFor(questionId: string): QuestionContentBlock[] {
  const question = questions().find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`missing ${questionId}`);
  return parseQuestionContent(splitPlaceholders(question.content, question.blanks.length));
}

function codeText(blocks: readonly QuestionContentBlock[]): string {
  return blocks
    .filter((block) => block.kind === "code")
    .flatMap((block) => (block.kind === "code" ? block.lines : []))
    .map((line) => line.map((item) => (typeof item === "string" ? item : `[[${item.blank}]]`)).join(""))
    .join("\n");
}

describe("rendering moodle_quiz_merged.json", () => {
  it("fences Q006's program with its indentation intact and the blank on its own line", () => {
    expect(toMarkdown(blocksFor("Q006"))).toBe(
      [
        "Điền … để in thông báo khi điều kiện sai:",
        "",
        "```python",
        "i = 1",
        "while i < 6:",
        "    print(i)",
        "    i += 1",
        "[[1]]",
        '    print("i is no longer less than 6")',
        "```",
      ].join("\n"),
    );
  });

  it("keeps every blank of the known multianswer Questions inside the code", () => {
    const multianswer = questions().filter((question) => question.type === "multianswer");

    for (const question of multianswer) {
      const code = codeText(blocksFor(question.id));
      for (const blank of question.blanks) {
        const marker = `[[${blank.name.replace(/^.*_blank/, "")}]]`;
        expect(code, `${question.id} ${marker}`).toContain(marker);
      }
    }
  });

  it("does not split a Question's prose around a single program (Q031, Q103)", () => {
    for (const id of ["Q031", "Q103", "Q066", "Q176"]) {
      const blocks = blocksFor(id);
      expect(blocks.filter((block) => block.kind === "code"), id).toHaveLength(1);
      expect(blocks[0].kind, id).toBe("markdown");
    }
  });

  it("keeps every Question's opening question line as prose", () => {
    // Q123 reads like an expression ("None == False có kết quả là?") but is a
    // Vietnamese question; no Question may open with a code block.
    for (const question of questions()) {
      expect(blocksFor(question.id)[0]?.kind, question.id).toBe("markdown");
    }
  });

  it("renders a numbered prose list as prose (Q101), not code", () => {
    expect(blocksFor("Q101").every((block) => block.kind === "markdown")).toBe(true);
  });

  it("renders a Vietnamese question that happens to contain `==` as prose (Q123)", () => {
    expect(blocksFor("Q123")).toEqual([
      { kind: "markdown", text: "None == False có kết quả là?" },
    ]);
  });
});
