import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExplanationText } from "./explanation-text";

function html(text: string, context = {}): string {
  return renderToStaticMarkup(<ExplanationText text={text} context={context} />);
}

describe("ExplanationText", () => {
  it("hiện dòng kết quả in đậm nhãn, phần còn lại thường", () => {
    const markup = html('**Kết quả:** em chọn "d" — sai. Đáp án đúng là "e".');

    expect(markup).toContain("<strong");
    expect(markup).toContain("Kết quả:");
    expect(markup).toContain("em chọn &quot;d&quot;");
  });

  it("giải thích cũ (markdown tự do) vẫn ra đúng form và có ghi chú", () => {
    const markup = html(
      'Chào em, lựa chọn **"d"** của em là **sai**.\n\n### Vì sao\n\nVì Python không có `order()`.',
      { selectedOptionKeys: ["d"], correctOptionKeys: ["e"] },
    );

    expect(markup).toContain("Kết quả:");
    expect(markup).toContain("Đáp án đúng là &quot;e&quot;");
    expect(markup).not.toContain("Chào em");
    // Headings never leak into the body; the lead-in is bold instead.
    expect(markup).not.toMatch(/<h[1-6]/);
    expect(markup).toContain("<code>order()</code>");
    expect(markup).toContain("thống nhất định dạng");
  });

  it("không render HTML thô từ model", () => {
    const markup = html('**Kết quả:** em chọn "a" — sai.\n\n<script>alert(1)</script>x');

    expect(markup).not.toContain("<script>");
  });

  it("văn bản rỗng không render gì", () => {
    expect(html("")).toBe("");
  });
});
