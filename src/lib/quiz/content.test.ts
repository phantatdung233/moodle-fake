import { describe, expect, it } from "vitest";
import { splitPlaceholders } from "./content";

describe("splitPlaceholders", () => {
  it("keeps the text around a single [[n]] in place", () => {
    // Q006: the blank is a statement on its own line between two code lines.
    const segments = splitPlaceholders(
      "Điền … để in thông báo khi điều kiện sai:\ni = 1\nwhile i < 6:\n    print(i)\n    i += 1\n[[1]]\n    print(\"i is no longer less than 6\")",
    );

    expect(segments).toEqual([
      {
        kind: "text",
        value:
          "Điền … để in thông báo khi điều kiện sai:\ni = 1\nwhile i < 6:\n    print(i)\n    i += 1\n",
      },
      { kind: "blank", name: "1" },
      { kind: "text", value: "\n    print(\"i is no longer less than 6\")" },
    ]);
  });

  it("numbers several blanks in the order they appear (Q031: T1 then T2)", () => {
    const segments = splitPlaceholders(
      "Cho biết kết quả của T1 & T2 trong đoạn chương trình sau:\nT1 = (1, 9, 1, 6, 3, 4, 5, 1, 1, 2, 5, 6, 7, 8, 9, 2)\nT2 = ()\nfor x in T1:\n   if x not in T2:\n      T2+=(x,)\nprint (T1); print (T2)\n\nT1 = [[1]]\n\nT2 = [[2]]",
    );

    expect(segments.filter((segment) => segment.kind === "blank")).toEqual([
      { kind: "blank", name: "1" },
      { kind: "blank", name: "2" },
    ]);
    // Between the blanks there is nothing but the literal "T2 = " text.
    expect(segments.at(-2)).toEqual({ kind: "text", value: "\n\nT2 = " });
  });

  it("keeps the spaces between blanks on one line (Q103)", () => {
    const segments = splitPlaceholders("[[1]] a [[2]] b [[3]]\n    print(\"Yes\")");

    expect(segments).toEqual([
      { kind: "blank", name: "1" },
      { kind: "text", value: " a " },
      { kind: "blank", name: "2" },
      { kind: "text", value: " b " },
      { kind: "blank", name: "3" },
      { kind: "text", value: "\n    print(\"Yes\")" },
    ]);
  });

  it("leaves bracket literals in code alone (Q104 has no blanks)", () => {
    const content = "arr = np.array([[1,2,3,4,5], [6,7,8,9,10]])";

    expect(splitPlaceholders(content)).toEqual([{ kind: "text", value: content }]);
  });

  it("treats an out-of-range or malformed marker as plain text", () => {
    expect(splitPlaceholders("[[8]] a [[x]] b [[1]]", 2)).toEqual([
      { kind: "text", value: "[[8]] a [[x]] b " },
      { kind: "blank", name: "1" },
    ]);
  });

  it("returns one text segment when the content has no placeholders", () => {
    expect(splitPlaceholders("Cú pháp để sắp xếp mảng là?")).toEqual([
      { kind: "text", value: "Cú pháp để sắp xếp mảng là?" },
    ]);
  });
});
