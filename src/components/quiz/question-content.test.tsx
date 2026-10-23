import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose, QuestionImages } from "./question-content";

/**
 * Prose is the fallback path for a blank that sits outside a code block. The
 * marker is escaped for markdown, so the input must still arrive at the marker's
 * position instead of the whole `[[n]]` being dropped or turned into a link.
 */
describe("Prose", () => {
  it("replaces an escaped marker with the blank input at its position", () => {
    const html = renderToStaticMarkup(
      <Prose text={"Điền [[1]] a [[2]]"} renderBlank={(name) => <input data-blank={name} />} />,
    );

    expect(html).toContain('<input data-blank="1"/>');
    expect(html).toContain('<input data-blank="2"/>');
    expect(html).not.toContain("[[");
    expect(html).not.toContain("<a ");
    expect(html.indexOf('data-blank="1"')).toBeLessThan(html.indexOf('data-blank="2"'));
  });

  it("turns a marker inside inline code into an input too", () => {
    const html = renderToStaticMarkup(
      <Prose text={"Kết quả: `len([[1]])`"} renderBlank={(name) => <input data-blank={name} />} />,
    );

    expect(html).toContain('<input data-blank="1"/>');
    expect(html).toContain("len(");
  });

  it("shows the marker itself when there is no blank renderer (option text)", () => {
    const html = renderToStaticMarkup(<Prose text={"Giá trị [[1]]"} />);

    expect(html).toContain("[[1]]");
  });
});

describe("QuestionImages", () => {
  it("renders Q020's attached Moodle image", () => {
    const html = renderToStaticMarkup(<QuestionImages images={["https://utexlms.example/a.png"]} questionNo={20} />);

    expect(html).toContain('src="https://utexlms.example/a.png"');
    expect(html).toContain("Hình ảnh 1 của câu 20");
  });

  it("renders nothing for a Question without images", () => {
    expect(renderToStaticMarkup(<QuestionImages images={[]} />)).toBe("");
  });
});
