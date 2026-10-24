import type { QuestionContentBlock } from "@/lib/quiz/markdown";
import { parseQuestionContent } from "@/lib/quiz/markdown";
import { splitPlaceholders } from "@/lib/quiz/content";
import { highlightLines, type HighlightedRun } from "@/components/quiz/highlight";

/**
 * Question body, prepared on the server for the client renderer.
 *
 * A Question is shown to two kinds of consumer: server pages (the summary,
 * which renders markup directly) and client components (the student runner and
 * the answer review form, which own the blank inputs' state). A client
 * component may not be async, so highlighting must not happen while it renders:
 * these helpers turn `content` into plain, serializable blocks with the shiki
 * HTML already applied. `QuestionContent` then renders those blocks
 * synchronously and calls back for each `[[n]]` blank.
 *
 * Server-only by construction: shiki must never reach the browser bundle.
 */

/** One rendered block: prose as markdown source, a program already highlighted. */
export type RenderedQuestionContent =
  | { kind: "markdown"; text: string }
  | { kind: "code"; language: "python"; lines: HighlightedRun[][] };

/** Parses `content` into its prose/code blocks; `blankCount` decides which `[[n]]` are blanks. */
export function questionBlocksOf(
  content: string,
  blankCount: number,
): QuestionContentBlock[] {
  return parseQuestionContent(splitPlaceholders(content, blankCount));
}

/** Highlights the code blocks of already-parsed content, ready to cross the server → client boundary. */
export async function renderQuestionBlocks(
  blocks: readonly QuestionContentBlock[],
): Promise<RenderedQuestionContent[]> {
  return Promise.all(
    blocks.map(async (block): Promise<RenderedQuestionContent> =>
      block.kind === "markdown"
        ? { kind: "markdown", text: block.text }
        : { kind: "code", language: block.language, lines: await highlightLines(block.lines) },
    ),
  );
}

/** Raw Moodle `content` → server-rendered blocks, the one call a page needs. */
export async function prepareQuestionContent(
  content: string,
  blankCount: number,
): Promise<RenderedQuestionContent[]> {
  return renderQuestionBlocks(questionBlocksOf(content, blankCount));
}
