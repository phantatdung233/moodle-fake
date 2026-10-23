import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { CodeLineItem, QuestionContentBlock } from "@/lib/quiz/markdown";
import { parseQuestionContent, readMarkers, screenProse } from "@/lib/quiz/markdown";
import { splitPlaceholders } from "@/lib/quiz/content";
import { highlightLines } from "@/components/quiz/highlight";

/**
 * Question content renderer.
 *
 * Server components on purpose: shiki bundles a TextMate grammar + theme for
 * Python, which must never reach the browser. It is the one renderer of a
 * Question body everywhere (student runner, summary, admin review): the pure
 * `parseQuestionContent` decides what is prose and what is a program, and the
 * interactivity layer supplies a blank input at each `[[n]]` position.
 */

/** A blank input, supplied by the interactivity layer. */
export type RenderBlank = (name: string) => React.ReactNode;

/** Raw Moodle `content` + how many blanks it has; markers outside that range stay text. */
export async function QuestionContent({
  content,
  blankCount,
  renderBlank,
}: {
  content: string;
  blankCount: number;
  renderBlank: RenderBlank;
}) {
  const blocks = parseQuestionContent(splitPlaceholders(content, blankCount));
  return <QuestionBlocks blocks={blocks} renderBlank={renderBlank} />;
}

/** Already-parsed blocks, for callers that built them for a non-blank reason. */
export async function QuestionBlocks({
  blocks,
  renderBlank,
}: {
  blocks: readonly QuestionContentBlock[];
  renderBlank: RenderBlank;
}) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) =>
        block.kind === "markdown" ? (
          <Prose key={index} text={block.text} renderBlank={renderBlank} />
        ) : (
          <CodeBlock key={index} lines={block.lines} renderBlank={renderBlank} />
        ),
      )}
    </div>
  );
}

/**
 * Markdown → prose. Raw HTML is never trusted: the export has none, and
 * `rehype-sanitize` runs over whatever the markdown produces.
 *
 * A blank's `[[n]]` marker is escaped first so markdown keeps it as text, then
 * swapped for `renderBlank(n)` inside the rendered text nodes. Passing no
 * `renderBlank` shows the marker itself (option text never has blanks).
 */
export function Prose({ text, renderBlank }: { text: string; renderBlank?: RenderBlank }) {
  return (
    <div className="flex flex-col gap-1 leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="text-pretty">{withBlanks(children, renderBlank)}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
              {withBlanks(children, renderBlank)}
            </code>
          ),
          a: ({ href, children }) => (
            <a href={href} rel="noreferrer noopener" className="underline underline-offset-4">
              {children}
            </a>
          ),
        }}
      >
        {screenProse(text)}
      </Markdown>
    </div>
  );
}

/**
 * Replaces `[[n]]` in a rendered text node with its input. Markdown leaves the
 * (escaped) marker as plain text, so splitting the string is enough; nested
 * elements (`code` inside `p`) are walked too.
 */
export function withBlanks(children: React.ReactNode, renderBlank?: RenderBlank): React.ReactNode {
  if (!renderBlank) return children;
  if (typeof children === "string") {
    const parts = readMarkers(children).split(/\[\[(\d+)\]\]/);
    if (parts.length === 1) return children;
    return parts.map((part, index) =>
      // split() alternates text, capture, text, capture, …
      index % 2 === 1 ? (
        <span key={index}>{renderBlank(part)}</span>
      ) : part === "" ? null : (
        <span key={index}>{part}</span>
      ),
    );
  }
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      // Deeper elements keep their own identity; only strings are substituted here.
      typeof child === "string" ? <span key={index}>{withBlanks(child, renderBlank)}</span> : child,
    );
  }
  return children;
}

/**
 * A program with Python syntax highlighting.
 *
 * Every text run is highlighted in a light theme (`structure: "inline"`), so the
 * blank inputs sit inline exactly where their markers were and the program
 * keeps its indentation. Shiki escapes the program text before emitting spans.
 */
export async function CodeBlock({
  lines,
  renderBlank,
}: {
  lines: readonly CodeLineItem[][];
  renderBlank: RenderBlank;
}) {
  const highlighted = await highlightLines(lines);

  return (
    <div className="overflow-x-auto rounded-lg border bg-white p-3 font-mono text-sm leading-6">
      <div className="w-max min-w-full whitespace-pre">
        {highlighted.map((runs, index) => (
          <div key={index} className="flex min-h-6 items-center">
            {runs.map((run, position) =>
              run.kind === "html" ? (
                <span
                  key={position}
                  dangerouslySetInnerHTML={{ __html: run.html === "" ? " " : run.html }}
                />
              ) : (
                <span key={position} className="mx-0.5 inline-flex">
                  {renderBlank(run.name)}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A Question's attached image (Q020, Q114). Moodle URLs are kept as-is. */
export function QuestionImages({
  images,
  questionNo,
}: {
  images: readonly string[];
  /** Only used for the alt text, so a screen reader can tell two images apart. */
  questionNo?: number;
}) {
  if (images.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-3">
      {images.map((src, index) => (
        <li key={src}>
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary Moodle host; next/image needs an allowlist */}
          <img
            src={src}
            alt={`Hình ảnh ${index + 1} của câu ${questionNo ?? ""}`.trim()}
            className="max-h-64 w-auto rounded-lg border bg-white object-contain"
            loading="lazy"
          />
        </li>
      ))}
    </ul>
  );
}
