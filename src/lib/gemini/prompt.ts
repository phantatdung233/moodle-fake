/**
 * Dựng prompt giải thích cho Gemini — hàm thuần, không DB/HTTP.
 *
 * Đây là seam được test thay cho việc gọi API thật (Spec, "Testing Decisions"):
 * mọi dữ kiện mà Gemini cần (nội dung câu, lựa chọn, đáp án ghi nhận, câu trả
 * lời của sinh viên, từng ô trống) đều phải có trong chuỗi trả về.
 */
import type { QuizQuestion } from "@/lib/quiz/quiz.model";

export type ExplanationRequest = {
  question: QuizQuestion;
  /** What the sinh viên answered; missing/malformed reads as an empty answer. */
  studentAnswer?: { selectedOptionKeys?: readonly string[]; blankValues?: readonly string[] };
};

/** Passed as `contents` to Gemini, by itself: the prompt is self-contained. */
export function buildExplanationPrompt(request: ExplanationRequest): string {
  const { question } = request;
  const selected = new Set(request.studentAnswer?.selectedOptionKeys ?? []);
  const lines: string[] = [];

  lines.push(
    "Bạn là giảng viên Python đang chữa bài trắc nghiệm cho sinh viên Việt Nam.",
    `Câu hỏi ${question.id}:`,
    question.content,
    "",
  );

  if (question.type === "multianswer") {
    lines.push("Đây là câu điền khuyết. Đáp án đúng ghi nhận trong đề và bài làm từng ô:");
    const blankValues = request.studentAnswer?.blankValues ?? [];
    question.blanks.forEach((blank, index) => {
      const typed = (blankValues[index] ?? "").trim();
      lines.push(
        `- Ô ${index + 1} (${blank.name}): đáp án đúng ghi nhận là \`${blank.acceptedAnswer}\`; ` +
          `sinh viên ${typed === "" ? "chưa điền" : `gõ \`${typed}\``}.`,
      );
    });
    lines.push("");
    lines.push(
      "Hãy giải thích cho cả câu: mỗi ô cần điền gì, vì sao, và chỉ ra ô nào sinh viên làm sai.",
    );
  } else {
    lines.push("Các lựa chọn của câu:");
    for (const option of question.options) {
      lines.push(`- "${option.key}": ${option.text}${option.correct ? " (ghi nhận là đúng)" : ""}`);
    }
    const correctKeys = question.options
      .filter((option) => option.correct)
      .map((option) => option.key);
    lines.push("");
    lines.push(
      correctKeys.length > 0
        ? `Đáp án đúng ghi nhận trong đề: "${correctKeys.join('", "')}".`
        : "Đề chưa ghi nhận đáp án đúng nào.",
    );
    lines.push(
      selected.size > 0
        ? `Sinh viên chọn: "${[...selected].join('", "')}".`
        : "Sinh viên chưa chọn đáp án nào (để trống).",
    );
  }

  lines.push(
    "",
    "Viết giải thích cho sinh viên, tuân thủ:",
    "- Trả lời bằng tiếng Việt, ngắn gọn (khoảng 2–4 câu), đi thẳng vào trọng tâm.",
    "- Giải thích vì sao đáp án của sinh viên đúng hay sai, và vì sao đáp án đúng là đúng.",
    "- Nếu đáp án đúng ghi nhận trong đề sai kiến thức Python, hãy nói thẳng điều đó và " +
      "cho biết đáp án đúng theo kiến thức là gì; đừng bênh đáp án sai để sinh viên không học sai.",
    "- Không nhắc lại toàn bộ đề bài; chỉ chữa bài.",
  );

  return lines.join("\n");
}
