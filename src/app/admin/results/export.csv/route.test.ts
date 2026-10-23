/**
 * Seam: `GET /admin/results/export.csv` as the admin's browser sees it — the
 * response headers Excel depends on and the body it opens. Session is the only
 * thing mocked (it is a cookie), the rows come from the real database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { ADMIN_SESSION_COOKIE, createAdminSessionCookie } from "@/lib/admin/session";
import { parseQuizJson } from "@/lib/quiz/parser";
import { createDraftQuizFromQuestions } from "@/lib/quiz/repository";
import { publishQuiz } from "@/lib/quiz/lifecycle-repository";
import { answerQuestion, resumeOrStartAttempt, submitAttempt } from "@/lib/quiz/attempt-repository";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

const jar = vi.hoisted(() => ({ admin: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ADMIN_SESSION_COOKIE && jar.admin ? { name, value: jar.admin } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

const { GET } = await import("@/app/admin/results/export.csv/route");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedPublishedQuiz(slug: string, title: string): Promise<string> {
  const created = await createDraftQuizFromQuestions({
    title,
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 3),
  });
  if (!created.ok) throw new Error(created.error);
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

async function takeAttempt(quizId: string, studentId: string, studentName: string): Promise<void> {
  const started = await resumeOrStartAttempt({ quizId, studentId, studentName });
  if (!started.ok) throw new Error(started.error);
  await answerQuestion({
    attemptId: started.attempt.id,
    studentId,
    questionId: "Q001",
    selectedOptionKeys: ["e"],
    blankValues: [],
  });
  await submitAttempt({ attemptId: started.attempt.id, studentId });
}

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/admin/results/export.csv${query}`);
}

describe("GET /admin/results/export.csv", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_results_csv_route_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.admin = undefined;
  });

  it("từ chối khi chưa đăng nhập admin", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("MSSV");
  });

  it("trả file CSV có BOM UTF-8, đúng content-type và tên file", async () => {
    const quizId = await seedPublishedQuiz("python-co-ban", "Python cơ bản");
    await takeAttempt(quizId, "B2012345", "An");
    jar.admin = (await createAdminSessionCookie()).value;

    const response = await GET(request(`?quizId=${quizId}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="ket-qua-python-co-ban-' +
        new Date().toISOString().slice(0, 10) +
        '.csv"',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes.slice(3));
    expect(body.startsWith("MSSV,Họ tên,Đề,Lượt,Điểm (%),Trạng thái,Bắt đầu,Nộp bài\r\n")).toBe(true);
    expect(body).toContain("B2012345");
  });

  it("áp dụng bộ lọc từ query string giống bảng kết quả", async () => {
    const quizId = await seedPublishedQuiz("python-co-ban", "Python cơ bản");
    const otherQuizId = await seedPublishedQuiz("de-khac", "Đề khác");
    await takeAttempt(quizId, "B2012345", "An");
    await takeAttempt(otherQuizId, "B9999999", "Bình");
    jar.admin = (await createAdminSessionCookie()).value;

    const body = await (await GET(request(`?quizId=${otherQuizId}&studentId=9999`))).text();

    expect(body).toContain("B9999999");
    expect(body).not.toContain("B2012345");
  });
});
