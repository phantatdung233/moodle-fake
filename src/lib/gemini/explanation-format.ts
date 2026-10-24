/**
 * Một shape trả lời duy nhất cho mọi giải thích AI, và bộ chuẩn hoá đưa
 * những câu trả lời cũ/không đúng shape về shape đó.
 *
 * Model (và người viết prompt) hiếm khi trả cùng một kiểu: khi thì một đoạn
 * văn, khi thì `**e**` / `"d"` / `` `sort()` `` trong nhãn, khi thì lời chào,
 * tiêu đề `###`, danh sách, công thức `$…$`, bảng. Panel hiện nguyên văn nên mỗi
 * câu lại ra một dáng khác nhau. Từ đây mọi giải thích — mới sinh, đọc từ cache,
 * hay admin sửa tay — đều được chuẩn hoá về:
 *
 *   **Kết quả:** em chọn "d" — sai. Đáp án đúng là "e".
 *   <một đoạn giải thích, markdown tối giản: **in đậm**, `code`, "- " gạch đầu dòng>
 *
 * Chỉ là văn bản (không phải JSON): stream từng chunk vẫn hiện dần, và dữ liệu
 * cũ đang nằm trong cache vẫn đọc được ngay mà không cần sinh lại.
 */

/** Nhãn của dòng mở đầu, cố định để mọi câu trả lời trông giống nhau. */
export const EXPLANATION_VERDICT_LABEL = "Kết quả:";

/**
 * Ranh giới giữa dòng kết quả và phần giải thích. Cố định để prompt có thể
 * yêu cầu model ngắt dòng đúng chỗ và phần UI/tách dòng dựa vào nó.
 */
export const EXPLANATION_BODY_MARKER = "Giải thích:";

/** Kết quả đã lưu — dùng cho ghi chú về dữ liệu cũ. */
export const LEGACY_EXPLANATION_NOTE =
  "Giải thích này được lưu trước khi thống nhất định dạng — nội dung vẫn đúng, chỉ khác cách trình bày.";

const MAX_BODY_WORDS = 220;

/**
 * "… vì `range` giảm dần" — the reason after a causal link. The lookarounds keep
 * it apart from "vìa"/"vị" and friends, which `\b` cannot do for Vietnamese.
 * The link itself is the first capture, the reason the second.
 */
const REASON_IN = /\s((?<!\p{L})(?:vì|do|nên)(?!\p{L}))\s(\S[\s\S]*)$/iu;

// ─── Kết quả ────────────────────────────────────────────────────────────────

export type ExplanationVerdict = {
  /**
   * `correct` / `wrong`: what the sinh viên did relative to the recorded answer.
   * `blank`: nothing answered. `unknown`: the model said nothing usable, so only
   * the record sentence is shown.
   */
  kind: "correct" | "wrong" | "blank" | "unknown";
  /** `"d"` for one option, `["Ô 1", "Ô 2"]` for filled blanks, `null` if unknown. */
  chosen: string[] | null;
  /** `"e"` or the accepted answers of the blanks; `null` when the Quiz records none. */
  correct: string[] | null;
  /** The model says the recorded answer is wrong Python; the body explains why. */
  recordedAnswerDisputed: boolean;
};

/** One line, without the label: `em chọn "d" — sai. Đáp án đúng là "e".` */
export function formatVerdict(verdict: ExplanationVerdict): string {
  const chosen = verdict.chosen && verdict.chosen.length > 0 ? verdict.chosen : null;
  const correct = verdict.correct && verdict.correct.length > 0 ? verdict.correct : null;

  const choice =
    chosen === null
      ? "bỏ trống"
      : chosen.length === 1
        ? `chọn "${chosen[0]}"`
        : `điền ${chosen.join(", ")}`;

  const outcome =
    verdict.kind === "correct"
      ? "— đúng"
      : verdict.kind === "wrong"
        ? "— sai"
        : verdict.kind === "blank"
          ? "— chưa trả lời"
          : "";

  // A disputed recorded answer is never presented as "the correct answer".
  const answer =
    correct === null || verdict.recordedAnswerDisputed
      ? "Đề chưa ghi nhận đáp án đúng."
      : correct.length === 1
        ? `Đáp án đúng là "${correct[0]}".`
        : `Đáp án đúng: ${correct.join(", ")}.`;

  const dispute = verdict.recordedAnswerDisputed
    ? " Đề ghi nhận sai kiến thức — xem giải thích."
    : "";

  const head = `em ${choice}${outcome ? ` ${outcome}` : ""}.`;
  return `${head} ${answer}${dispute}`;
}

