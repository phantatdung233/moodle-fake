/**
 * Question content is Moodle's raw text: prose mixed with Python that the
 * export never wrapped in code fences, plus `[[n]]` markers where a blank sits.
 *
 * `splitPlaceholders` is the pure seam the student UI renders from: it turns
 * `content` into alternating text / blank segments so a blank input lands
 * exactly where its `[[n]]` marker is, including inside a code block.
 */

export type ContentSegment =
  | { kind: "text"; value: string }
  /** `name` is the number inside the marker, matching Question.blanks[].name. */
  | { kind: "blank"; name: string };

const PLACEHOLDER = /\[\[(\d+)\]\]/g;

/**
 * Splits content on `[[n]]` markers. A marker whose number is outside
 * `1..blankCount` (or malformed, e.g. `[[x]]`) stays literal text, so a code
 * literal such as Q104's `np.array([[1,2,3,4,5], …])` is not mistaken for a
 * blank just because it looks like one.
 */
export function splitPlaceholders(content: string, blankCount = Number.MAX_SAFE_INTEGER): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(PLACEHOLDER)) {
    const number = Number(match[1]);
    const index = match.index ?? 0;
    if (!(number >= 1 && number <= blankCount)) continue;

    if (index > cursor) {
      segments.push({ kind: "text", value: content.slice(cursor, index) });
    }
    segments.push({ kind: "blank", name: match[1] });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ kind: "text", value: content.slice(cursor) });
  }
  return segments;
}
