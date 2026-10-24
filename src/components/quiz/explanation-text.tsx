"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/utils";
import {
  LEGACY_EXPLANATION_NOTE,
  normalizeExplanation,
  type ExplanationContext,
  type ExplanationSections,
} from "@/lib/gemini/explanation-format";

/**
 * The one renderer of an AI explanation, in the agreed shape: a fixed verdict
 * line (`**Kết quả:** em chọn "d" — sai. Đáp án đúng là "e".`) and a short
 * markdown body — bold, `code`, "- " bullets. Nothing else: no headings, no
 * tables, no raw HTML (`rehype-sanitize` runs over whatever the markdown makes).
 *
 * Both the student panel and the admin panel use it, so the same answer looks
 * the same wherever it is read. Text stored before the format existed is
 * normalised on render and says so, instead of looking like a different UI.
 */
export function ExplanationText({
  text,
  context,
  className,
}: {
  /** Raw explanation: already formatted, legacy markdown, or plain prose. */
  text: string;
  /** What the Question/Attempt says, to complete a legacy verdict. */
  context?: ExplanationContext;
  className?: string;
}) {
  const sections: ExplanationSections = normalizeExplanation(text, context);
  if (sections.verdict === "" && sections.body === "") return null;

  return (
    <div className={cn("flex flex-col gap-2 text-sm", className)}>
      {sections.verdict ? (
        <p data-testid="explanation-verdict" className="text-pretty">
          {renderVerdict(sections.verdict)}
        </p>
      ) : null}
      {sections.body ? (
        <div
          data-testid="explanation-body"
          className="leading-relaxed text-pretty [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_li]:my-0.5 [&_p]:my-0 [&_p+p]:mt-2 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5"
        >
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {sections.body}
          </Markdown>
        </div>
      ) : null}
      {sections.legacy ? (
        <p className="text-xs text-muted-foreground">{LEGACY_EXPLANATION_NOTE}</p>
      ) : null}
    </div>
  );
}

/** `**Kết quả:**` bold, the rest plain — the label is the visual anchor. */
function renderVerdict(line: string): React.ReactNode {
  const match = /^\*\*([\s\S]+?)\*\*\s*([\s\S]*)$/.exec(line);
  if (!match) return line;
  return (
    <>
      <strong className="font-semibold">{match[1]}</strong> {match[2]}
    </>
  );
}
