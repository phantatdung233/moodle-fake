import { describe, expect, it } from "vitest";
import { highlightLines, type HighlightedRun } from "./highlight";
import { parseQuestionContent, type CodeLineItem } from "@/lib/quiz/markdown";
import { splitPlaceholders } from "@/lib/quiz/content";
import { parseQuizJson } from "@/lib/quiz/parser";
import moodleExport from "../../../moodle_quiz_merged.json";

/**
 * Highlighting runs in the server component (shiki); these tests pin the two
 * things the blank inputs rely on: a blank keeps its own run exactly where its
 * marker was, and every blank of every real Question survives highlighting.
 */

const questions = parseQuizJson(moodleExport).questions;

function codeLinesFor(questionId: string): CodeLineItem[][] {
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`missing ${questionId}`);
  return parseQuestionContent(splitPlaceholders(question.content, question.blanks.length)).flatMap(
    (block) => (block.kind === "code" ? block.lines : []),
  );
}

/** The line as text, with each blank still written as `[[n]]`, so columns can be compared. */
function lineText(runs: readonly HighlightedRun[]): string {
  return runs.map((run) => (run.kind === "blank" ? `[[${run.name}]]` : stripTags(run.html))).join("");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x3C;/g, "<")
    .replace(/&#x3E;/g, ">")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("highlightLines", () => {
  it("keeps Q006's else blank on its own line, indented program still highlighted", async () => {
    const runs = await highlightLines(codeLinesFor("Q006"));

    expect(runs.map(lineText)).toEqual([
      "i = 1",
      "while i < 6:",
      "    print(i)",
      "    i += 1",
      "[[1]]",
      '    print("i is no longer less than 6")',
    ]);
    // A blank-only line is a lone blank run, not an HTML span to be swallowed.
    expect(runs[4]).toEqual([{ kind: "blank", name: "1" }]);
    // Colours survive on the line after it, indentation included in the first token.
    expect(runs[5][0]).toMatchObject({ kind: "html" });
    const after = runs[5][0].kind === "html" ? runs[5][0].html : "";
    expect(after).toContain("color:#");
    expect(stripTags(after)).toMatch(/^ {4}print/);
  });

  it("keeps Q103's three blanks per line in order, between highlighted runs", async () => {
    const runs = await highlightLines(codeLinesFor("Q103"));

    // The question line is prose; the program starts at `a = 50; b = 10`.
    const firstBlanks = runs[1];
    expect(firstBlanks.map((run) => (run.kind === "blank" ? run.name : "html"))).toEqual([
      "1",
      "html",
      "2",
      "html",
      "3",
    ]);
    expect(lineText(firstBlanks)).toBe("[[1]] a [[2]] b [[3]]");
  });

  it("keeps every blank of every Question in the export, in document order", async () => {
    const mismatched: string[] = [];

    for (const question of questions) {
      const runs = await highlightLines(codeLinesFor(question.id));
      const names = runs.flat().flatMap((run) => (run.kind === "blank" ? [run.name] : []));
      const expected = question.blanks.map((_, index) => String(index + 1));
      if (names.join(",") !== expected.join(",")) mismatched.push(question.id);
    }

    expect(mismatched).toEqual([]);
  });
});
