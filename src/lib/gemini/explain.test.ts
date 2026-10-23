import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { parseQuizJson } from "@/lib/quiz/parser";
import type { QuizQuestion } from "@/lib/quiz/quiz.model";
import { hashQuestionAnswers } from "@/lib/quiz/question-hash";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";
import type { ExplainClient } from "./client";

const { explainQuestion, isGeminiConfigured, EXPLANATION } = await import("./explain");
const { getCachedExplanation } = await import("./cache");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");
const realQuestions = parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions;

function question(id: string): QuizQuestion {
  const found = realQuestions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`thiếu câu ${id} trong file Moodle`);
  return found;
}

/** Records every model call so the tests can count them. */
function fakeClient(...answers: string[]) {
  const calls: string[] = [];
  const queue = [...answers];
  const client: ExplainClient = {
    async *stream(prompt) {
      calls.push(prompt);
      yield queue.shift() ?? "Giải thích giả.";
    },
  };
  return { client, calls };
}

async function collect(result: Awaited<ReturnType<typeof explainQuestion>>): Promise<string> {
  let text = "";
  for await (const event of result.stream) text += event.text ?? "";
  return text;
}

async function frames(result: Awaited<ReturnType<typeof explainQuestion>>) {
  const seen: { text?: string; error?: string }[] = [];
  for await (const event of result.stream) seen.push(event);
  return seen;
}

const askedByStudentA = { selectedOptionKeys: ["a"], blankValues: [] };

