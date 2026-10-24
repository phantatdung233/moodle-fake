import { describe, expect, it } from "vitest";

import {
  EXPLANATION_BODY_MARKER,
  EXPLANATION_VERDICT_LABEL,
  cleanBody,
  formatExplanation,
  normalizeExplanation,
  type ExplanationContext,
} from "./explanation-format";

/**
 * The fixtures below are the real shapes the model returned for this Quiz (read
 * from the explanation cache): a greeting, a bold answer letter, a spelled-out
 * verdict, a blank, a disputed recorded answer, TeX, a bullet list, a heading.
 * Each must come out with the same first line.
 */

const CONTEXT: ExplanationContext = {
  selectedOptionKeys: ["d"],
  correctOptionKeys: ["e"],
};

function verdictOf(text: string, context: ExplanationContext = {}): string {
  return normalizeExplanation(text, context).verdict;
}

describe("normalizeExplanation", () => {
  it("mọi kiểu cũ đều mở đầu bằng cùng một nhãn", () => {
    const samples = [
      // Q001: greeting + bold letter + spelled-out verdict.
      'Chào em, lựa chọn **"d": order()** của em là **sai** vì Python không có `order()`.',
      // Q003: recorded answer called "chính xác".
      "Chào em, câu này đáp án ghi nhận trong đề (**b. 3**) là **chính xác**!",
      // Q004: plain prose, no greeting.
      "Em chưa chọn đáp án cho câu này. Đáp án chính xác là **a: ‘Chào An’**.",
      // Q009: bullet list.
      'Chào em, câu này em chưa chọn đáp án nên chưa có điểm.\n\nĐáp án đúng là **b (-2)** vì `range`.\n* bước -2\n* in `66`',
      // Q020: disputed recorded answer + numbered list.
      "Chào em, bài này em chưa chọn đáp án, và **đáp án ghi nhận của đề (A) bị sai kiến thức Python**.\n\n1. `answer *= v` là phép nhân dồn.",
    ];
    for (const sample of samples) {
      expect(verdictOf(sample)).toMatch(new RegExp(`^\\*\\*${EXPLANATION_VERDICT_LABEL}\\*\\*`));
    }
  });

  it("nêu đúng lựa chọn của sinh viên và đáp án đúng, đọc từ chính câu chữ của model", () => {
    const sections = normalizeExplanation(
      'Chào em, lựa chọn **"d": order()** của em là **sai** vì Python không có `order()`.',
      CONTEXT,
    );

    expect(sections.verdict).toBe(
      '**Kết quả:** em chọn "d" — sai. Đáp án đúng là "e".',
    );
    expect(sections.legacy).toBe(true);
  });

  it("câu bỏ trống nói rõ là bỏ trống, không nói 'chọn null'", () => {
    const sections = normalizeExplanation(
      "Em chưa chọn đáp án cho câu này. Đáp án chính xác là **a: ‘Chào An’**.",
      { correctOptionKeys: ["a"] },
    );

    expect(sections.verdict).toBe(
      '**Kết quả:** em bỏ trống — chưa trả lời. Đáp án đúng là "a".',
    );
  });

  it("điền khuyết: nêu các ô đã điền và việc đề ghi nhận đáp án", () => {
    const sections = normalizeExplanation(
      "Chào em, ở câu này em **chưa điền câu trả lời** cho Ô 1 nên bị tính là làm sai.",
      { blankNames: ["1"], blankValues: [""], correctBlankAnswers: ["def my_function()"] },
    );

    expect(sections.verdict).toBe(
      '**Kết quả:** em bỏ trống — chưa trả lời. Đáp án đúng là "def my_function()".',
    );
  });

  it("giữ cảnh báo khi đề ghi nhận đáp án sai kiến thức", () => {
    const sections = normalizeExplanation(
      "Chào em, bài này em chưa chọn đáp án, và **đáp án ghi nhận của đề (A) bị sai kiến thức Python**.",
    );

    expect(sections.verdict).toContain("Đề ghi nhận sai kiến thức");
  });

  it("bỏ lời chào, dòng 'Đáp án đúng là …' lặp lại và tiêu đề rỗng", () => {
    const sections = normalizeExplanation(
      [
        "Chào em, lựa chọn **a** của em là **sai**.",
        "",
        "### Giải thích",
        "",
        "Đáp án đúng là **e** vì `.sort()` sắp xếp tại chỗ.",
        "",
        "$1 + 9 + 1 = 24$.",
      ].join("\n"),
      { selectedOptionKeys: ["a"], correctOptionKeys: ["e"] },
    );

    expect(sections.body).not.toMatch(/^Chào em/m);
    expect(sections.body).not.toMatch(/Giải thích/);
    expect(sections.body).not.toMatch(/^#{1,6} /m);
    // TeX is shown as code, not as raw `$…$`.
    expect(sections.body).toContain("`1 + 9 + 1 = 24`");
  });

  it("đã đúng shape thì giữ nguyên (idempotent)", () => {
    const formatted =
      "**Kết quả:** em chọn \"d\" — sai. Đáp án đúng là \"e\".\n\n" +
      `${EXPLANATION_BODY_MARKER}\n\n` +
      "Vì Python không có `order()`.\n";

    const once = normalizeExplanation(formatted, CONTEXT);
    const twice = normalizeExplanation(formatExplanation(once), CONTEXT);

    expect(once.verdict).toBe('**Kết quả:** em chọn "d" — sai. Đáp án đúng là "e".');
    expect(once.body).toBe("Vì Python không có `order()`.");
    expect(twice.verdict).toBe(once.verdict);
    expect(twice.body).toBe(once.body);
  });

  it("giữ nguyên khối code, chỉ bỏ lời chào và tiêu đề", () => {
    const sections = normalizeExplanation(
      ["Chào em, xem ví dụ:", "", "```python", "print('x')  # giữ nguyên", "```"].join("\n"),
    );

    expect(sections.body).toContain("```python");
    expect(sections.body).toContain("print('x')  # giữ nguyên");
    expect(sections.body).not.toMatch(/Chào em/);
  });

  it("câu trả lời lạ nhưng không có thông tin gì để nêu thì chỉ nói theo đề", () => {
    const sections = normalizeExplanation("Một câu trả lời không nói gì về đáp án.");

    expect(sections.verdict).toBe(
      "**Kết quả:** em bỏ trống. Đề chưa ghi nhận đáp án đúng.",
    );
  });
});

describe("normalizeExplanation — dữ liệu thật trong cache", () => {
  it("bỏ câu 'Đáp án chính xác là **a: ‘Chào An’**' khi đã có ở dòng kết quả", () => {
    const sections = normalizeExplanation(
      "Em chưa chọn đáp án cho câu này. Đáp án chính xác là **a: ‘Chào An’**.\n\n" +
        "Trong Python, `str.format()` thay `{0}` bằng 'An'.",
      { correctOptionKeys: ["a"] },
    );

    expect(sections.body).toBe("Trong Python, `str.format()` thay `{0}` bằng 'An'.");
  });

  it("giữ lý do khi model gộp đáp án và lý do trong một câu", () => {
    const sections = normalizeExplanation(
      "Chào em, câu này em chưa chọn đáp án nên chưa có điểm.\n\n" +
        "Đáp án đúng là **b (-2)** vì `range` giảm dần từ 6 về 2.",
    );

    // The reason belongs to its sentence: lifting it out would leave a clause
    // that starts mid-way, so the whole sentence is the body.
    expect(sections.body).toBe("Đáp án đúng là **b (-2)** vì `range` giảm dần từ 6 về 2.");
  });

  it("bỏ câu chốt lặp lại ở cuối nhưng giữ lời khuyên", () => {
    const verdictOnly = normalizeExplanation(
      "Đoạn mã cộng dồn vào `ttl`.\n\nĐáp án đúng là **c**.\n\n" +
        "Vì bạn chưa chọn đáp án nên câu này bị tính là chưa trả lời.",
    );
    const withAdvice = normalizeExplanation(
      "Đoạn mã cộng dồn vào `ttl`.\n\nĐáp án đúng là **c**.\n\n" +
        "Vì bạn chưa chọn đáp án nên câu này bị tính là chưa trả lời. " +
        "Hãy lưu ý cách vòng lặp `for` cộng dồn nhé!",
    );

    expect(verdictOnly.body).toBe("Đoạn mã cộng dồn vào `ttl`.");
    expect(withAdvice.body).toBe(
      "Đoạn mã cộng dồn vào `ttl`.\n\nHãy lưu ý cách vòng lặp `for` cộng dồn nhé!",
    );
  });
});

describe("cleanBody", () => {
  it("gộp dòng trống thừa và cắt khoảng trắng cuối dòng", () => {
    expect(cleanBody("Một.  \n\n\n\nHai.   ")).toBe("Một.\n\nHai.");
  });
});
