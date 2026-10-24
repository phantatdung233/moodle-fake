import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock, Prose, QuestionContent, QuestionImages } from "./question-content";
import { prepareQuestionContent } from "./question-blocks";

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

/**
 * React refuses to render an `async` function as a Client Component ("Only
 * Server Components can be async"), so the two components that client pages
 * mount must stay synchronous. Guarding the function's constructor is the only
 * way to see that from outside: `AsyncFunction !== Function`.
 */
describe("QuestionContent is renderable from a client component", () => {
  it("is synchronous, and so is the code block it renders (the client runner mounts both)", () => {
    expect(QuestionContent.constructor.name).toBe("Function");
    expect(CodeBlock.constructor.name).toBe("Function");
    expect(Prose.constructor.name).toBe("Function");
  });

  it("accepts plain, serializable blocks as props", async () => {
    const blocks = await prepareQuestionContent("Điền [[1]] vào chỗ trống:\nprint([[2]])", 2);

    // Structured-cloneable props survive the server → client boundary.
    expect(structuredClone(blocks)).toEqual(blocks);
  });
});

describe("QuestionContent", () => {
  it("puts a blank in prose and in code at the marker's own position (the review page's view)", async () => {
    const blocks = await prepareQuestionContent(
      "Điền [[1]] vào chỗ trống:\nfor i in range(2):\n    print([[2]])",
      2,
    );
    const html = renderToStaticMarkup(
      <QuestionContent blocks={blocks} renderBlank={(name) => <input data-blank={name} />} />,
    );

    expect(html).not.toContain("[[1]]");
    expect(html).not.toContain("[[2]]");
    expect(html.match(/data-blank=/g)).toHaveLength(2);
    expect(html.indexOf('data-blank="1"')).toBeLessThan(html.indexOf('data-blank="2"'));
    // Highlighted code, indentation kept: the blank sits right after `print(`.
    expect(html).toContain("print</span>");
  });

  it("leaves a marker that is not a blank (outside 1..blankCount) as literal text", async () => {
    const blocks = await prepareQuestionContent("Mảng 2 chiều: np.array([[1, 2]])", 0);
    const html = renderToStaticMarkup(
      <QuestionContent blocks={blocks} renderBlank={(name) => <input data-blank={name} />} />,
    );

    expect(html).toContain("[[1, 2]]");
    expect(html).not.toContain("data-blank");
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