/** The label is bold, the sentence plain — one look for every explanation. */
function boldVerdict(line: string): string {
  return line.startsWith(EXPLANATION_VERDICT_LABEL)
    ? `**${EXPLANATION_VERDICT_LABEL}**${line.slice(EXPLANATION_VERDICT_LABEL.length)}`
    : `**${EXPLANATION_VERDICT_LABEL}** ${line}`;
}

// ─── Chuẩn hoá ──────────────────────────────────────────────────────────────

/** What the panel knows about the Question, for a verdict the text does not spell out. */
export type ExplanationContext = {
  /** Option keys the sinh viên selected (multichoice). */
  selectedOptionKeys?: readonly string[];
  /** Values typed into the blanks, in `blankNames` order (multianswer). */
  blankValues?: readonly string[];
  /** The Question's blanks, to label filled ones "Ô 1"… */
  blankNames?: readonly string[];
  /** Option keys / accepted answers the Quiz records as correct. */
  correctOptionKeys?: readonly string[];
  correctBlankAnswers?: readonly string[];
};

/** The fixed layout, ready to render. */
export type ExplanationSections = {
  verdict: string;
  /** Markdown; empty when the model wrote nothing beyond the verdict. */
  body: string;
  /** True for answers stored before the format existed (or not in it). */
  legacy: boolean;
};

const VERDICT_LINE = /^\*\*Kết quả:\*\*\s*(.*)$/;
/** The separator line alone, on its own. */
const EXPLANATION_BODY_MARKER_RE = /^\s*(?:Giải thích|Explanation)\s*:?\s*$/gim;
const GREETING =
  /^\s*(?:chào (?:em|bạn|bạn nhé|em nhé)|xin chào|dạ vâng|vâng)[\s,!.]/i;

