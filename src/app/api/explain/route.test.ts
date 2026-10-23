import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/** The student cookie the request carries; swapped between "browsers". */
const studentCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "student_session" && studentCookie.value
        ? { name, value: studentCookie.value }
        : undefined,
  }),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://localhost/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown, cookie?: string) {
  studentCookie.value = cookie;  const response = await POST(post(body) as never);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function signIn(studentId: string, attemptId: string): Promise<string> {
  const { createStudentSessionCookie } = await import("@/lib/student/session");
  return (
    await createStudentSessionCookie({ studentId, attemptId }, process.env.SESSION_SECRET)
  ).value;
}

async function startAttempt(studentId: string) {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { parseQuizJson } = await import("@/lib/quiz/parser");
  const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
  const { resumeOrStartAttempt } = await import("@/lib/quiz/attempt-repository");

  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: `de-${studentId.toLowerCase()}`,
    questions: parseQuizJson(
      JSON.parse(readFileSync(resolve(process.cwd(), "moodle_quiz_merged.json"), "utf8")),
    ).questions,
  });
  if (!created.ok) throw new Error(created.error);
  const { transitionToStatus } = await import("@/lib/admin/test-helpers");
  await transitionToStatus(created.quizId, "published");
  const started = await resumeOrStartAttempt({
    quizId: created.quizId,
    studentId,
    studentName: "Sinh viên Test",
  });
  if (!started.ok) throw new Error(started.error);
  return started.attempt;
}

describe("POST /api/explain", () => {
  let server: MongoMemoryServer;
  let originalKey: string | undefined;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_explain_route_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    studentCookie.value = undefined;
    // Same shape as an unconfigured deploy: the variable exists but is empty.
    // Deleting it outright would also wipe SESSION_SECRET's setup-env run order.
    originalKey ??= process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "";
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it("không có cookie sinh viên → frame lỗi mềm, không phải 500", async () => {
    const { status, text } = await callRoute({ questionId: "Q144" });

    expect(status).toBe(401);
    expect(text).toContain("data:");
    expect(text).toContain("MSSV");
    expect(text).not.toMatch(/at .*route\.ts/);
  });

  it("body hỏng → 400 với frame lỗi tiếng Việt", async () => {
    const attempt = await startAttempt("B3000001");
    const cookie = await signIn("B3000001", attempt.id);

    const { status, text } = await callRoute({}, cookie);

    expect(status).toBe(400);
    expect(text).toContain("không hợp lệ");
  });

  it("câu không có trong bài → 404 mềm", async () => {
    const attempt = await startAttempt("B3000002");
    const cookie = await signIn("B3000002", attempt.id);

    const { status, text } = await callRoute({ questionId: "Q999" }, cookie);

    expect(status).toBe(404);
    expect(text).toContain("Không tìm thấy câu hỏi");
  });

  it("không có GEMINI_API_KEY → stream vẫn 200 với frame 'Chưa cấu hình Gemini' và frame kết thúc", async () => {
    const attempt = await startAttempt("B3000003");
    const cookie = await signIn("B3000003", attempt.id);

    const { status, text, headers } = await callRoute({ questionId: "Q144" }, cookie);

    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("text/event-stream");
    expect(headers.get("x-explain-status")).toBe("soft-error");
    expect(text).toContain('"error":"Chưa cấu hình Gemini"');
    expect(text.trimEnd().endsWith('data: {"done":true}')).toBe(true);
  });

  it("hash cũ (trang đã stale) → 409 để panel nhắc tải lại", async () => {
    const attempt = await startAttempt("B3000004");
    const cookie = await signIn("B3000004", attempt.id);

    const { status, text } = await callRoute({ questionId: "Q144", questionHash: "hash-cu" }, cookie);

    expect(status).toBe(409);
    expect(text).toContain("Tải lại trang");
  });

  it("cookie của sinh viên khác không đọc được giải thích của Attempt này", async () => {
    const attempt = await startAttempt("B3000005");
    const cookie = await signIn("B8888888", attempt.id);

    const { status } = await callRoute({ questionId: "Q144" }, cookie);

    expect(status).toBe(404);
  });

  it("cache có sẵn → trả nguyên văn giải thích, không cần key", async () => {
    const attempt = await startAttempt("B3000006");
    const cookie = await signIn("B3000006", attempt.id);
    const { saveExplanation } = await import("@/lib/gemini/cache");
    const q144 = attempt.questionsSnapshot.find((question) => question.id === "Q144");
    if (!q144) throw new Error("thiếu Q144");
    await saveExplanation({
      questionHash: q144.hash,
      questionId: "Q144",
      text: "Đáp án ghi nhận trong đề sai kiến thức: Numpy là thư viện tính toán khoa học.",
    });

    const { status, text, headers } = await callRoute({ questionId: "Q144", questionHash: q144.hash }, cookie);

    expect(status).toBe(200);
    expect(headers.get("x-explain-status")).toBeNull();
    expect(text).toContain("Đáp án ghi nhận trong đề sai kiến thức");
    expect(text).toContain('"done":true');
  });
});
