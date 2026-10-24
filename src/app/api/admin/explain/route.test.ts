/**
 * `/api/admin/explain` — the route behind "Giải thích bằng AI" on the review
 * page. Same seam as the sinh viên route: a soft SSE error for every failure,
 * live model output only (nothing is cached), and the fake model injected through
 * `useTestExplainClient` so nothing here touches the network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";
import type { ExplainClient } from "@/lib/gemini/client";

/** The admin cookie the request carries; swapped between "browsers". */
const adminCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "admin_session" && adminCookie.value
        ? { name, value: adminCookie.value }
        : undefined,
  }),
}));

const { POST } = await import("./route");
const { useTestExplainClient } = await import("@/lib/gemini/explain");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

type Prompt = string;

/** Model calls recorded per test, so "no second call" is observable. */
let calls: Prompt[] = [];
let answer: () => string = () => "Đáp án ghi nhận cần xem lại: Numpy là thư viện tính toán.";
/** Set to a string to make the next model call fail like the SDK would. */
let failure: string | null = null;

function fakeClient(): ExplainClient {
  return {
    async *stream(prompt) {
      calls.push(prompt);
      if (failure !== null) throw failure;
      yield answer();
    },
  };
}

async function post(body: unknown): Promise<Request> {
  return new Request("http://localhost/api/admin/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const response = await POST((await post(body)) as never);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function signIn(): Promise<string> {
  const { createAdminSessionCookie } = await import("@/lib/admin/session");
  adminCookie.value = (await createAdminSessionCookie()).value;
  return adminCookie.value;
}

/** A draft Quiz with real Moodle Questions, the state the review page runs in. */
async function draftQuiz(): Promise<{ quizId: string; hash: string }> {
  const { parseQuizJson } = await import("@/lib/quiz/parser");
  const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");

  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug: "python-co-ban",
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 3),
  });
  if (!created.ok) throw new Error(created.error);

  const { getQuestionForReview } = await import("@/lib/quiz/review-repository");
  const q001 = await getQuestionForReview(created.quizId, "Q001");
  if (!q001) throw new Error("thiếu Q001");
  return { quizId: created.quizId, hash: q001.hash };
}

describe("POST /api/admin/explain", () => {
  let server: MongoMemoryServer;
  let originalKey: string | undefined;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_admin_explain_route_test");
    useTestExplainClient(() => fakeClient());
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    adminCookie.value = undefined;
    calls = [];
    failure = null;
    answer = () => "Đáp án ghi nhận cần xem lại: Numpy là thư viện tính toán.";
    // A configured deploy: the fake client replaces the SDK, the key only has
    // to be non-empty so `explainQuestion` reaches the client seam.
    originalKey ??= process.env.RIVER_API_KEY;
    process.env.RIVER_API_KEY = "test-key";
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.RIVER_API_KEY;
    else process.env.RIVER_API_KEY = originalKey;
  });

  it("không có phiên admin → frame lỗi mềm 401, không gọi model", async () => {
    const { quizId } = await draftQuiz();

    const { status, text, headers } = await callRoute({ quizId, questionId: "Q001" });

    expect(status).toBe(401);
    expect(headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("Phiên đăng nhập đã hết hạn");
    expect(text.trimEnd().endsWith('data: {"done":true}')).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("câu không có trong đề → 404 mềm", async () => {
    await signIn();
    const { quizId } = await draftQuiz();

    const { status, text } = await callRoute({ quizId, questionId: "Q999" });

    expect(status).toBe(404);
    expect(text).toContain("Không tìm thấy câu hỏi này trong đề");
    expect(calls).toHaveLength(0);
  });

  it("body hỏng → 400 mềm", async () => {
    await signIn();

    const { status, text } = await callRoute({});

    expect(status).toBe(400);
    expect(text).toContain("không hợp lệ");
  });

  it("sinh bằng model cho đúng câu đó, không kèm bài làm của sinh viên", async () => {
    await signIn();
    const { quizId } = await draftQuiz();
    answer = () => "Numpy là thư viện tính toán khoa học.";

    const { status, text, headers } = await callRoute({ quizId, questionId: "Q001" });

    expect(status).toBe(200);
    expect(headers.get("x-explain-status")).toBeNull();
    expect(text).toContain("Numpy là thư viện tính toán khoa học.");
    expect(text.trimEnd().endsWith('data: {"done":true}')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Q001");
    expect(calls[0]).not.toContain("Sinh viên chọn");
  });

  it("sinh xong không lưu lại: lần sau vẫn gọi model", async () => {
    await signIn();
    const { quizId } = await draftQuiz();
    await callRoute({ quizId, questionId: "Q001" });

    const second = await callRoute({ quizId, questionId: "Q001" });

    expect(second.text).toContain("Đáp án ghi nhận cần xem lại");
    expect(calls).toHaveLength(2);
  });

  it("model không dùng được → stream 200 với frame lỗi mềm nhắc cấu hình model", async () => {
    await signIn();
    const { quizId } = await draftQuiz();
    failure = '{"error":{"code":404,"message":"models/gemini-2.5-flash is not found"}}';

    const { status, text } = await callRoute({ quizId, questionId: "Q001" });

    // Same contract as the sinh viên route: failures after the first byte are
    // frames, so the panel renders the Vietnamese message instead of a 500.
    expect(status).toBe(200);
    expect(text).toContain("EXPLAIN_MODEL");
    expect(text).not.toMatch(/at .*route\.ts/);
  });
});
