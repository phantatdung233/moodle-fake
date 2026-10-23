/**
 * Data layer for `/admin/results` — the giảng viên's view of every Attempt:
 * the class table, the filters behind it and the per-student reset.
 *
 * Same seam as `repository.ts` and `lifecycle-repository.ts`: plain values in
 * and out (no Mongoose documents), so tests, the page, the CSV route and the
 * server action all go through one implementation.
 *
 * Attempt numbering and scores are always a *derived* read of the stored rows:
 * the table never trusts a number the browser sends, and a reset simply makes
 * the next Attempt number 1 again because the older rows are gone.
 */
import mongoose from "mongoose";
import { Attempt, type AttemptDocument, type AttemptStatus } from "@/lib/quiz/attempt.model";
import { Quiz, type QuizMode, type QuizQuestion } from "@/lib/quiz/quiz.model";
import { normalizeStudentId } from "@/lib/quiz/attempt-repository";
import { ensureConnection } from "@/lib/mongodb";

/** How many rows the table renders at once; the CSV export has no such cap. */
export const RESULTS_PAGE_SIZE = 200;

export type ResultsFilter = {
  /** Only Attempts of this Quiz. */
  quizId?: string;
  /** Exactly this MSSV, or any MSSV containing it — case-insensitive. */
  studentId?: string;
  /** Row cap for the table; defaults to RESULTS_PAGE_SIZE. */
  limit?: number;
};

/** The filter exactly as the URL carried it, so a link can rebuild it. */
export type ResultsQuery = {
  quizId: string;
  studentId: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readFilter(filter: ResultsFilter) {
  const quizId =
    filter.quizId && mongoose.isValidObjectId(filter.quizId) ? filter.quizId : undefined;
  const studentId = (filter.studentId ?? "").trim();
  const limit = filter.limit && filter.limit > 0 ? Math.floor(filter.limit) : RESULTS_PAGE_SIZE;

  const query: Record<string, unknown> = {};
  if (quizId) query.quizId = new mongoose.Types.ObjectId(quizId);
  if (studentId !== "") {
    // MSSV is stored normalised (uppercase); `i` makes the filter forgiving for
    // a giảng viên typing "b201..." by hand.
    query.studentId = { $regex: escapeRegExp(normalizeStudentId(studentId)), $options: "i" };
  }
  return { query, limit };
}

/** One Attempt as the results table and the CSV export show it. */
export type ResultRow = {
  attemptId: string;
  studentId: string;
  studentName: string;
  quizId: string;
  quizSlug: string;
  quizTitle: string;
  quizVersion: number;
  mode: QuizMode;
  /** 1 for the first Attempt of this (Quiz, MSSV), 2 for the next, by startedAt. */
  attemptNumber: number;
  status: AttemptStatus;
  /** `null` while the Attempt is still in progress (nothing graded yet). */
  scorePercent: number | null;
  startedAt: Date;
  submittedAt: Date | null;
};

export type ResultsPage = {
  rows: ResultRow[];
  /** Matched rows before the cap, so the page can say "200 of N". */
  totalRows: number;
  /** True when more rows matched than the cap allowed. */
  truncated: boolean;
  limit: number;
  /** The filter the page used, echoed back for links and the export URL. */
  query: ResultsQuery;
  /** Every Quiz, so the filter has something to choose from. */
  quizzes: { id: string; title: string; status: string }[];
};

type AttemptRow = Pick<
  AttemptDocument,
  | "studentId"
  | "studentName"
  | "quizId"
  | "quizSlug"
  | "quizVersion"
  | "mode"
  | "status"
  | "startedAt"
  | "submittedAt"
  | "result"
>;

/**
 * Attempts for the results table, newest first.
 *
 * The attempt number counts every Attempt of the same (Quiz, MSSV) that
 * started no later than this one — including finished and expired ones, since
 * an old lượt is never deleted when the sinh viên làm lại (user story 72).
 */
export async function listResults(filter: ResultsFilter = {}): Promise<ResultsPage> {
  await ensureConnection();

  const { query, limit } = readFilter(filter);

  const [totalRows, docs, quizzes] = await Promise.all([
    Attempt.countDocuments(query),
    Attempt.find(query)
      .select(
        "studentId studentName quizId quizSlug quizVersion mode status startedAt submittedAt result.total",
      )
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit)
      .lean<AttemptRow[]>(),
    Quiz.find({}).select("title status").sort({ createdAt: -1, _id: -1 }).lean(),
  ]);

  // Attempt numbers need every earlier Attempt of the same pair, including the
  // ones the cap hid; one extra query keeps the count exact for the rows shown.
  const pairs = docs.map((doc) => ({ quizId: doc.quizId, studentId: doc.studentId }));
  const attemptsByPair = await countAttemptsBefore(
    docs.map((doc) => doc.startedAt),
    pairs,
  );

  const quizTitles = new Map(quizzes.map((quiz) => [String(quiz._id), quiz.title]));

  return {
    rows: docs.map((doc, index) => ({
      attemptId: String((doc as AttemptRow & { _id: mongoose.Types.ObjectId })._id),
      studentId: doc.studentId,
      studentName: doc.studentName,
      quizId: String(doc.quizId),
      quizSlug: doc.quizSlug,
      quizTitle: quizTitles.get(String(doc.quizId)) ?? "(đề đã xoá)",
      quizVersion: doc.quizVersion,
      mode: doc.mode,
      attemptNumber: attemptsByPair[index],
      status: doc.status,
      scorePercent: doc.result?.total ?? null,
      startedAt: doc.startedAt,
      submittedAt: doc.submittedAt ?? null,
    })),
    totalRows,
    truncated: totalRows > docs.length,
    limit,
    query: {
      quizId: filter.quizId && mongoose.isValidObjectId(filter.quizId) ? filter.quizId : "",
      studentId: (filter.studentId ?? "").trim(),
    },
    quizzes: quizzes.map((quiz) => ({
      id: String(quiz._id),
      title: quiz.title,
      status: quiz.status,
    })),
  };
}

