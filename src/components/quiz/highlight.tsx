import { codeToHtml } from "shiki";
import type { CodeLineItem } from "@/lib/quiz/markdown";

/**
 * Shiki rendering, server-only.
 *
 * Shiki bundles a TextMate grammar + theme for Python, which must never reach
 * the browser, so every highlight happens here in a server component.
 *
 * A line that contains a blank is painted in *runs*: each run is highlighted on
 * its own and the pieces are stitched back together with a plain text node in
 * between. That keeps the blank input exactly at its marker's column instead of
 * being pushed to the end of the line, while each run still gets its colours
 * (`print(` before a blank is still a function call).
 *
 * `HighlightedRun` is a plain object, so `prepareQuestionContent` can hand the
 * result of `highlightLines` straight to a client component as a prop.
 */

const SHIKI_OPTIONS = { lang: "python", theme: "github-light", structure: "inline" } as const;

/** Escapes a run exactly like shiki does for plain text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type HighlightedRun = { kind: "html"; html: string } | { kind: "blank"; name: string };

/** Highlights each text run of every line; a blank becomes its own placeholder run. */
export async function highlightLines(
  lines: readonly CodeLineItem[][],
): Promise<HighlightedRun[][]> {
  const runTexts = lines.flatMap((line) =>
    line.flatMap((item) => (typeof item === "string" ? [item] : [])),
  );
  const highlighted = await Promise.all(
    runTexts.map((text) =>
      // `structure: "inline"` wraps the tokens without a `<pre>`; shiki already escaped the text.
      text === "" ? Promise.resolve("") : codeToHtml(text, SHIKI_OPTIONS),
    ),
  );

  let next = 0;
  return lines.map((line) =>
    line.map((item): HighlightedRun =>
      typeof item === "string"
        ? { kind: "html", html: highlighted[next++] ?? escapeHtml(item) }
        : { kind: "blank", name: item.blank },
    ),
  );
}
