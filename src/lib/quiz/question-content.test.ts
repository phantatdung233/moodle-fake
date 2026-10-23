import { describe, expect, it } from "vitest";
import { renderQuestionContent } from "./question-content";

const CODE = "Đoạn 1\n\nfor i in range(3):\n    print(i)\n    i += 1\nKết thúc";

describe("renderQuestionContent", () => {
  it("giữ nguyên thụt lề và xuống dòng của khối code", () => {
    const blocks = renderQuestionContent(CODE);

    expect(blocks).toEqual([
      { kind: "prose", text: "Đoạn 1" },
      { kind: "code", text: "for i in range(3):\n    print(i)\n    i += 1" },
      { kind: "prose", text: "Kết thúc" },
    ]);
    // Đúng 4 dấu cách ở dòng trong thân vòng lặp, không bị trim.
    expect(blocks.find((block) => block.kind === "code")?.text).toContain("\n    print(i)");
  });

  it("nhiều dòng thụt lề liền nhau là code, không lẫn với câu văn", () => {
    const blocks = renderQuestionContent(
      "Viết kết quả:\nx = 1\nif x > 0:\n        print('ok')\n        print(x)",
    );

    expect(blocks.filter((block) => block.kind === "code")).toHaveLength(1);
    expect(blocks.find((block) => block.kind === "code")?.text).toBe(
      "if x > 0:\n        print('ok')\n        print(x)",
    );
  });

  it("câu văn ngay sau code vẫn là văn xuôi", () => {
    const blocks = renderQuestionContent("for i in range(3):\n    print(i)\nChọn đáp án đúng");

    expect(blocks.map((block) => block.kind)).toEqual(["code", "prose"]);
    expect(blocks[1]).toEqual({ kind: "prose", text: "Chọn đáp án đúng" });
  });

  it("câu không có code chỉ là văn xuôi", () => {
    expect(renderQuestionContent("Cú pháp để sắp xếp là?\nChọn một.")).toEqual([
      { kind: "prose", text: "Cú pháp để sắp xếp là?" },
      { kind: "prose", text: "Chọn một." },
    ]);
  });

  it("bỏ dòng trống thừa ở hai đầu", () => {
    expect(renderQuestionContent("\n\nCâu hỏi\n\n")).toEqual([
      { kind: "prose", text: "Câu hỏi" },
    ]);
  });
});
