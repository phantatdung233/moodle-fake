import { readFileSync } from "node:fs";

/** Question types the platform supports (see Spec: Moodle Quiz Platform). */
export const QUESTION_TYPES = ["multichoice", "multianswer"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * The minimum of a Moodle Question this ticket needs: enough to count 180
 * Questions by type. Ticket #3 replaces this with the real parser
 * (`parseQuizJson`) that also maps options and blanks.
 */
export type MoodleQuestion = {
  id: string;
  no: number;
  type: QuestionType;
  question: string;
};

export type QuizSummary = {
  total: number;
  byType: Record<QuestionType, number>;
};

export class MoodleJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoodleJsonError";
  }
}

/** Reads and validates `moodle_quiz_merged.json` from disk. */
export function loadMoodleQuestions(filePath: string): MoodleQuestion[] {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new MoodleJsonError(`Không đọc được file ${filePath}`);
  }
  return loadMoodleQuestionsText(text);
}

/** Validates the already-parsed top-level shape of a Moodle export. */
export function loadMoodleQuestionsText(text: string): MoodleQuestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MoodleJsonError("File JSON không hợp lệ");
  }

  if (!Array.isArray(raw)) {
    throw new MoodleJsonError("File JSON phải là một mảng câu hỏi ở cấp cao nhất");
  }

  return raw.map((entry, index) => {
    const where = `Câu thứ ${index + 1}`;
    if (typeof entry !== "object" || entry === null) {
      throw new MoodleJsonError(`${where}: không phải object`);
    }
    const question = entry as Record<string, unknown>;

    if (typeof question.id !== "string" || question.id.trim() === "") {
      throw new MoodleJsonError(`${where}: thiếu id câu hỏi`);
    }
    if (!QUESTION_TYPES.includes(question.type as QuestionType)) {
      throw new MoodleJsonError(
        `${where} (${question.id}): loại câu "${String(question.type)}" không hỗ trợ`,
      );
    }

    return {
      id: question.id,
      no: typeof question.no === "number" ? question.no : index + 1,
      type: question.type as QuestionType,
      question: typeof question.question === "string" ? question.question : "",
    };
  });
}

/** Counts Questions by type for the seed summary. */
export function summarizeQuestions(questions: MoodleQuestion[]): QuizSummary {
  const byType: Record<QuestionType, number> = { multichoice: 0, multianswer: 0 };
  for (const question of questions) {
    byType[question.type] += 1;
  }
  return { total: questions.length, byType };
}
