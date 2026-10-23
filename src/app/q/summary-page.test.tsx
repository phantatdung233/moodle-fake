import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { STUDENT_SESSION_COOKIE } from "@/lib/student/session";
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from "@/test/mongo";

/**
 * Page-level tests for the submitted-Attempt experience. The pages are async
 * server components: awaiting them here runs their data reads for real (only
 * `cookies()` / `redirect()` / `notFound()` need a mock), so these tests check
 * what a browser would actually receive.
 */

const jar = vi.hoisted(() => ({ student: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === STUDENT_SESSION_COOKIE && jar.student ? { name, value: jar.student } : undefined,
    set: (name: string, value: string) => {
      if (name === STUDENT_SESSION_COOKIE) jar.student = value || undefined;
    },
    delete: vi.fn(),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const navigation = vi.hoisted(() => ({ redirected: null as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => {
    navigation.redirected = url;
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: SummaryPage } = await import("@/app/q/[slug]/ket-qua/page");
const { default: QuizPage } = await import("@/app/q/[slug]/page");
const { createStudentSessionCookie } = await import("@/lib/student/session");
const { beginAttempt } = await import("@/lib/student/actions");
const { parseQuizJson } = await import("@/lib/quiz/parser");
const { createDraftQuizFromQuestions } = await import("@/lib/quiz/repository");
const { archiveQuiz, publishQuiz, updateQuizSettings } = await import(
  "@/lib/quiz/lifecycle-repository"
);
const { answerQuestion, resumeOrStartAttempt, submitAttempt } = await import(
  "@/lib/quiz/attempt-repository"
);
const { Attempt } = await import("@/lib/quiz/attempt.model");

const MOODLE_FILE = path.resolve(process.cwd(), "moodle_quiz_merged.json");

async function seedPublishedQuiz(
  options: { mode?: "practice" | "exam"; slug?: string } = {},
): Promise<string> {
  const slug = options.slug ?? "python-co-ban";
  const created = await createDraftQuizFromQuestions({
    title: "Python cơ bản",
    slug,
    questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 5),
  });
  if (!created.ok) throw new Error(created.error);
  if (options.mode === "exam") {
    const saved = await updateQuizSettings(created.quizId, {
      title: "Python cơ bản",
      slug,
      mode: "exam",
      timeLimit: 20,
      maxAttempts: 1,
    });
    if (!saved.ok) throw new Error(saved.error);
  }
  const published = await publishQuiz(created.quizId);
  if (!published.ok) throw new Error(published.error);
  return created.quizId;
}

/**
 * Runs every async server component in the tree before React renders: awaiting
 * the page only returns element descriptors, whose child components still have
 * their own data reads. Client components are left for the browser (they call
 * hooks), which is why they appear as `client:<Name>` in the markup.
 */
async function resolveTree(node: unknown): Promise<unknown> {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map((entry) => resolveTree(entry)));

  const element = node as { type: unknown; props: Record<string, unknown> };
  const props = element.props ?? {};
  // React elements carry `props` as a non-enumerable property, so a plain
  // object spread would drop the children — rebuild it explicitly.
  const children = "children" in props ? await resolveTree(props.children) : props.children;
  const rebuilt = { ...element, props: { ...props, children } } as Record<string, unknown>;
  Object.setPrototypeOf(rebuilt, Object.getPrototypeOf(element));

  if (typeof element.type === "function") {
    const name = element.type.name ?? "";
    if (CLIENT_COMPONENTS.some((prefix) => name.startsWith(prefix))) {
      return { ...rebuilt, type: `client:${name}` };
    }
    return resolveTree(await (element.type as (props: unknown) => unknown)(rebuilt.props));
  }
  return rebuilt;
}

/** Client components under test: their hooks need a browser, not this renderer. */
const CLIENT_COMPONENTS = [
  "QuizRunner",
  "IdentityForm",
  "QuizLifecycleCard",
  "QuizSettingsForm",
  "QuestionSelectionList",
  "ExplanationPanel",
  "SubmitPaper",
];

function render(tree: unknown): string {
  return renderToStaticMarkup(tree as ReactElement);
}

async function signInAs(studentId: string, attemptId: string): Promise<void> {
  jar.student = (
    await createStudentSessionCookie({ studentId, attemptId }, process.env.SESSION_SECRET)
  ).value;
}

describe("summary page", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_summary_page_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.student = undefined;
    navigation.redirected = null;
    // A one-attempt exam, so the summary must hide "Làm lại".
    quizId = await seedPublishedQuiz({ mode: "exam" });
  });

  it("hiện % điểm, số đúng/sai/bỏ trống và đáp án của từng câu", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    // Q001: "e" is the correct option; Q002..Q005 stay blank.
    await answerQuestion({
      attemptId: started.attempt.id,
      studentId: "B2012345",
      questionId: "Q001",
      selectedOptionKeys: ["e"],
      blankValues: [],
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });
    await signInAs("B2012345", started.attempt.id);

    const html = render(await resolveTree(await SummaryPage({ params: Promise.resolve({ slug: "python-co-ban" }) })));

    expect(html).toContain("Điểm: 20%");
    // `<dt>` and `<dd>` are separate elements; read each count next to its label.
    expect(html).toMatch(/Tổng câu<\/dt>[\s\S]*?<dd[^>]*>5<\/dd>/);
    expect(html).toMatch(/Đúng<\/dt>[\s\S]*?<dd[^>]*>1<\/dd>/);
    expect(html).toMatch(/Sai<\/dt>[\s\S]*?<dd[^>]*>0<\/dd>/);
    expect(html).toMatch(/Bỏ trống<\/dt>[\s\S]*?<dd[^>]*>4<\/dd>/);
    expect(html).toContain("đáp án đúng");
    // One explanation panel per Question (`client:` wrapper).
    expect(html.match(/questionHash=/g)).toHaveLength(5);
  });

  it("câu đã có giải thích trong cache hiện sẵn trên trang tổng kết, không chờ Gemini", async () => {
    const { saveExplanation } = await import("@/lib/gemini/cache");
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    const q001 = started.attempt.questionsSnapshot.find((question) => question.id === "Q001")!;
    await saveExplanation({
      questionHash: q001.hash,
      questionId: "Q001",
      text: "In ra e vì biến e được gán trước khi gọi print.",
    });
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });
    await signInAs("B2012345", started.attempt.id);

    const html = render(await resolveTree(await SummaryPage({ params: Promise.resolve({ slug: "python-co-ban" }) })));
    // The stored text travels in the panel's initialText, not in an empty shell.
    expect(html).toContain("In ra e vì biến e được gán trước khi gọi print.");
    expect(html).toContain("initialText");
  });

  it("đề luyện tập cho làm lại ngay trên trang tổng kết", async () => {
    const practiceId = await seedPublishedQuiz({ slug: "luyen-tap" });
    quizId = practiceId;
    const started = await resumeOrStartAttempt({ quizId: practiceId, studentId: "B9", studentName: "Bình" });
    if (!started.ok) throw new Error(started.error);
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B9" });
    await signInAs("B9", started.attempt.id);

    const html = render(
      await resolveTree(await SummaryPage({ params: Promise.resolve({ slug: "luyen-tap" }) })),
    );

    expect(html).toContain("Làm lại");
  });

  it("không hiện bài của sinh viên khác", async () => {
    const theirs = await resumeOrStartAttempt({ quizId, studentId: "B9999999", studentName: "Bình" });
    if (!theirs.ok) throw new Error(theirs.error);
    await submitAttempt({ attemptId: theirs.attempt.id, studentId: "B9999999" });

    // This browser has no identity at all.
    const anonymous = render(
      await resolveTree(await SummaryPage({ params: Promise.resolve({ slug: "python-co-ban" }) })),
    );
    expect(anonymous).toContain("Chưa có bài nào đã nộp");
    expect(anonymous).not.toContain("B9999999");
  });

  it("đề đã lưu trữ vẫn xem lại được kết quả cũ nhưng không mở lượt mới", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B2012345", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B2012345" });
    await signInAs("B2012345", started.attempt.id);
    await archiveQuiz(quizId);

    const html = render(
      await resolveTree(await SummaryPage({ params: Promise.resolve({ slug: "python-co-ban" }) })),
    );

    expect(html).toContain("Điểm: 0%");
    expect(html).not.toContain("Làm lại");
  });

  it("đề nháp không mở được cho sinh viên", async () => {
    const draft = await createDraftQuizFromQuestions({
      title: "Nháp",
      slug: "de-nhap",
      questions: parseQuizJson(JSON.parse(readFileSync(MOODLE_FILE, "utf8"))).questions.slice(0, 2),
    });
    if (!draft.ok) throw new Error(draft.error);

    await expect(QuizPage({ params: Promise.resolve({ slug: "de-nhap" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});

describe("quiz page after submitting", () => {
  let server: MongoMemoryServer;
  let quizId: string;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_quiz_page_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });
  beforeEach(async () => {
    await clearTestDatabase();
    jar.student = undefined;
    navigation.redirected = null;
    // A one-attempt exam, so the summary must hide "Làm lại".
    quizId = await seedPublishedQuiz({ mode: "exam" });
  });

  it("chuyển sang trang tổng kết khi bài đã nộp", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });
    await signInAs("B1", started.attempt.id);

    await expect(QuizPage({ params: Promise.resolve({ slug: "python-co-ban" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirected).toBe("/q/python-co-ban/ket-qua");
  });

  it("bài quá hạn được tự nộp khi mở lại trang, không trả lại bài đang làm", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await Attempt.updateOne(
      { _id: started.attempt.id },
      { $set: { deadline: new Date(Date.now() - 1000) } },
    );
    await signInAs("B1", started.attempt.id);

    await expect(QuizPage({ params: Promise.resolve({ slug: "python-co-ban" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirected).toBe("/q/python-co-ban/ket-qua");
    expect((await Attempt.findById(started.attempt.id).lean())?.status).toBe("expired");
  });

  it("không cho lượt làm mới khi đã hết maxAttempts", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await signInAs("B1", started.attempt.id);
    const submitted = await submitAttempt({ attemptId: started.attempt.id, studentId: "B1" });
    if (!submitted.ok) throw new Error(submitted.error);

    // Opening the Quiz again lands on the finished Attempt's summary.
    await expect(QuizPage({ params: Promise.resolve({ slug: "python-co-ban" }) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(navigation.redirected).toBe("/q/python-co-ban/ket-qua");

    // Signing in is what the limit refuses — with the count in the message.
    expect(await beginAttempt({ slug: "python-co-ban", studentId: "B1", studentName: "An" })).toEqual({
      ok: false,
      error: "Bạn đã hết 1 lần làm đề này.",
    });
  });

  it("câu đã xem đáp án ở lượt đang làm nhận sẵn giải thích từ cache", async () => {
    const practiceId = await seedPublishedQuiz({ slug: "luyen-tap" });
    const started = await resumeOrStartAttempt({ quizId: practiceId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    const q001 = started.attempt.questionsSnapshot.find((question) => question.id === "Q001")!;
    const questionHash = q001.hash;
    const { saveExplanation } = await import("@/lib/gemini/cache");
    await saveExplanation({ questionHash, questionId: "Q001", text: "Giải thích đã có sẵn." });
    await signInAs("B1", started.attempt.id);

    const { loadAttempt } = await import("@/lib/student/actions");
    const attempt = await loadAttempt({ slug: "luyen-tap" });

    // The runner reads `initialText` from this map, so a revealed Question
    // opens with the stored text instead of an empty panel.
    expect(attempt?.explanationsByHash?.[questionHash]).toBe("Giải thích đã có sẵn.");
  });

  it("bài đang làm dở vẫn mở màn hình làm bài, không chuyển trang", async () => {
    const started = await resumeOrStartAttempt({ quizId, studentId: "B1", studentName: "An" });
    if (!started.ok) throw new Error(started.error);
    await signInAs("B1", started.attempt.id);

    const page = await QuizPage({ params: Promise.resolve({ slug: "python-co-ban" }) });

    expect(navigation.redirected).toBeNull();
    expect(page).toBeTruthy();
  });
});