const FENCE = /^\s*(```|~~~)/;

/** Only these inline marks are kept; anything else that looked like markup is text. */
function tidyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "**$1**")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, "**$1**")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** `### Vì sao sai` → `Vì sao sai`; the body uses bold lead-ins, never headings. */
/** "Dưới đây là giải thích chi tiết:" — the panel already has that title. */
const CHATTER_OPENER =
  /^\s*(?:dưới đây là|sau đây là|để (?:giải thích|trả lời)|hãy|bài làm|về câu này)\b[^.!:]{0,60}:?\s*$/iu;

function dropHeading(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    // `:?` is optional, so it guards only that last colon; earlier ones stay.
    .replace(/^\*\*(.+?):?\*\*\s*$/, "**$1:**")
    // "**Giải thích::**" — the model's own stray colon stays outside the bold.
    .replace(/\*\*:+/g, "**:")
    .trim();
}

/**
 * Drops the model's conversational wrapper — greeting, "here is the
 * explanation", a bare conclusion heading — because the panel already has a
 * title and the verdict line. Returns the body prose only.
 */
export function cleanBody(body: string): string {
  const kept: string[] = [];
  let inFence = false;

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    let line = rawLine.trimEnd();

    if (FENCE.test(line)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (inFence) {
      kept.push(line);
      continue;
    }

    if (line.trim() === "") {
      // Collapse runs of blank lines; drop leading ones.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }

    if (GREETING.test(line)) {
      // "Chào em, đáp án đúng là …" keeps its sentence, only the greeting goes.
      const rest = line.replace(/^\s*(?:chào (?:em|bạn)|xin chào|dạ vâng|vâng)[\s,!.]*/i, "");
      if (rest.trim() === "") continue;
      kept.push(tidyInline(rest));
      continue;
    }

    if (CHATTER_OPENER.test(line)) continue;
    // "Dưới đây là giải thích chi tiết:" glued in front of the real content.
    const unopened = line
      .replace(
        /^\s*(?:dưới đây là|sau đây là)\s+(?:giải thích|lời giải|phân tích)(?:[^.\n:]{0,20})?:\s*/iu,
        "",
      )
      .trimStart();
    if (unopened !== line) {
      if (unopened === "") continue;
      line = unopened;
    }
    // "**Giải thích:** Đề yêu cầu …" on one line: the heading goes, the sentence stays.
    if (/^\*{0,2}(?:giải thích|kết luận|lời giải)(?: chi tiết)?\s*:\*{0,2}\s*\S/iu.test(line)) {
      kept.push(tidyInline(line.replace(/^\*{0,2}(?:giải thích|kết luận|lời giải)(?: chi tiết)?\s*:\*{0,2}\s*/iu, "")));
      continue;
    }

    const heading = dropHeading(line);
    // A heading that is just "Giải thích" / "Kết luận" adds nothing — whether it
    // was `### Giải thích` or a bold line "**Giải thích chi tiết:**".
    if (/^\*{0,2}(?:giải thích|kết luận|đáp án|lời giải)(?: chi tiết)?\s*:?\*{0,2}\s*$/iu.test(heading)) {
      continue;
    }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      // A list item keeps its own line, so a bullet renders as a bullet. Its text
      // is otherwise left as written: a code span like `3**4` must not be read
      // as bold. The one exception is the model's "* " bullet, which is "- " here.
      kept.push(line.replace(/^\s*\*\s+/, "- ").trimEnd());
      continue;
    }
    kept.push(heading === line ? line.trimEnd() : tidyInline(heading));
  }

  // Trim trailing blanks.
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n").trim();
}

/** `$1 + 9 + 1$` → `` `1 + 9 + 1` `` so the renderer shows it as code, not raw TeX. */
function tidyMath(text: string): string {
  return text.replace(/\$([^$\n]+)\$/g, (_, inner: string) => `\`${inner.trim()}\``);
}

/**
 * The bullets or paragraphs the model wrote about each blank ("Ô 1: …"). Nil when
 * the text never mentions a numbered blank, when it is a single short paragraph
 * (that is already compact), or when it is all code.
 */
function bodyOf(text: string): string {
  const tidy = tidyMath(cleanBody(text)).replace(/\n{3,}/g, "\n\n");
  const words = tidy.split(/\s+/).filter(Boolean).length;
  if (words <= MAX_BODY_WORDS) return tidy;
  // Even a long answer is not truncated: cutting a sentence is worse than length.
  return tidy;
}

/** "d", "e, f", "Ô 1", `"a" và "b"` → the keys / labels the verdict names. */
function verdictItems(value: string | null): string[] | null {
  if (value === null) return null;
  const items = value
    .split(/[,;/]|\bvà\b|\bvới\b/g)
    .map((item) => item.replace(/[`*"'“”‘’.]/g, "").trim())
    .filter((item) => item !== "");
  return items.length > 0 ? items : null;
}

/**
 * Pulls `chosen` / `correct` / correctness out of the model's own wording.
 *
 * Order matters: what the sinh viên picked is read from the "chọn" phrasing
 * first ("Vì em chưa chọn đáp án nên …" is a rationale, not an extra claim), and
 * a filled option beats a "chưa chọn" clause that merely explains the reason.
 */
function parseClaims(text: string): Partial<ExplanationVerdict> {
  const claims: Partial<ExplanationVerdict> = {};

  if (/(?<!\p{L})sai kiến thức/iu.test(text)) {
    claims.recordedAnswerDisputed = true;
  }

  // "Đáp án đúng là **e**" / "đáp án chính xác là "a"". A sentence about the chosen
  // option ("lựa chọn **d** … là sai") never names the recorded answer.
  const correct =
    /(?:đáp án (?:đúng|chính xác)(?: của (?:câu này|đề))? là)\s*\*\*\s*"?([a-z0-9]+)"?/i.exec(text)?.[1] ??
    /(?:đáp án (?:đúng|chính xác)(?: của (?:câu này|đề))? là)\s+"([a-z0-9]+)"/i.exec(text)?.[1] ??
    // "đáp án ghi nhận trong đề (**b. 3**) là **chính xác**"
    /đáp án ghi nhận[^.\n]{0,20}\(\*\*([a-z0-9]+)[^*]*\*\*\)[^.\n]{0,20}(?:chính xác|đúng)/i.exec(
      text,
    )?.[1] ??
    // "Đáp án **a** trong đề là **chính xác**" / "Đáp án **"c"** của đề bài là **chính xác**"
    /đáp án\s*\*{1,2}\s*"?([a-z0-9]+)"?[^*\n]{0,4}\*{1,2}[^.\n]{0,40}(?:chính xác|đúng)/i.exec(text)?.[1] ??
    // "Đáp án **"c"** của đề bài là **chính xác**."
    /đáp án\s*\*{1,2}\s*"([a-z0-9]+)"\s*\*{1,2}[^.\n]{0,40}(?<!\p{L})chính xác(?![\p{L}])/iu.exec(text)?.[1] ??
    /đáp án\s*\*{1,2}\s*([a-z0-9]+)\s*\*{1,2}[^.\n]{0,40}(?<!\p{L})chính xác(?![\p{L}])/iu.exec(
      text,
    )?.[1] ??
    // Fill-in-the-blank: "Đáp án đúng của ô [1] là `def my_function()`" / "… cần điền vào Ô 1 là `else:`"
    /(?:đáp án(?: đúng)?|cần điền)[^.\n]{0,40}(?:ô\s*\[?(\d+)\]?)[^.\n]{0,20}(?:là)\s*\*{0,2}\s*`([^`]+)`/i.exec(
      text,
    );
  const blankAnswer = correct && typeof correct === "object" ? correct[2] : undefined;
  const correctKey = correct && typeof correct === "object" ? correct[1] : correct;
  const correctItems = blankAnswer
    ? [blankAnswer.trim()]
    : verdictItems((correctKey as string | undefined) ?? null);
  if (correctItems) claims.correct = correctItems;

  const chosen =
    /(?:lựa chọn|đáp án đúng)\s*\*\*\s*"?([a-z0-9]+)"?/i.exec(text)?.[1] ??
    /(?:lựa chọn|(?:em|bạn)(?: đã)? chọn|chọn)\s+"([a-z0-9]+)"/i.exec(text)?.[1];
  const chosenItems = verdictItems(chosen ?? null);
  if (chosenItems) claims.chosen = chosenItems;

  // Measured on the opening sentences only: "… sai vì em chưa chọn kỹ" talks
  // about the reason, not about a second, blank answer. `\b` is unreliable for
  // Vietnamese in Unicode mode, hence the lookarounds.
  const opening = text.split("\n")[0] ?? "";
  const saysBlank =
    // "(Em / bài này) chưa chọn / chưa trả lời / bỏ trống … (lựa chọn / đáp án / ô)"
    /(?<!\p{L})(?:chưa (?:chọn|trả lời|điền|đưa ra|điền vào)|bỏ trống|để trống|không (?:chọn|trả lời))[^.\n]{0,60}(?:lựa chọn|câu trả lời|đáp án|ô)/iu.test(
      opening,
    );
  // A recorded answer the model calls wrong is a dispute to raise, not a grade
  // (Q002, Q020: the model said the đề itself was wrong). "Đúng" at most says the
  // recorded answer is flawed, never that the sinh viên got it right.
  const recordedAnswerWrong = claims.recordedAnswerDisputed === true;
  if (saysBlank) {
    claims.chosen = null;
    claims.kind = "blank";
  } else if (claims.chosen && claims.chosen.length > 0) {
    // A wrong recorded answer never makes the sinh viên right (Q002, Q020).
    claims.kind =
      /(?<!\p{L})sai(?![\p{L}])(?![^.\n]{0,20}kiến thức)/iu.test(text) || recordedAnswerWrong
        ? "wrong"
        : "correct";
  } else if (/(?:lựa chọn|chọn|đáp án|câu trả lời)[^.\n]{0,30}(?<!\p{L})sai(?![\p{L}])/iu.test(text)) {
    claims.kind = "wrong";
  } else if (
    /(?:lựa chọn|chọn|đáp án|câu trả lời|điền)[^.\n]{0,30}(?<!\p{L})(?:đúng|chính xác)(?![\p{L}])/iu.test(
      text,
    )
  ) {
    claims.kind = "correct";
  }

  return claims;
}

/** "chào em," glued in front of the real sentence is removed; the sentence stays. */
function stripGreeting(text: string): string {
  return text.replace(/^\s*(?:chào (?:em|bạn)|xin chào|dạ vâng|vâng)\s*[,!.]*\s*/i, "").trim();
}

/**
 * A sentence that only restates the verdict: it is about the answer ("đáp án",
 * "chọn", "chưa điền") and states an outcome ("đúng", "sai", "chính xác",
 * "chưa có điểm"), as opposed to a sentence about the code itself.
 */
function isAnswerSentence(text: string): boolean {
  // `\b` is useless for Vietnamese in Unicode mode ("á" is a word character),
  // so the boundaries are written as "not a letter/digit next to it".
  const answer =
    /(?<!\p{L})(?:đáp án|câu này đáp án|chọn|câu trả lời|bỏ trống|chưa (?:chọn|trả lời|điền)|điểm)(?!\p{L})/iu;
  const outcome = /(?<!\p{L})(?:đúng|sai|chính xác|bỏ trống|chưa (?:chọn|trả lời|điền)|điểm)(?!\p{L})/iu;
  // "Chưa nhận được điểm." on its own is the same chatter without naming the answer.
  const scoreOnly =
    /^(?:(?:em|bạn) )?(?:chưa (?:nhận được|được|có) điểm|bị mất điểm|mất điểm)/iu;
  // The filled answer itself ("Đáp án đúng cần điền vào **Ô 1** là `…`") repeats
  // the verdict line too, so it is not an explanation sentence.
  const statesFilledAnswer =
    // "Đáp án đúng là `x`" names the answer; "… để thêm một phần tử … là `x`"
    // is explaining, so the answer noun has to be the subject of "là".
    /(?<!\p{L})(?:đáp án|ô\s*\[?\d+\]?)(?:[^`\n]{0,40})?\s(?:là|chính là)\s*\*{0,2}\s*`[^`]+`/iu.test(
      text,
    ) && /(?<!\p{L})(?:đáp án|ô)(?![\p{L}])/iu.test(text);
  // "Đáp án **"c"** của đề bài là **chính xác**." — the answer is stated as
  // correct without the words "đúng"/"sai" next to a noun the patterns above know.
  const statesRecordedAnswer = statesAnswerAsCorrect(text);
  // "Câu này em chưa đưa ra lựa chọn." names no answer/outcome word, only the blank.
  const statesBlank =
    /(?<!\p{L})(?:chưa (?:chọn|trả lời|điền)|bỏ trống|để trống|không chọn)(?![\p{L}])/iu.test(text);
  return (
    (answer.test(text) && outcome.test(text)) ||
    scoreOnly.test(text) ||
    statesFilledAnswer ||
    statesRecordedAnswer ||
    statesBlank
  );
}

/**
 * "Đáp án **"c"** của đề bài là **chính xác**." states the recorded answer as
 * correct without the words "đúng"/"sai". The subject may be three letters or a
 * dotted label (`**b. 3**`), and a bare verdict sentence says nothing else: the
 * sentence must end right after the claim, and a "vì" anywhere before it means
 * a reason follows, so the line explains something and stays.
 */
function statesAnswerAsCorrect(text: string): boolean {
  const claim = /(?<!\p{L})(?:đáp án|chính xác là|đề bài là)(?![\p{L}])/iu.exec(text);
  if (claim === null) return false;
  // `splitFirstSentence` knows a dot inside `**b. 3**` is not a sentence end.
  const sentence = sentenceOnly(text);
  if (/(?<!\p{L})(?:vì|do|nên)(?![\p{L}])/iu.test(sentence)) return false;
  return /(?<!\p{L})(?:là|là đúng)\s*\*{0,2}\s*(?:chính xác|đúng)\*{0,2}\s*[.!?]?\s*$/iu.test(
    sentence,
  );
}

/**
 * The first sentence of `text`, even when the whole text is one sentence. Used
 * where a claim is only the verdict if nothing else is said in that sentence.
 */
function sentenceOnly(text: string): string {
  const split = splitFirstSentence(text);
  if (split !== null) return split[0];
  // A leading label is not the end: "câu này đáp án ghi nhận … là chính xác!".
  const ends = [...text.matchAll(/[.!?]+/g)].filter((match) => {
    const after = text.slice((match.index ?? 0) + match[0].length);
    return after === "" || /^\s/.test(after);
  });
  const last = ends.at(-1);
  return last?.index === undefined ? text : text.slice(0, last.index + last[0].length);
}

/**
 * The line only says the student's own pick was wrong ("Lựa chọn **"d"** của em
 * là **sai** vì …"): its reason just repeats the verdict, so the line goes while
 * the explanation that follows stays.
 */
function namesChosenPick(text: string): boolean {
  return /(?<!\p{L})(?:lựa chọn|chọn|đã chọn)(?![\p{L}])/iu.test(text) && !/(?<!\p{L})đáp án(?![\p{L}])/iu.test(
    text,
  );
}

/**
 * Removes the verdict sentences at one end of a paragraph. The reason glued on
 * after "vì / do / nên" survives, re-capitalised: "Đáp án đúng là **b** vì
 * `range` giảm dần" → "`range` giảm dần".
 */
/**
 * First sentence of a paragraph and the rest, or `null` for a single sentence.
 * Dots inside `**b. 3**` / `` `a.b` `` are not sentence ends, so markup is never
 * cut in half.
 */
function splitFirstSentence(text: string): [string, string] | null {
  let index = 0;
  let inCode = false;
  let inBold = false;

  while (index < text.length) {
    const char = text[index] ?? "";

    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))?.[0].length ?? 1;
      inCode = !inCode;
      index += run;
      continue;
    }
    if (!inCode && text.startsWith("**", index)) {
      inBold = !inBold;
      index += 2;
      continue;
    }
    if (!inCode && !inBold && (char === "." || char === "!" || char === "?")) {
      const after = text.slice(index + 1);
      // End of the paragraph: the whole text is one sentence.
      if (after.trim() === "") return null;
      if (/^\s/.test(after)) return [text.slice(0, index + 1), after.trimStart()];
    }
    index += 1;
  }
  return null;
}

/**
 * Removes the leading sentences that only restate the verdict ("Chào em, lựa
 * chọn **d** của em là sai…", "Đáp án chính xác là **a: …**") while keeping the
 * reason and the explanation. The reason glued after "vì / do / nên" survives.
 */
function stripAnswerSentences(text: string): string {
  let rest = stripGreeting(text);
  while (rest !== "") {
    const split = splitFirstSentence(rest);
    if (split === null) {
      // One sentence only: drop it if it is purely the verdict, except when
      // that would leave the explanation empty — the verdict line says it already.
      // A trailing "Vì bạn chưa chọn đáp án nào nên … chưa trả lời." is only the
      // verdict too: it is judged when it closes a paragraph, not just opens one.
      // "Vì bạn chưa chọn … nên chưa trả lời. Hãy lưu ý …": the advice stays,
      // the verdict sentence goes with the rest of the paragraph.
      const firstSplit = splitFirstSentence(rest);
      if (
        firstSplit === null &&
        isAnswerSentence(rest) &&
        /^\s*(?:vì|do|nên|bởi)(?![\p{L}])/iu.test(rest)
      ) {
        return "";
      }
      return capitalise(rest);
    }

    const [first, remainder] = split;
    // "Vì bạn chưa chọn … nên chưa trả lời. Hãy lưu ý …": the verdict sentence
    // goes, the advice it introduces stays.
    if (isAnswerSentence(first) && /^\s*(?:vì|do|nên|bởi)(?![\p{L}])/iu.test(first)) {
      const kept = stripAnswerSentences(remainder);
      return capitalise(kept);
    }
    // A verdict that carries its reason ("Đáp án **a** … là **chính xác** vì …")
    // keeps the reason: the rest of the paragraph stays put, and the line is
    // judged again (and kept) further down by `dropWholeLine`.
    if (isAnswerSentence(first) && REASON_IN.test(first)) {
      return `${first} ${stripAnswerSentences(remainder)}`.trim();
    }
    if (!isAnswerSentence(first)) {
      // A chatter sentence in the middle ("Chưa nhận được điểm.") is dropped
      // too; sentences with real content are kept as they are.
      const inner = splitFirstSentence(rest);
      if (inner === null) return capitalise(rest);
      const [sentence, tail] = inner;
      const restOfParagraph = stripAnswerSentences(tail);
      return capitalise([isAnswerSentence(sentence) ? "" : sentence, restOfParagraph].filter(Boolean).join(" "));
    }

    // The explanation often continues in the same sentence after "vì"; it is
    // the reason, not the verdict, so it stays and the rest goes with it.
    const reason = REASON_IN.exec(first)?.[2];
    if (reason) return capitalise(`${reason} ${remainder}`.trim());
    rest = remainder;
  }
  return "";
}

/** Removes one paragraph that only restates the verdict, unless it is the only one left. */
function stripAnswerParagraph(paragraphs: string[], end: "start" | "end"): void {
  while (paragraphs.length > 1) {
    const index = end === "start" ? 0 : paragraphs.length - 1;
    const cleaned = stripAnswerSentences(paragraphs[index] ?? "");
    if (cleaned !== "") {
      paragraphs[index] = cleaned;
      return;
    }
    paragraphs.splice(index, 1);
  }
}

/**
 * Drops the verdict sentences that open the body, when the first sentence is
 * entirely the verdict ("Đáp án chính xác là **a: …**."). A sentence that
 * carries its reason is left alone: the reason belongs to it, and lifting it
 * out leaves a clause that starts mid-way ("… 14) với khoảng cách …"). The one
 * verdict that opens with a conjunction ("Vì em để trống nên chưa có điểm.")
 * is a reason itself, so the line stays.
 */
function dropAnswerOpener(body: string): string {
  const lines = body.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstIndex === -1) return body.trim();

  const line = lines[firstIndex] ?? "";
  const sentences = splitSentences(line);

  let from = 0;
  while (from < sentences.length && isAnswerSentence(sentences[from] ?? "")) from += 1;

  // A verdict that carries its own reason ("Đáp án đúng là **b** vì …") is an
  // explanation, so the line stays whole — unless it is the student's own pick,
  // whose "vì" only repeats that the pick was wrong. A line that is nothing but
  // the verdict only stays when it is the whole body: cutting it would leave
  // nothing, and another paragraph already explains it otherwise.
  const first = sentences[0] ?? "";
  const onlyVerdict = from === sentences.length;
  const keepsFirst =
    from > 0 &&
    ((onlyVerdict && lines.length === firstIndex + 1) ||
      (!onlyVerdict && REASON_IN.test(first) && !namesChosenPick(first)));

  if (keepsFirst) return body.trim();

  const rest = sentences.slice(from).join(" ");
  const bodyLines = [...lines.slice(0, firstIndex), rest, ...lines.slice(firstIndex + 1)];
  return bodyLines.join("\n").trim();
}

/** Sentences of one line; a dot inside `**b. 3**` does not end a sentence. */
function splitSentences(line: string): string[] {
  const sentences: string[] = [];
  for (let rest = line.trim(); rest !== ""; ) {
    const split = splitFirstSentence(rest);
    if (split === null) {
      sentences.push(rest);
      break;
    }
    sentences.push(split[0]);
    rest = split[1];
  }
  return sentences;
}

/**
 * Removes a line that only restates the answer. A line that carries a real
 * reason ("Đáp án đúng là **b** vì `range` giảm dần") is kept, because the
 * reason is not lifted out of its sentence — a clause cut mid-way ("Đó cú
 * pháp …", "Giá trị cuối cùng có thể đạt tới là 14)") reads worse than no body.
 */
function dropWholeLine(line: string): boolean {
  const trimmed = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
  if (trimmed === "") return false;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length !== 1 || !(sentences[0] ?? "").trim() || !isAnswerSentence(trimmed)) return false;
  // "Đáp án đúng là **b** vì `range` giảm dần" — the "vì" clause is a real
  // explanation, so the line stays; only a bare reason-less verdict goes.
  const reason = REASON_IN.exec(trimmed)?.[2] ?? "";
  // A line that ends in a label opens what follows, so it is not a bare verdict.
  if (reason === "" && /[:：]$/.test(trimmed)) return false;
  return reason === "" || isAnswerSentence(reason);
}

/** A paragraph that opens mid-sentence, e.g. a ")" with no opening. */
function isFragment(paragraph: string): boolean {
  return /^\s*(?:[),.;:]|và\b|hoặc\b|nên\b|nhưng\b|mà\b)/iu.test(paragraph);
}

/**
 * True when a paragraph is nothing but the answer ("Đáp án **a** trong đề là



/** "trong python" → "Trong python" for the opening word of a body sentence. */
function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toLocaleUpperCase("vi") + text.slice(1);
}

/**
 * What the Question/Attempt itself records, for a verdict the text does not
 * spell out: the sinh viên's choice from `selectedOptionKeys`, whether they
 * filled a blank from `blankValues`, and the recorded answer from the keys /
 * accepted blanks.
 */
function contextVerdict(context: ExplanationContext | undefined): Partial<ExplanationVerdict> {
  if (!context) return {};
  const correct = context.correctOptionKeys ?? [];
  const selected = context.selectedOptionKeys ?? [];
  const blankNames = context.blankNames ?? [];
  const blankValues = context.blankValues ?? [];
  const filled = blankNames.filter((_, index) => (blankValues[index] ?? "").trim() !== "");

  if (correct.length > 0) {
    const answered = selected.length > 0 && selected.every((key) => correct.includes(key));
    return {
      chosen: selected.length > 0 ? [...selected] : null,
      correct: [...correct],
      kind:
        selected.length === 0
          ? "blank"
          : answered && selected.length === correct.length
            ? "correct"
            : "wrong",
    };
  }
  if (blankNames.length > 0) {
    const accepted = (context.correctBlankAnswers ?? []).filter((answer) => answer.trim() !== "");
    if (filled.length === 0) {
      return { chosen: null, correct: accepted.length > 0 ? accepted : null, kind: "blank" };
    }
    return {
      chosen: filled.map((name) => `Ô ${name}`),
      correct: accepted.length > 0 ? accepted : null,
      kind: "wrong",
    };
  }
  return {};
}

/**
 * Turns any explanation — already formatted, legacy markdown, or plain prose —
 * into the single shape the panels render. Idempotent: running it on its own
 * output returns the same text.
 */
export function normalizeExplanation(
  text: string,
  context: ExplanationContext = {},
): ExplanationSections {
  const source = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (source === "") return { verdict: "", body: "", legacy: false };

  const lines = source.split("\n");
  const verdictIndex = lines.findIndex((line) => VERDICT_LINE.test(line));

  if (verdictIndex >= 0) {
    // Already in the agreed shape: keep the verdict line as written, drop the
    // "Giải thích:" separator, and tidy only the body.
    const verdictLine = (lines[verdictIndex] ?? "").trim();
    const rest = lines.slice(verdictIndex + 1).join("\n").replace(EXPLANATION_BODY_MARKER_RE, "");
    return { verdict: verdictLine, body: bodyOf(rest), legacy: false };
  }

  // Legacy: take the model's claims, then fill in whatever it left out from the
  // Question itself — the verdict must never be vague about what was answered.
  const claims = parseClaims(source);
  const contextClaims = contextVerdict(context);

  // The context (what the sinh viên actually answered) wins over the model's
  // wording: a stray "chính xác" in the body must not turn a blank into "đúng",
  // and a filled answer must not read as blank because of a stray "chưa điền".
  const kind =
    claims.kind === "blank" || contextClaims.kind === "blank"
      ? "blank"
      : (contextClaims.kind ?? claims.kind ?? "unknown");
  const chosen = claims.kind === "blank" ? null : (claims.chosen ?? contextClaims.chosen);
  // A recorded answer the model calls wrong cannot be presented as correct.
  // Otherwise the text names it; if it does not, the Question's own record does.
  const correct =
    claims.recordedAnswerDisputed === true
      ? null
      : (claims.correct ??
        (contextClaims.correct && contextClaims.correct.length > 0 ? contextClaims.correct : null));

  // Strip the sentences that only repeat the verdict — "Chào em, lựa chọn **d**
  // của em là sai…", "Đáp án chính xác là **a: …**", a trailing "câu này đáp án
  // ghi nhận … là chính xác!" — from the outside in, so the reason survives and
  // every answer opens the same way.
  const paragraphs = source.split(/\n{2,}/).map(stripGreeting).filter((p) => p !== "");
  stripAnswerParagraph(paragraphs, "start");
  stripAnswerParagraph(paragraphs, "end");

  // The answer itself ("Đáp án đúng là **e**", "Đáp án **a** trong đề là chính
  // xác") is now the verdict line; the body must not repeat it in other words.
  // Each line is judged within its own paragraph: a list item is not a
  // paragraph boundary (the answer often opens the first bullet).
  const keptParagraphs = paragraphs
    .map((paragraph) =>
      paragraph
        .split("\n")
        .filter((line) => !dropWholeLine(line))
        .join("\n")
        .trim(),
    )
    .filter((paragraph) => !isFragment(paragraph));
  const body = bodyOf(dropAnswerOpener(keptParagraphs.join("\n\n")));
  const verdict = boldVerdict(
    formatVerdict({
      kind,
      chosen: chosen ?? null,
      correct,
      recordedAnswerDisputed: claims.recordedAnswerDisputed === true,
    }),
  );
  return { verdict, body, legacy: true };
}

/** The exact text stored in the cache: verdict line, `Giải thích:`, then the body. */
export function formatExplanation(sections: ExplanationSections): string {
  if (sections.verdict === "") return sections.body;
  const body = sections.body.trim();
  return body === "" ? sections.verdict : `${sections.verdict}\n\n${EXPLANATION_BODY_MARKER}\n\n${body}`;
}