describe("explainQuestion", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_explain_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  it("sinh giải thích bằng model khi chưa có cache", async () => {
    const { client, calls } = fakeClient("Numpy là thư viện tính toán khoa học.");

    const result = await explainQuestion({
      question: question("Q144"),
      studentAnswer: askedByStudentA,
      client,
    });

    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(await collect(result)).toBe("Numpy là thư viện tính toán khoa học.");
    expect(calls).toHaveLength(1);
  });

  it("sinh viên thứ hai xem cùng câu nhận bản cache, không gọi model lần nữa", async () => {
    const { client, calls } = fakeClient("Bản giải thích đầu tiên.");
    const q144 = question("Q144");

    const first = await explainQuestion({ question: q144, studentAnswer: askedByStudentA, client });
    expect(await collect(first)).toBe("Bản giải thích đầu tiên.");

    // A different sinh viên (different answer) on the same Question: cache is
    // per Question, not per answer, so nothing new is generated.
    const second = await explainQuestion({
      question: q144,
      studentAnswer: { selectedOptionKeys: ["b"], blankValues: [] },
      client,
    });

    expect(calls).toHaveLength(1);
    expect(second).toMatchObject({ ok: true, source: "cache" });
    expect(await collect(second)).toBe("Bản giải thích đầu tiên.");
  });

  it("giảng viên sửa đáp án → hash đổi → sinh giải thích mới", async () => {
    const { client, calls } = fakeClient("Bản cho đáp án cũ.", "Bản cho đáp án mới.");
    const q144 = question("Q144");
    await collect(await explainQuestion({ question: q144, studentAnswer: askedByStudentA, client }));

    const edited: QuizQuestion = {
      ...q144,
      options: q144.options.map((option) => ({ ...option, correct: option.key === "a" })),
    };
    const editedWithHash: QuizQuestion = {
      ...edited,
      hash: hashQuestionAnswers(edited.content, edited.options, edited.blanks),
    };
    expect(editedWithHash.hash).not.toBe(q144.hash);

    const fresh = await explainQuestion({
      question: editedWithHash,
      studentAnswer: askedByStudentA,
      client,
    });

    expect(await collect(fresh)).toBe("Bản cho đáp án mới.");
    expect(calls).toHaveLength(2);
  });

  it("Attempt cũ vẫn đọc được giải thích của bản đề cũ sau khi đáp án bị sửa", async () => {
    const { client } = fakeClient("Bản cho đáp án cũ.", "Bản cho đáp án mới.");
    const q144 = question("Q144");
    await collect(await explainQuestion({ question: q144, studentAnswer: askedByStudentA, client }));

    const edited: QuizQuestion = {
      ...q144,
      options: q144.options.map((option) => ({ ...option, correct: option.key === "a" })),
    };
    const newQuestion = { ...edited, hash: hashQuestionAnswers(edited.content, edited.options, edited.blanks) };
    await collect(await explainQuestion({ question: newQuestion, studentAnswer: askedByStudentA, client }));

    // The old Attempt carries the old snapshot, including the old hash.
    const oldAttemptView = await explainQuestion({
      question: q144,
      studentAnswer: askedByStudentA,
      client,
    });
    expect(oldAttemptView).toMatchObject({ ok: true, source: "cache" });
    expect(await collect(oldAttemptView)).toBe("Bản cho đáp án cũ.");
  });

  it("với fake model nói thẳng đáp án Q153 ghi trong đề sai, giải thích đó được trả về và cache", async () => {
    const flagged =
      "Đáp án ghi nhận trong đề (d: 2) sai kiến thức: else thực thi nên x phải bằng 3 (e).";
    const { client, calls } = fakeClient(flagged);

    const q153 = question("Q153");
    const first = await explainQuestion({ question: q153, studentAnswer: { selectedOptionKeys: ["e"] }, client });

    expect(await collect(first)).toBe(flagged);
    expect(calls[0]).toContain("nói thẳng");
    expect(calls[0]).toContain(q153.content);

    const second = await explainQuestion({ question: q153, studentAnswer: { selectedOptionKeys: ["e"] }, client });
    expect(await collect(second)).toBe(flagged);
    expect(calls).toHaveLength(1);
  });

  it("thiếu GEMINI_API_KEY → lỗi mềm 'Chưa cấu hình Gemini', không gọi model", async () => {
    const result = await explainQuestion({
      question: question("Q001"),
      studentAnswer: { selectedOptionKeys: ["d"], blankValues: [] },
      apiKey: "",
    });

    expect(result).toMatchObject({ ok: false, error: EXPLANATION.notConfigured });
    expect(EXPLANATION.notConfigured).toBe("Chưa cấu hình Gemini");
    expect(await collect(result)).toBe("");
    expect(await getCachedExplanation(question("Q001").hash)).toBeNull();
  });

  it("đọc key từ GEMINI_API_KEY khi không truyền client (không gọi mạng)", async () => {
    // Empty key through env: same soft error, no SDK construction.
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(isGeminiConfigured()).toBe(false);
      const result = await explainQuestion({ question: question("Q001"), studentAnswer: {} });
      expect(result).toMatchObject({ ok: false, error: EXPLANATION.notConfigured });
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });

  it("model không dùng được (lỗi quyền/model) → lỗi mềm nhắc đổi GEMINI_MODEL, không lộ stack trace", async () => {
    const client: ExplainClient = {
      // The SDK throws a double-encoded JSON string, not an Error.
      async *stream() {
        throw '{"error":{"code":403,"message":"PERMISSION_DENIED: models/gemini-2.5-flash is not available"}}';
      },
    };

    const result = await explainQuestion({ question: question("Q001"), studentAnswer: {}, client });

    // `ok` is decided before the first token; the failure shows up as a frame.
    expect(await frames(result)).toEqual([{ error: EXPLANATION.modelUnavailable }]);
    expect(EXPLANATION.modelUnavailable).toBe(
      "Gemini không dùng được với cấu hình hiện tại — kiểm tra GEMINI_API_KEY hoặc đổi GEMINI_MODEL",
    );
  });

  it("lỗi tạm thời (mất mạng) giữ thông báo chung, không đổ lỗi cấu hình", async () => {
    const client: ExplainClient = {
      async *stream() {
        throw new Error("fetch failed: ECONNRESET");
      },
    };

    const result = await explainQuestion({ question: question("Q001"), studentAnswer: {}, client });

    expect(await frames(result)).toEqual([{ error: EXPLANATION.unavailable }]);
    expect(EXPLANATION.unavailable).toBe("Chưa cấu hình hoặc không dùng được Gemini");
  });

  it("model trả về rỗng → lỗi mềm chứ không cache chuỗi rỗng", async () => {
    const { client } = fakeClient("   ");
    const q001 = question("Q001");

    const result = await explainQuestion({ question: q001, studentAnswer: {}, client });

    expect(await frames(result)).toEqual([{ error: EXPLANATION.unavailable }]);
    expect(await getCachedExplanation(q001.hash)).toBeNull();
  });

  it("lỗi giữa dòng: giữ phần chữ đã stream, báo lỗi mềm, không cache để lần sau sinh lại", async () => {
    let attempts = 0;
    const client: ExplainClient = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          yield "Numpy là";
          throw new Error("mất mạng");
        }
        yield "Numpy là thư viện tính toán khoa học.";
      },
    };
    const q144 = question("Q144");

    const broken = await explainQuestion({ question: q144, studentAnswer: askedByStudentA, client });
    expect(await frames(broken)).toEqual([{ text: "Numpy là" }, { error: EXPLANATION.unavailable }]);

    const retried = await explainQuestion({ question: q144, studentAnswer: askedByStudentA, client });
    expect(await collect(retried)).toBe("Numpy là thư viện tính toán khoa học.");
    expect(attempts).toBe(2);
  });

  it("câu multianswer có mọi ô trong prompt gửi model", async () => {
    const { client, calls } = fakeClient("T2 gồm các giá trị không lặp.");
    const q031 = question("Q031");

    await collect(
      await explainQuestion({
        question: q031,
        studentAnswer: { blankValues: ["(1, 9, 1)", ""] },
        client,
      }),
    );

    for (const blank of q031.blanks) expect(calls[0]).toContain(blank.acceptedAnswer);
    expect(calls[0]).toMatch(/Ô 1/);
    expect(calls[0]).toMatch(/Ô 2/);
  });
});
