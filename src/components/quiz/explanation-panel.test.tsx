import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExplanationPanel } from "./explanation-panel";

/**
 * Showing the answer must be free: the panel renders a button and calls the
 * model only when the sinh viên clicks. Every render below is a static mount,
 * which runs no effect — if the panel ever auto-loads, `fetch` is called here.
 */
describe("ExplanationPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(mode: "practice" | "summary" | "none"): string {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const markup = renderToStaticMarkup(
      <ExplanationPanel attemptId="a1" questionId="Q001" questionHash="hash" mode={mode} />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    return markup;
  }

  it("chưa sinh gì: chỉ có nút giải thích, chờ người dùng bấm", () => {
    for (const mode of ["practice", "summary"] as const) {
      const markup = mount(mode);

      expect(markup).toContain("Giải thích bằng AI");
      expect(markup.match(/Giải thích bằng AI/g)).toHaveLength(1);
      expect(markup).not.toContain("data-testid");
      expect(markup).not.toContain("explanation-body");
    }
  });

  it("chế độ thi chưa nộp: không có panel nào", () => {
    expect(mount("none")).toBe("");
  });

  it("hiển thị lại giải thích đã có mà không yêu cầu sinh lại", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const markup = renderToStaticMarkup(
      <ExplanationPanel
        attemptId="a1"
        questionId="Q001"
        questionHash="hash"
        initialText="Đây là phần giải thích đã sinh."
      />,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(markup).toContain("Đây là phần giải thích đã sinh.");
    expect(markup).not.toContain("Giải thích bằng AI");
    expect(markup).toContain('data-status="done"');
  });
});
