import { describe, expect, it } from "vitest";
import type { ContentSegment } from "./content";
import { parseQuestionContent, toMarkdown } from "./markdown";

const Q006_TEXT =
  "Điền … để in thông báo khi điều kiện sai:\ni = 1\nwhile i < 6:\n    print(i)\n    i += 1\n";
const Q006_TAIL = "\n    print(\"i is no longer less than 6\")";

describe("parseQuestionContent", () => {
  it("turns an indented Python run into a python code block (Q006)", () => {
    const blocks = parseQuestionContent([
      { kind: "text", value: Q006_TEXT },
      { kind: "blank", name: "1" },
      { kind: "text", value: Q006_TAIL },
    ]);

    expect(blocks).toEqual([
      { kind: "markdown", text: "Điền … để in thông báo khi điều kiện sai:" },
      {
        kind: "code",
        language: "python",
        lines: [
          ["i = 1"],
          ["while i < 6:"],
          ["    print(i)"],
          ["    i += 1"],
          [{ blank: "1" }],
          ['    print("i is no longer less than 6")'],
        ],
      },
    ]);
  });

  it("keeps the four-space indent of the nested line, not the blank's marker", () => {
    const blocks = parseQuestionContent(splitFixture(Q006_TEXT, Q006_TAIL));
    const code = blocks.find((block) => block.kind === "code");
    if (code?.kind !== "code") throw new Error("expected a code block");

    expect(code.lines[2]).toEqual(["    print(i)"]);
  });

  it("keeps blank order and surrounding code on one line (Q031)", () => {
    const blocks = parseQuestionContent(
      splitFixture(
        "Cho biết kết quả của T1 & T2 trong đoạn chương trình sau:\nT1 = (1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)\nT2 = ()\nfor x in T1:\n   if x not in T2:\n      T2+=(x,)\nprint (T1); print (T2)\n\nT1 = ",
        "\n\nT2 = ",
        "",
      ),
    );

    const code = blocks.filter((block) => block.kind === "code");
    expect(code).toHaveLength(1);
    const lines = code[0].kind === "code" ? code[0].lines : [];
    expect(lines).toContainEqual(["T1 = ", { blank: "1" }]);
    expect(lines).toContainEqual(["T2 = ", { blank: "2" }]);
    // The three-space `if` body survives verbatim.
    expect(lines).toContainEqual(["   if x not in T2:"]);
    expect(lines).toContainEqual(["      T2+=(x,)"]);
  });

  it("puts several blanks on one code line with their spaces (Q103)", () => {
    const blocks = parseQuestionContent(
      splitFixture("Điền vào … với yêu cầu điều kiện a bằng b in 1, a lớn hơn b in 2, ngược lại in 3?\na = 50; b = 10\n", " a ", " b ", ""),
    );

    const code = blocks.find((block) => block.kind === "code");
    if (code?.kind !== "code") throw new Error("expected a code block");
    expect(code.lines).toContainEqual([{ blank: "1" }, " a ", { blank: "2" }, " b ", { blank: "3" }]);
  });

  it("renders a prose-only question as markdown", () => {
    expect(parseQuestionContent([{ kind: "text", value: "Cú pháp để sắp xếp các phần tử của mảng là?" }])).toEqual([
      { kind: "markdown", text: "Cú pháp để sắp xếp các phần tử của mảng là?" },
    ]);
  });

  it("does not treat the empty lines between code stanzas as prose (Q002)", () => {
    const blocks = parseQuestionContent([
      {
        kind: "text",
        value:
          'Chương trình sau giải quyết bài toán gì?\n\nn = input("Nhập n")\n\ns = ""\n\nfor i in range(n):\n\n    if i % 2 == 0:\n\n        s.append(i)\n\nprint(s)',
      },
    ]);

    expect(blocks).toEqual([
      { kind: "markdown", text: "Chương trình sau giải quyết bài toán gì?" },
      {
        kind: "code",
        language: "python",
        lines: [
          ['n = input("Nhập n")'],
          [""],
          ['s = ""'],
          [""],
          ["for i in range(n):"],
          [""],
          ["    if i % 2 == 0:"],
          [""],
          ["        s.append(i)"],
          [""],
          ["print(s)"],
        ],
      },
    ]);
  });

  it("keeps bracket literals inside a code line as text (Q104)", () => {
    const blocks = parseQuestionContent([
      { kind: "text", value: "Cú pháp để in giá trị 8 trong mảng sau là?\narr = np.array([[1,2,3,4,5], [6,7,8,9,10]])" },
    ]);

    expect(blocks).toEqual([
      { kind: "markdown", text: "Cú pháp để in giá trị 8 trong mảng sau là?" },
      { kind: "code", language: "python", lines: [["arr = np.array([[1,2,3,4,5], [6,7,8,9,10]])"]] },
    ]);

    // A print call with nested brackets is a call, not prose (Q104-style options).
    expect(parseQuestionContent([{ kind: "text", value: "print(arr[1, 2])" }])).toEqual([
      { kind: "code", language: "python", lines: [["print(arr[1, 2])"]] },
    ]);
  });
});

describe("toMarkdown", () => {
  it("fences code blocks as python and keeps the blank markers", () => {
    const md = toMarkdown(parseQuestionContent(splitFixture(Q006_TEXT, Q006_TAIL)));

    expect(md).toBe(
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
});

/** Builds segments the way `splitPlaceholders` lays them out for a few fixtures. */
function splitFixture(...parts: string[]): ContentSegment[] {
  const segments: ContentSegment[] = [];
  parts.forEach((value, index) => {
    if (value !== "") segments.push({ kind: "text", value });
    if (index < parts.length - 1) segments.push({ kind: "blank", name: String(index + 1) });
  });
  return segments;
}
