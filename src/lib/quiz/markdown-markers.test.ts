import { describe, expect, it } from "vitest";
import { readMarkers, screenProse } from "./markdown";

/**
 * Prose blank markers: GFM parses `[[1]]` as a wiki-style link (`<a href="1">`),
 * and `rehype-sanitize` then drops it — so the marker must be escaped before
 * markdown sees it and read back in the rendered text node.
 */
describe("screenProse / readMarkers", () => {
  it("escapes every marker so markdown keeps it as text", () => {
    expect(screenProse("Điền [[1]] a [[2]] b [[3]]")).toBe("Điền \\[\\[1\\]\\] a \\[\\[2\\]\\] b \\[\\[3\\]\\]");
  });

  it("leaves prose without markers alone", () => {
    expect(screenProse("Cú pháp để sắp xếp là?")).toBe("Cú pháp để sắp xếp là?");
  });

  it("does not touch a code literal that only looks like a marker", () => {
    // Q104's `np.array([[1,2,3,4,5], …])` is a real list, not blank 1.
    expect(screenProse("x = np.array([[1,2,3,4,5]])")).toBe("x = np.array([[1,2,3,4,5]])");
  });

  it("reads the escaped marker back", () => {
    expect(readMarkers("a \\[\\[2\\]\\] b")).toBe("a [[2]] b");
  });

  it("also reads a marker that reached the text node unescaped", () => {
    expect(readMarkers("a [[7]] b")).toBe("a [[7]] b");
  });
});
