import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose, QuestionContent, QuestionImages } from "./question-content";

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

/** Nested async components suspend during render, so flatten them before React sees them. */
async function resolveAsync(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const element = node as { type: unknown; props: Record<string, unknown> };
  const props = { ...element.props };
  if ("children" in props) props.children = await resolveAsync(props.children as React.ReactNode);
  if (typeof element.type === "function") {
    const rendered = await (element.type as (props: unknown) => unknown)(props);
    return resolveAsync(rendered as React.ReactNode);
  }
  return { ...element, props } as React.ReactElement;
}

describe("QuestionContent", () => {
  it("puts a blank in prose and in code at the marker's own position (the review page's view)", async () => {
    const html = renderToStaticMarkup(
      (await resolveAsync(
        await QuestionContent({
          content: "Điền [[1]] vào chỗ trống:\nfor i in range(2):\n    print([[2]])",
          blankCount: 2,
          renderBlank: (name) => <input data-blank={name} />,
        }),
      )) as React.ReactElement,
    );

    expect(html).not.toContain("[[1]]");
    expect(html).not.toContain("[[2]]");
    expect(html.match(/data-blank=/g)).toHaveLength(2);
    expect(html.indexOf('data-blank="1"')).toBeLessThan(html.indexOf('data-blank="2"'));
    // Highlighted code, indentation kept: the blank sits right after `print(`.
    expect(html).toContain("print</span>");
  });

  it("leaves a marker that is not a blank (outside 1..blankCount) as literal text", async () => {
    const html = renderToStaticMarkup(
      (await resolveAsync(
        await QuestionContent({
          content: "Mảng 2 chiều: np.array([[1, 2]])",
          blankCount: 0,
          renderBlank: (name) => <input data-blank={name} />,
        }),
      )) as React.ReactElement,
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
