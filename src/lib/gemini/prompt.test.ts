import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseQuizJson } from "@/lib/quiz/parser";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { buildExplanationPrompt, type ExplanationRequest } from "./prompt";

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");
const realQuestions = parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;

function question(id: string): QuizQuestion {
  const found = realQuestions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`thiếu câu ${id} trong file Moodle`);
  return found;
}

function request(overrides: Partial<ExplanationRequest> = {}): ExplanationRequest {
  return {
    question: question("Q144"),
    studentAnswer: { selectedOptionKeys: ["a"], blankValues: [] },
    ...overrides,
  };
}

describe("buildExplanationPrompt", () => {
  it("chứa nội dung câu hỏi và mọi lựa chọn kèm key", () => {
    const q144 = question("Q144");
    const prompt = buildExplanationPrompt(request());

    expect(prompt).toContain(q144.content);
    for (const option of q144.options) {
      expect(prompt).toContain(option.text);
      expect(prompt).toContain(`"${option.key}"`);
    }
    // Not one option missing: Q144 has six.
    expect(q144.options).toHaveLength(6);
  });

  it("nêu đáp án đúng đã ghi nhận trong đề và câu trả lời của sinh viên", () => {
    const prompt = buildExplanationPrompt(
      request({ studentAnswer: { selectedOptionKeys: ["a"], blankValues: [] } }),
    );

    // Q144 records b as correct.
    expect(prompt).toMatch(/Đáp án đúng ghi nhận[^\n]*\bb\b/);
    expect(prompt).toMatch(/Sinh viên chọn[^\n]*\ba\b/);
  });

  it("yêu cầu trả lời bằng tiếng Việt, ngắn gọn và giải thích vì sao", () => {
    const prompt = buildExplanationPrompt(request());

    expect(prompt).toMatch(/tiếng Việt/);
    expect(prompt).toMatch(/ngắn gọn/);
    expect(prompt).toMatch(/vì sao/i);
  });

  it("yêu cầu nói thẳng khi đáp án ghi nhận trong đề sai kiến thức", () => {
    const prompt = buildExplanationPrompt(request());

    expect(prompt).toMatch(/sai kiến thức/);
    expect(prompt).toMatch(/nói thẳng/);
  });

  it("với multianswer, liệt kê mọi ô trống kèm đáp án mong đợi và điều sinh viên gõ", () => {
    const q031 = question("Q031");
    expect(q031.type).toBe("multianswer");
    expect(q031.blanks.length).toBeGreaterThan(1);

    const prompt = buildExplanationPrompt(
      request({
        question: q031,
        studentAnswer: { selectedOptionKeys: [], blankValues: ["(1, 9, 1)", ""] },
      }),
    );

    expect(prompt).toContain(q031.content);
    for (const [index, blank] of q031.blanks.entries()) {
      expect(prompt).toContain(blank.acceptedAnswer);
      expect(prompt).toContain(`Ô ${index + 1}`);
    }
    expect(prompt).toContain("(1, 9, 1)");
    // A blank the sinh viên left empty is still listed.
    expect(prompt).toMatch(/Ô 2[^\n]*chưa điền/);
    expect(prompt).toContain("cả câu");
  });

  it("xử lý câu để trống mà không ném lỗi", () => {
    const prompt = buildExplanationPrompt({
      question: question("Q001"),
      studentAnswer: undefined,
    });

    expect(prompt).toContain(question("Q001").content);
    expect(prompt).toMatch(/chưa chọn đáp án/);
  });

  it("không chứa chỉ dẫn phụ thuộc môi trường — prompt là chuỗi thuần", () => {
    const a = buildExplanationPrompt(request());
    const b = buildExplanationPrompt(request());
    expect(a).toBe(b);
  });
});
