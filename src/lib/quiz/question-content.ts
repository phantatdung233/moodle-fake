/**
 * Turns a Question's raw Moodle content into renderable pieces.
 *
 * 94 of the 180 Questions are multi-line and carry Python code as plain text —
 * no markdown fences, no HTML — so blank lines and indentation are all the
 * signals there are. Splitting off the indented lines lets the page render them
 * in a `<pre>` that keeps the indentation, instead of collapsing it like prose.
 */
export type QuestionContentBlock =
  | { kind: "prose"; text: string }
  | { kind: "code"; text: string };

const INDENTED = /^[ \t]+\S/;

/** Prose is kept line by line (the page draws paragraphs); code keeps its own newlines. */
export function renderQuestionContent(content: string): QuestionContentBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: QuestionContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (INDENTED.test(line)) {
      const code: string[] = [];
      while (index < lines.length && INDENTED.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n").trimEnd() });
      continue;
    }

    // A code line directly followed by another line starts a block too, so a
    // program whose first line is not indented (`for i in range(3):`) still
    // renders with its body instead of as separate prose paragraphs.
    if (index + 1 < lines.length && INDENTED.test(lines[index + 1])) {
      const code: string[] = [line];
      index += 1;
      while (index < lines.length && INDENTED.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n").trimEnd() });
      continue;
    }

    if (line.trim() !== "") {
      blocks.push({ kind: "prose", text: line.trimEnd() });
    }
    index += 1;
  }

  return blocks;
}
