/**
 * Question content → renderable blocks.
 *
 * Moodle exported the Questions as plain text: prose, then Python that is
 * sometimes indented and sometimes flush left, with no code fences anywhere
 * (spec, "Further Notes"). Rendering that as markdown alone would collapse the
 * indentation and format random `*`/`_` as emphasis, so `parseQuestionContent`
 * first decides which lines are code and groups them into python blocks; only
 * the prose goes through markdown.
 *
 * Pure: no React, no markdown compiler, so the heuristic is unit-testable.
 */
import type { ContentSegment } from "./content";

/** One line of a code block: literal text pieces and the blanks inside them. */
export type CodeLineItem = string | { blank: string };

export type QuestionContentBlock =
  | { kind: "markdown"; text: string }
  | { kind: "code"; language: "python"; lines: CodeLineItem[][] };

const MAX_SHORT_LINE = 48;

/** Starts of real Python statements. The lookahead keeps Vietnamese "Không …" out. */
const KEYWORD =
  /^(?:print|def|for|while|if|elif|else|return|import|from|try|except|finally|class|with|lambda|del|raise|assert|global|pass|break|continue|yield)(?![A-Za-z0-9_])(?:[ (\t[:;.]|$)/;

/**
 * A line the author already numbered `(1)`, `[2]` — a code listing even when
 * every line is flush left (Q112, Q152, Q155). `1)` is left out on purpose: a
 * plain numbered list is prose (Q101).
 */
const LISTING_START = /^(?:\(\d+\)|\[\d+\])\s/;

/**
 * An expression that is the whole line, e.g. `f(3, 3)`, `S3 in S1`,
 * `3 >= 4 and not(5 < 7)`. ASCII only, so a Vietnamese sentence never looks
 * like code. Any call-shaped line qualifies; anything else must be operands
 * joined by an operator or comparison.
 */
const OPERAND = String.raw`(?:-?[\d.]+|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\([^()]*\))?|\([^()]*\))`;
const OPERATOR = [
  String.raw`\+\+`, String.raw`\*\*`, "//", "and", "or", "not",
  "==", "!=", "<>", ">=", "<=", ">", "<", "in",
  String.raw`\+`, "-", String.raw`\*`, "/", "%",
].join("|");
const EXPRESSION = new RegExp(
  String.raw`^(?:[A-Za-z_][\w.]*\(.*\)|${OPERAND}(?:\s*(?:${OPERATOR})\s*${OPERAND})+)$`,
);

/**
 * `x = …`, `a, b = …`, `*rest, head = …`, `x += …`. Spaces may precede `=`
 * (the export writes `i = 1`), but prose like "None == False" stays prose.
 */
const ASSIGN =
  /^[*~]?[A-Za-z_]\w*(?:\s*,\s*[*~]?[A-Za-z_]\w*)*\s*(?:(?:\+|-|\*|\/\/|\/|%|\*\*)=|=)(?!=)/;

function indented(line: string): boolean {
  return /^(?: {2,}|\t)\S/.test(line);
}

/** A short bare expression: `f(3, 3)`, `S3 in S1`, `a + b` — code, not a sentence. */
function shortExpression(line: string): boolean {
  const text = line.trim();
  return text.length <= MAX_SHORT_LINE && EXPRESSION.test(text);
}

/**
 * A line that may open a code block. A numbered listing (`1) …`) only opens
 * one when the author's numbering is `(1)`/`[1]` — a bare `1)` list is prose.
 */
function opensCode(line: string): boolean {
  const text = line.trim();
  if (text === "") return false;
  if (text.startsWith("[[") && text.endsWith("]]")) return true;
  if (text.startsWith("#")) return true;
  if (LISTING_START.test(text)) return true;
  if (ASSIGN.test(text)) return true;
  if (shortExpression(text)) return true;
  return KEYWORD.test(text);
}

/**
 * Turns the segments from `splitPlaceholders` into renderable blocks. Blank
 * markers inside code become `{ blank: n }` items on their own code line, so
 * the input sits at the marker's exact column; markers in prose stay as
 * `[[n]]` text for the markdown renderer to substitute.
 */
export function parseQuestionContent(segments: readonly ContentSegment[]): QuestionContentBlock[] {
  // Lay the segments out as raw lines; each blank keeps the absolute column of
  // its marker inside that line, so the input renders at the marker's position.
  const lines: { text: string; blanks: { column: number; name: string }[] }[] = [
    { text: "", blanks: [] },
  ];

  for (const segment of segments) {
    const line = lines[lines.length - 1];
    if (segment.kind === "blank") {
      line.blanks.push({ column: line.text.length, name: segment.name });
      continue;
    }
    const parts = segment.value.split("\n");
    line.text += parts[0];
    for (const part of parts.slice(1)) {
      lines.push({ text: part, blanks: [] });
    }
  }

  // Classify every line first: a blank can never live in prose, and a line that
  // merely "opens" code (e.g. another statement) only starts a block when
  // nothing is open yet.
  type Classified = { line: { text: string; blanks: { column: number; name: string }[] }; kind: "code" | "prose" | "blank" };
  const classified: Classified[] = lines.map((line) => ({
    line,
    kind: line.blanks.length > 0 || opensCode(line.text) ? "code" : line.text.trim() === "" ? "blank" : "prose",
  }));

  const blocks: QuestionContentBlock[] = [];
  let markdown: string[] = [];
  let code: CodeLineItem[][] | null = null;

  const flushMarkdown = () => {
    const text = markdown.join("\n").trim();
    if (text !== "") blocks.push({ kind: "markdown", text });
    markdown = [];
  };
  const flushCode = () => {
    if (!code) return;
    while (code.length > 0 && isBlankCodeLine(code[code.length - 1])) code.pop();
    if (code.length > 0) blocks.push({ kind: "code", language: "python", lines: code });
    code = null;
  };

  for (let index = 0; index < classified.length; index += 1) {
    const { line, kind } = classified[index];
    if (kind === "code") {
      if (!code) {
        flushMarkdown();
        code = [];
      }
      code.push(toCodeLine(line));
      continue;
    }
    if (kind === "blank") {
      // Blank lines between code stanzas (Q031, Q026) stay inside the block
      // when the next real line continues it; otherwise they end it.
      if (code) {
        const next = classified.slice(index + 1).find((entry) => entry.kind !== "blank");
        if (next && (next.kind === "code" || indented(next.line.text))) {
          code.push(toCodeLine(line));
          continue;
        }
      }
      flushCode();
      markdown.push(line.text);
      continue;
    }
    // Prose: a deeper indent or a comment under a program still belongs to it.
    if (code && (indented(line.text) || line.text.trim().startsWith("#"))) {
      code.push(toCodeLine(line));
      continue;
    }
    flushCode();
    markdown.push(line.text);
  }
  flushCode();
  flushMarkdown();

  return blocks;
}

function isBlankCodeLine(items: CodeLineItem[]): boolean {
  return items.every((item) => typeof item === "string" && item.trim() === "");
}

function toCodeLine(line: { text: string; blanks: { column: number; name: string }[] }): CodeLineItem[] {
  if (line.blanks.length === 0) return [line.text];

  const items: CodeLineItem[] = [];
  let cursor = 0;
  for (const blank of line.blanks) {
    if (blank.column > cursor) items.push(line.text.slice(cursor, blank.column));
    items.push({ blank: blank.name });
    cursor = blank.column;
  }
  if (cursor < line.text.length) items.push(line.text.slice(cursor));
  return items;
}

/**
 * Markdown source for a block: prose as-is, code fenced as python. Blank
 * markers inside code stay `[[n]]` so the markdown renderer can place an input
 * there without the fence swallowing it. Prose is left byte-for-byte alone;
 * `screenProse` guards the markers when it is handed to markdown.
 */
export function toMarkdown(blocks: readonly QuestionContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "markdown") return block.text;
      const body = block.lines
        .map((line) => line.map((item) => (typeof item === "string" ? item : `[[${item.blank}]]`)).join(""))
        .join("\n");
      return ["```" + block.language, body, "```"].join("\n");
    })
    .join("\n\n");
}

/**
 * Prose for the markdown renderer, with `[[n]]` escaped (`\[\[n\]\]`): GFM would
 * otherwise parse the marker as a wiki-style link and the input would land
 * inside an `<a>`. `readMarkers` is the inverse, applied to text nodes.
 */
export function screenProse(text: string): string {
  return text.replace(/\[\[(\d+)\]\]/g, "\\[\\[$1\\]\\]");
}

/** Undoes `screenProse` for one rendered text node. */
export function readMarkers(text: string): string {
  return text.replace(/\\\[\\\[(\d+)\\\]\\\]|\[\[(\d+)\]\]/g, (_, escaped: string, plain: string) => `[[${escaped ?? plain}]]`);
}
