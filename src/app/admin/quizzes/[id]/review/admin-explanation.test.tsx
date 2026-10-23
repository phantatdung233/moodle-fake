import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { AdminExplanation } from "./admin-explanation";

/**
 * Story 21, client half: the admin's explanation block only shows what the
 * server handed it. No heuristic decides that an answer "looks wrong" — the
 * button is the only reason Gemini is ever called.
 */
function render(props: Partial<Parameters<typeof AdminExplanation>[0]> = {}): string {
  return renderToStaticMarkup(
    (
      <AdminExplanation
        quizId="6a1b2c3d4e5f60718293a4b5"
        questionId="Q001"
        questionHash="abc"
        initialText={null}
        {...props}
      />
    ) as ReactElement,
  );
}

describe("AdminExplanation", () => {
  it("chưa có giải thích: nút 'Giải thích bằng AI', không có văn bản nào", () => {
    const html = render();

    expect(html).toContain('data-testid="admin-explanation"');
    expect(html).toContain('data-status="idle"');
    expect(html).toContain("Giải thích bằng AI");
    expect(html).not.toContain("Sinh lại giải thích");
    expect(html).not.toContain("đã có sẵn");
  });

  it("đã có giải thích trong cache: hiện ngay văn bản, dấu 'đã có sẵn' và nút sinh lại", () => {
    const html = render({ initialText: "Đáp án ghi nhận là sort()." });

    expect(html).toContain('data-status="done"');
    expect(html).toContain("Đáp án ghi nhận là sort().");
    expect(html).toContain("đã có sẵn");
    expect(html).toContain("Sinh lại giải thích");
  });

  it("nhắc rằng đáp án vẫn do giảng viên quyết định", () => {
    expect(render()).toContain("đáp án đúng/sai vẫn do bạn quyết định");
  });
});