/**
 * For each (startedAt, pair) row: 1 + the number of Attempts of that pair that
 * started strictly earlier. One query per distinct Quiz boundary would be
 * slower; a single aggregate over the pairs the page shows is enough.
 */
async function countAttemptsBefore(
  startedAts: Date[],
  pairs: { quizId: mongoose.Types.ObjectId; studentId: string }[],
): Promise<number[]> {
  if (pairs.length === 0) return [];

  const quizIds = [...new Set(pairs.map((pair) => String(pair.quizId)))];
  const studentIds = [...new Set(pairs.map((pair) => pair.studentId))];
  const rows = await Attempt.find({
    quizId: { $in: quizIds.map((id) => new mongoose.Types.ObjectId(id)) },
    studentId: { $in: studentIds },
  })
    .select("quizId studentId startedAt")
    .lean<{ quizId: mongoose.Types.ObjectId; studentId: string; startedAt: Date }[]>();

  const byPair = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.quizId}|${row.studentId}`;
    const list = byPair.get(key) ?? [];
    list.push(row.startedAt.getTime());
    byPair.set(key, list);
  }
  for (const list of byPair.values()) list.sort((a, b) => a - b);

  // `_id` breaks a same-millisecond tie in the same way the table's sort does.
  return pairs.map((pair, index) => {
    const times = byPair.get(`${pair.quizId}|${pair.studentId}`) ?? [];
    const started = startedAts[index].getTime();
    return times.filter((time) => time <= started).length;
  });
}

/** Every Attempt matching the filter — what the CSV export writes. */
export async function listResultsForExport(filter: ResultsFilter = {}): Promise<ResultRow[]> {
  const page = await listResults({ ...filter, limit: Number.MAX_SAFE_INTEGER });
  return page.rows;
}

export type ResetResult = { ok: true; deletedCount: number } | { ok: false; error: string };

/**
 * "Reset lượt của em này": deletes every Attempt of one MSSV in one Quiz and
 * nothing else — other students' rows and the same student's Attempts on other
 * Quizzes stay (user story 70). Deleting an open Attempt frees the partial
 * unique index, so the sinh viên can start again.
 */
export async function resetStudentAttempts(input: {
  quizId: string;
  studentId: string;
}): Promise<ResetResult> {
  if (!mongoose.isValidObjectId(input.quizId)) {
    return { ok: false, error: "Không tìm thấy đề." };
  }
  const studentId = normalizeStudentId(input.studentId ?? "");
  if (studentId === "") {
    return { ok: false, error: "Hãy nhập MSSV cần reset." };
  }

  await ensureConnection();

  const { deletedCount } = await Attempt.deleteMany({
    quizId: new mongoose.Types.ObjectId(input.quizId),
    studentId,
  });
  if (deletedCount === 0) {
    return { ok: false, error: `Không có lượt làm nào của ${studentId} trong đề này.` };
  }
  return { ok: true, deletedCount };
}

/** One Question line on the Attempt detail page. */
export type AttemptDetailQuestion = {
  question: QuizQuestion;
  /** What the sinh viên picked / typed; empty when they skipped it. */
  selectedOptionKeys: string[];
  blankValues: string[];
  /** The stored grade for this Question, or `null` while the Attempt is open. */
  graded: { correct: boolean; score: number } | null;
  /** Cached Gemini text for this snapshot's hash; never generated here. */
  explanation: string | null;
};

export type AttemptDetail = {
  attemptId: string;
  studentId: string;
  studentName: string;
  quizId: string;
  quizSlug: string;
  quizTitle: string;
  quizVersion: number;
  mode: QuizMode;
  attemptNumber: number;
  status: AttemptStatus;
  scorePercent: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  deadline: Date | null;
  questions: AttemptDetailQuestion[];
};

/**
 * One Attempt for `/admin/results/[attemptId]`, read **from its snapshot**.
 *
 * Nothing here reads `Quiz.questions`: the paper is whatever the sinh viên
 * started, so a newer upload or a Quiz edit can never rewrite an old review.
 * Explanations come from the cache keyed by each snapshot Question's hash, so
 * the text belongs to that version too (never calls Gemini).
 */
export async function getAttemptDetail(attemptId: string): Promise<AttemptDetail | null> {
  if (!mongoose.isValidObjectId(attemptId)) return null;
  await ensureConnection();

  const doc = await Attempt.findById(attemptId).lean();
  if (!doc) return null;

  const quiz = await Quiz.findById(doc.quizId).select("title").lean();
  const attemptNumber = await Attempt.countDocuments({
    quizId: doc.quizId,
    studentId: doc.studentId,
    startedAt: { $lte: doc.startedAt },
  });
  const { getCachedExplanation } = await import("@/lib/gemini/cache");

  const gradedByQuestion = new Map(
    (doc.result?.perQuestion ?? []).map((entry) => [entry.questionId, entry]),
  );
  const answerByQuestion = new Map(doc.answers.map((answer) => [answer.questionId, answer]));

  const questions = await Promise.all(
    [...doc.questionsSnapshot]
      .sort((a, b) => a.no - b.no)
      .map(async (question) => {
        const answer = answerByQuestion.get(question.id);
        const graded = gradedByQuestion.get(question.id) ?? answer?.graded;
        return {
          question: {
            ...question,
            options: question.options.map((option) => ({ ...option })),
            blanks: question.blanks.map((blank) => ({ ...blank })),
            images: [...question.images],
          } as QuizQuestion,
          selectedOptionKeys: [...(answer?.selectedOptionKeys ?? [])],
          blankValues: [...(answer?.blankValues ?? [])],
          graded: graded ? { correct: graded.correct, score: graded.score } : null,
          explanation: await getCachedExplanation(question.hash),
        };
      }),
  );

  return {
    attemptId: String(doc._id),
    studentId: doc.studentId,
    studentName: doc.studentName,
    quizId: String(doc.quizId),
    quizSlug: doc.quizSlug,
    quizTitle: quiz?.title ?? "(đề đã xoá)",
    quizVersion: doc.quizVersion,
    mode: doc.mode,
    attemptNumber,
    status: doc.status,
    scorePercent: doc.result?.total ?? null,
    startedAt: doc.startedAt,
    submittedAt: doc.submittedAt ?? null,
    deadline: doc.deadline ?? null,
    questions,
  };
}
