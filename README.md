# Moodle Quiz Platform

Web app tiếng Việt cho sinh viên làm bài trắc nghiệm Python xuất từ Moodle, và cho
giảng viên duyệt lại đáp án trước khi publish. Spec đầy đủ: GitHub issue #1
(bản sao trong `.scratch/moodle-quiz-platform/spec.md`).

Đã có (đến Ticket 8): khung Next.js 15 App Router, đăng nhập admin
(`/admin/login`, cookie httpOnly), middleware chặn `/admin/**`, **upload file
Moodle JSON → đề nháp** với màn hình preview (số câu theo loại, số câu cần duyệt,
lỗi parse), danh sách đề ở `/admin`, **parser thuần** biến file Moodle thành
`Question` chuẩn hoá (`src/lib/quiz/parser.ts`), **module chấm điểm thuần**
(`src/lib/quiz/grading.ts`), **luồng sinh viên luyện tập** (`/`, `/q/<slug>`):
nhập MSSV + họ tên, mỗi màn một câu, tự lưu, xem đáp án tức thì, **vòng đời
đề + chế độ thi**: sửa đề nháp, publish (chốt đề), huỷ publish, lưu trữ, thi có
đồng hồ đếm ngược, nộp bài và trang tổng kết (`/q/<slug>/ket-qua`), và **giải
thích Gemini streaming** sau mỗi câu (`POST /api/explain`, cache theo
`Question.hash`).

## Yêu cầu

- **Node.js ≥ 20.19** (Mongoose 9 / MongoDB driver 7)
- **pnpm 12** (`corepack enable` rồi `pnpm --version`)
- **MongoDB** local (Homebrew: `brew install mongodb-community`)

## Cài đặt

```bash
git clone https://github.com/phantatdung233/moodle-fake.git
cd moodle-fake
pnpm install
cp .env.example .env.local     # rồi sửa ADMIN_PASSWORD, SESSION_SECRET
```

`pnpm install` cần chạy được build script của `esbuild`, `unrs-resolver`,
`mongodb-memory-server`, `@google/genai` (và `protobufjs` nó kéo theo); các package
này đã nằm trong `allowBuilds` của
`pnpm-workspace.yaml`. Nếu pnpm vẫn cảnh báo "Ignored build scripts", chạy
`pnpm approve-builds --all` rồi `pnpm install` lại.

## MongoDB local

```bash
brew services start mongodb-community      # chạy nền trên 127.0.0.1:27017
# hoặc chạy tay (--fork KHÔNG hỗ trợ trên macOS):
mkdir -p ./data/db
mongod --dbpath ./data/db --port 27017 --bind_ip 127.0.0.1
```

Tên database mặc định: `moodle_quiz`.

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `MONGODB_URI` | Chuỗi kết nối MongoDB, vd `mongodb://127.0.0.1:27017/moodle_quiz`. Prod dùng Atlas. |
| `ADMIN_PASSWORD` | Mật khẩu đăng nhập `/admin` (một tài khoản admin duy nhất). |
| `SESSION_SECRET` | Bí mật HMAC ký cookie phiên admin **và** cookie danh tính sinh viên. Tạo bằng `openssl rand -hex 32`. |
| `GEMINI_API_KEY` | Key Google Gemini cho phần giải thích. Để trống vẫn chạy: UI hiện “Chưa cấu hình Gemini”, chấm điểm không phụ thuộc Gemini. **Không** đặt `GOOGLE_API_KEY` song song — SDK ưu tiên biến đó và sẽ dùng nhầm key. |
| `GEMINI_MODEL` | Model Gemini dùng để sinh giải thích. Mặc định `gemini-2.5-flash` khi để trống. |

Next.js đọc `.env.local`; `pnpm seed` đọc `.env.local` rồi `.env`.

## Chạy

```bash
pnpm dev        # http://localhost:3000, quản trị tại /admin
pnpm seed       # đọc moodle_quiz_merged.json, chạy parser và tạo một đề nháp "Python cơ bản"
pnpm test       # Vitest (node), dùng mongodb-memory-server
pnpm lint       # ESLint
pnpm build      # production build
```

`pnpm seed` đọc file Moodle, chạy `parseQuizJson`, in tóm tắt (180 câu — 161
`multichoice`, 19 `multianswer`; 100 câu `needs_review`, 10 câu có ô trống chưa
có đáp án, 88 lỗi parse) rồi tạo một đề **nháp** qua cùng lớp dữ liệu với upload.
Chạy lại khi slug `python-co-ban` đã tồn tại thì seed dùng `python-co-ban-2`,
`-3`…, không ghi đè đề cũ.

## Upload đề và danh sách đề (`/admin`)

1. Đăng nhập `/admin/login`, chọn file JSON xuất từ Moodle, bấm **Xem trước**.
   Preview hiện số câu theo loại (multichoice/multianswer), số câu `needs_review`
   và danh sách lỗi parse (`questionId` + lý do). Chưa có gì được lưu ở bước này.
2. Đặt **tên đề** (bắt buộc) và **slug** — slug tự sinh từ tên, sửa được, chỉ gồm
   chữ thường, số và dấu `-`, và phải là duy nhất. Bấm **Tạo đề nháp**.
3. Hệ thống đọc lại file ở server, tạo một `Quiz` mới `status: draft` với **toàn
   bộ** câu đã parse (kể cả câu `needs_review`), rồi mở `/admin/quizzes/<id>`.

- Upload cùng một file lần nữa tạo đề **mới**; đề cũ không bị đụng tới.
- File top-level không phải mảng, JSON hỏng, file rỗng hoặc lớn hơn 5 MB bị từ
  chối bằng thông báo tiếng Việt, không ghi gì vào DB.
- Slug trùng cũng bị từ chối; preview vẫn hiện để chỉ cần sửa slug.
- `/admin` liệt kê mọi đề: tên, slug, chế độ, trạng thái, số câu, số câu cần duyệt
  và số lượt làm (số `Attempt` của đề, mọi trạng thái).

### Parser (`src/lib/quiz/parser.ts`)

`parseQuizJson(rawJson)` là module thuần: nhận JSON **đã** `JSON.parse`, không
đọc file/env/DB, trả về `{ questions, stats, errors }`.

- `options[].selected` → `options[].correct`; nhiều option đúng là hợp lệ.
- `blanks[].value` → `blanks[].acceptedAnswer`.
- `content` giữ nguyên, kể cả placeholder `[[n]]`; `images` giữ URL gốc.
- `Question` là `needs_review` khi không có đáp án dùng được (multichoice không
  có `selected: true`, multianswer có ô trống) hoặc nằm trong danh sách ID đáp
  án rác đã biết (Q143, Q179) — parser **không tự bịa đáp án**.
- `hash` = SHA-256 của nội dung + đáp án, dùng làm cache key của giải thích Gemini.
- Một câu hỏng thành một entry trong `errors[]` (`{ questionId, reason }`, lý do
  tiếng Việt); top-level không phải mảng thì ném `TypeError` tiếng Việt.

Lần đầu chạy `pnpm test`, `mongodb-memory-server` tải binary `mongod` riêng
(~80 MB) vào `node_modules/.cache/` — không cần mongod local đang chạy.

### Chấm điểm (`src/lib/quiz/grading.ts`)

Module thuần, không DB/HTTP/UI: dùng cho phản hồi tức thì ở chế độ luyện tập và
điểm cuối cùng khi nộp bài.

Hình dạng câu trả lời (Attempt lưu đúng shape này):

```ts
type AttemptAnswer = {
  questionId: string;
  selectedOptionKeys: string[]; // multichoice: key của option đã chọn
  blankValues: string[];        // multianswer: theo vị trí, khớp Question.blanks
};
```

- `gradeAnswer(question, answer)` → `{ correct, score, perBlank? }`.
  `perBlank` chỉ có với `multianswer`: `{ name, acceptedAnswer, value, correct }`
  cho từng ô, để UI tô đỏ ô sai và hiện đáp án đúng.
- `gradeAttempt(quiz, answers)` → `{ total, perQuestion }`; `total` =
  `sum(score) / số câu × 100`, làm tròn 1 chữ số thập phân. Câu không trả lời vẫn
  có mặt với `score: 0`; câu `enabled: false` không được chấm.
- `multichoice`: tập key chọn phải **trùng khít** tập key đúng (thứ tự/trùng lặp
  không tính) → 1, ngược lại 0.
- `multianswer`: `số ô đúng / tổng số ô`, làm tròn 2 chữ số thập phân (2/3 → 0.67).
- `normalizeBlank`: `trim`, gộp khoảng trắng liên tiếp thành 1, `lowercase`;
  không bỏ dấu tiếng Việt. Câu trả lời rỗng/sai cấu trúc được coi là bỏ trống
  (0 điểm), không ném lỗi.

## Sinh viên làm bài (`/`, `/q/<slug>`, `/q/<slug>/ket-qua`)

1. Trang chủ `/` chỉ liệt kê các đề `status: published`; đề nháp và đề lưu trữ
   không hiện, và vào thẳng `/q/<slug>` của đề chưa publish cũng bị chặn
   ("Đề này chưa mở cho sinh viên làm.").
2. Bấm vào đề → `/q/<slug>`: nếu trình duyệt chưa có danh tính cho đề này thì hiện
   form **MSSV + họ tên** (không mật khẩu). Gửi form sẽ **tiếp tục** bài đang làm
   dở của MSSV đó nếu có, ngược lại tạo `Attempt` mới. Cookie đã có bài **đã nộp**
   thì được chuyển thẳng tới `/q/<slug>/ket-qua`.
3. Mỗi màn một câu, hiện "Câu n/180", nút **Câu trước / Câu sau** và panel
   **Danh sách câu** để nhảy tới câu bất kỳ. Ô trong panel tô màu: đã trả lời,
   chưa trả lời, đã khoá.
4. Trả lời được **lưu ngay**: chọn option lưu tức thì, gõ ô trống thì debounce
   (~600 ms) và luôn flush trước khi chuyển câu / xem đáp án / đóng tab. Góc phải
   trên hiện "Đang lưu…" / "Đã lưu".
5. Chế độ luyện tập có nút **Xem đáp án**: server chấm bằng `gradeAnswer`, trả về
   đúng/sai, option đúng, từng ô trống đúng/sai kèm đáp án đúng. Câu đó **bị khoá**
   ngay sau khi xem; sửa tiếp sẽ nhận lỗi từ server (`saveAnswer` từ chối).
6. Nội dung câu: chương trình Python được tô màu cú pháp (shiki, render ở server —
   grammar không vào bundle trình duyệt), chữ thường qua Markdown đã sanitize,
   ô trống nằm **đúng vị trí `[[n]]`** kể cả khi nằm trong code, và ảnh đính kèm
   (Q020, Q114) được hiển thị.
7. Chế độ thi **không** có nút xem đáp án, không lộ đáp án/giải thích trong HTML
   trước khi nộp. Nếu đề có `timeLimit`, góc phải hiện **đồng hồ đếm ngược** tính
   từ `Attempt.deadline` (server ghi lúc bắt đầu); hết giờ thì trình duyệt tự nộp,
   và server cũng tự nộp khi trang được tải lại sau hạn.
8. Nút **Nộp bài** mở hộp thoại xác nhận (hiện số câu bỏ trống). Nộp xong mở
   `/q/<slug>/ket-qua`: phần trăm điểm, số câu đúng/sai/bỏ trống, và **review
   từng câu** (đáp án đã chọn vs đáp án đúng, ô trống đúng/sai). Chỉ nộp được một
   lần — bấm lại trả về kết quả cũ, không chấm lại. Câu bỏ trống tính 0 điểm.
9. Đề giới hạn `maxAttempts` (chế độ thi): hết lượt thì báo
   "Bạn đã hết N lần làm đề này." Bài đang làm dở vẫn luôn được tiếp tục. Khi còn
   lượt, trang tổng kết có nút **Làm lại** (tạo `Attempt` mới, chấm lại từ đầu).

### Danh tính sinh viên

Cookie `student_session` riêng (không dùng chung với cookie admin):
`<payload>.<HMAC-SHA256>` qua `src/lib/auth/token.ts`, `httpOnly`,
`SameSite=Lax`, `Secure` khi production, hạn 30 ngày. Payload chỉ có
`{ studentId, attemptId, iat }`; **cookie chỉ là gợi ý** — mọi lần đọc/ghi
(`src/lib/quiz/attempt-repository.ts`) đều kiểm tra lại `Attempt.studentId`
khớp MSSV trong cookie, nên đoán/đổi `attemptId` không mở được bài của người khác.

### Model `Attempt` (`src/lib/quiz/attempt.model.ts`)

```ts
type Attempt = {
  studentId: string;        // MSSV đã chuẩn hoá: trim + uppercase
  studentName: string;
  quizId: ObjectId;
  quizSlug: string;
  quizVersion: number;
  mode: "practice" | "exam";
  status: "in_progress" | "submitted" | "expired";
  startedAt: Date;
  submittedAt?: Date;
  deadline?: Date;          // exam + timeLimit
  questionsSnapshot: QuizQuestion[]; // chốt đề tại lúc bắt đầu
  answers: (AttemptAnswer & { revealed: boolean; graded?: { correct, score, perBlank? } })[];
  result?: { total: number; perQuestion: …[] };
};
```

Partial unique index trên `(studentId, quizId)` với `status: "in_progress"`:
mỗi sinh viên chỉ có **một** bài đang làm cho mỗi đề; hai tab bấm cùng lúc thì
tab thua đọc lại bài đã tạo. Làm lại sau khi nộp tạo `Attempt` mới; `maxAttempts`
đếm số `Attempt` `submitted` + `expired` (chỉ chế độ thi).

### Lớp dữ liệu Attempt (`src/lib/quiz/attempt-repository.ts`)

- `resumeOrStartAttempt({ quizId, studentId, studentName })` →
  `{ ok: true, attempt, resumed } | { ok: false, error }` — điểm vào duy nhất;
  từ chối đề chưa publish (`QUIZ_NOT_OPEN_ERROR`) và đề đã hết lượt làm.
- `getAttemptForStudent(attemptId, studentId)` → `AttemptView | null` — sai chủ
  thì `null`.
- `getOpenAttempt(quizId, studentId)` → `AttemptView | null`.
- `answerQuestion({ attemptId, studentId, questionId, selectedOptionKeys, blankValues })`
  → `{ ok: true } | { ok: false, error }` — chặn câu đã xem đáp án và bài đã nộp.
- `revealQuestion({ attemptId, studentId, questionId })` →
  `{ ok: true, feedback } | { ok: false, error }` — chỉ chế độ luyện tập.
- `submitAttempt({ attemptId, studentId })` →
  `{ ok: true, status: "submitted" | "expired", result } | { ok: false, error }` —
  chấm **một lần** bằng `gradeAttempt`, lưu `result`, khoá mọi câu (`revealed: true`).
  Guard `findOneAndUpdate({ status: "in_progress" })` nên gọi lại (bấm hai lần, hai
  tab) trả về đúng kết quả cũ; quá `deadline` thì `status: "expired"`.
- `submitExpiredIfDue(attempt)` — tự nộp bài quá hạn, gọi trong `loadAttempt`.
- `getSummaryForStudent(quizId, studentId, attemptId?)` → `AttemptSummary | null`
  cho trang tổng kết (điểm, per-question, lịch sử, còn lượt hay không).
- `normalizeStudentId(raw)`, `NOT_YOUR_ATTEMPT_ERROR`, `REVEALED_LOCKED_ERROR`,
  `QUESTION_NOT_FOUND_ERROR`, `SUBMITTED_LOCKED_ERROR`, `TIME_UP_ERROR`,
  `QUIZ_NOT_OPEN_ERROR`.

Server actions cho trình duyệt (`src/lib/student/actions.ts`):
`beginAttempt`, `loadAttempt`, `loadOwnedAttempt`, `loadSummary`, `saveAnswer`,
`revealAnswer`, `submitMyAttempt`, `forgetStudent`. Mọi action đọc danh tính từ
cookie và kiểm tra lại chủ `Attempt` ở server.

## Vòng đời đề (`/admin/quizzes/<id>`)

```
draft ──publish──▶ published ──archive──▶ archived (trạng thái cuối)
  ▲                    │
  └────unpublish───────┘  (chỉ khi đề chưa có Attempt nào)
```

- **Đề nháp** sửa được mọi thứ: tên, slug, chế độ (`practice` / `exam`), thời gian
  làm bài (phút), số lần làm tối đa, và bật/tắt từng câu (`enabled`). Mọi thay đổi
  bị từ chối ở server nếu đề không còn `draft` (thông báo tiếng Việt).
- **Publish** = chốt đề: chỉ các câu `enabled && ready` (không `needs_review`)
  được đưa vào bài. Trước khi xác nhận, UI cảnh báo "N câu sẽ bị loại"; nếu không
  còn câu dùng được thì chặn publish. Publish tăng `version` và ghi `publishedAt`.
- **Huỷ publish** đưa đề về `draft` (giữ nguyên các câu đã bị loại ở trạng thái
  tắt) và xoá `publishedAt`; **bị từ chối** khi đã có `Attempt` — vì bài đã chốt
  không được lệch với snapshot của sinh viên.
- **Lưu trữ** chỉ từ `published`, là trạng thái cuối: đề biến khỏi `/`, không sửa
  được nữa, nhưng kết quả cũ vẫn xem được qua `/q/<slug>/ket-qua`.

### Lớp dữ liệu vòng đời (`src/lib/quiz/lifecycle-repository.ts`)

- `describePublish(quizId)` → `PublishPreview` (số câu giữ lại, số câu bị loại) —
  dùng để hiện cảnh báo trước khi publish.
- `publishQuiz(quizId)` → `{ ok: true, version } | { ok: false, error }`.
- `unpublishQuiz(quizId)`, `archiveQuiz(quizId)` → `{ ok: true } | { ok: false, error }`.
- `updateQuizSettings(quizId, { title, slug, mode, timeLimit, maxAttempts })`.
- `saveQuestionSelection(quizId, { questionId, enabled })`.
- Hằng số lỗi: `NOT_DRAFT_ERROR`, `NOT_PUBLISHED_ERROR`, `NOT_ARCHIVED_ERROR`,
  `ARCHIVED_TERMINAL_ERROR`, `NO_READY_QUESTIONS_ERROR`,
  `UNPUBLISH_HAS_ATTEMPTS_ERROR`, `TIME_LIMIT_ERROR`, `MAX_ATTEMPTS_ERROR`…

Server actions (`src/lib/admin/lifecycle-actions.ts`, đều kiểm tra phiên admin):
`saveQuizSettings`, `toggleQuestion`, `publishQuizAction`, `unpublishQuizAction`,
`archiveQuizAction`.

## Giải thích bằng Gemini (`src/lib/gemini/`, `/api/explain`)

Sau khi câu được chấm (chế độ luyện tập: bấm **Xem đáp án**; chế độ thi: ngay khi
nộp, trong phần review từng câu ở `/q/<slug>/ket-qua`) một panel **“Giải thích
bằng AI”** hiện dưới phần phản hồi và chữ chạy dần. Đúng/sai và
đáp án **không bao giờ** đến từ Gemini — đó là kết quả của `gradeAnswer`; Gemini
chỉ viết lời giải thích (tiếng Việt, ngắn), và được yêu cầu **nói thẳng** nếu
đáp án ghi nhận trong đề sai kiến thức (Q144, Q153, Q156, Q165…).

- `buildExplanationPrompt({ question, studentAnswer })` → `string` — hàm thuần
  (seam được test, không gọi mạng): chứa nội dung câu, mọi lựa chọn kèm key,
  đáp án ghi nhận, câu trả lời của sinh viên; với `multianswer` liệt kê **mọi ô**
  cùng đáp án mong đợi và điều sinh viên gõ; kèm yêu cầu tiếng Việt/ngắn gọn.
- `explainQuestion({ question, studentAnswer, client?, apiKey? })` →
  `{ ok, source: "cache" | "generated", stream } | { ok: false, error, stream }`.
  `stream` phát từng `{ text }` rồi `{ error }` nếu model hỏng giữa dòng. Ghi
  `ExplanationCache` khi stream xong; lỗi/trống thì **không** cache để lần sau
  sinh lại. Truyền `client` (`ExplainClient = { stream(prompt): AsyncIterable<string> }`)
  để test bằng fake model và đếm số lần gọi.
- `getStoredExplanation({ hash })` / `getCachedExplanation(hash)` → `string | null`
  — chỉ đọc cache; trang tổng kết (ticket sau) dùng để hiện lại giải thích có sẵn.
- `EXPLANATION.notConfigured` (“Chưa cấu hình Gemini”) và
  `EXPLANATION.unavailable` (“Chưa cấu hình hoặc không dùng được Gemini”) nằm ở
  `messages.ts` — file an toàn cho client, không kéo SDK vào bundle trình duyệt.
- Model: `GEMINI_MODEL` (mặc định `gemini-2.5-flash`, `thinkingBudget: 0`). Nếu
  project Google chưa được cấp quyền 2.5 chỉ cần đổi biến này, không sửa code.

**Cache** (`ExplanationCache`: `questionHash` unique, `questionId`, `text`,
`createdAt`): khoá là `Question.hash` (SHA-256 của nội dung + đáp án). Sinh viên
thứ hai xem cùng câu → nhận cache, không gọi model. Giảng viên sửa đáp án →
hash đổi → giải thích mới; `Attempt` cũ vẫn mang hash cũ nên đọc đúng bản cũ.

**Route** `POST /api/explain` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`):
body `{ questionId, questionHash? }`. Server tự lấy Question + câu trả lời từ
`Attempt` của cookie sinh viên (không tin hash/hay text từ trình duyệt).
Response `text/event-stream` gồm `data: {"text":…}` … `data: {"done":true}`;
lỗi mềm là `data: {"error":…}` với status `200` kèm header
`X-Explain-Status: soft-error`. `401` chưa có danh tính, `404` câu không thuộc
bài, `409` trang đã cũ (hash lệch) → panel nhắc tải lại. Client đọc bằng
`readExplanationFrames()` (`fetch` + `ReadableStream` reader) và có nút **Thử lại**.

## Cấu trúc

```
src/app/                 App Router: / (danh sách đề đã publish), /q/[slug] (làm bài),
                         /q/[slug]/ket-qua (tổng kết + review từng câu),
                         /admin, /admin/login, /admin/quizzes/[id] (sửa đề + vòng đời)
src/components/ui/       shadcn/ui (preset radix-nova)
src/components/quiz/     quiz-runner (client: trạng thái, lưu, panel, phản hồi, đồng hồ,
                         nộp bài), question-content + highlight (server: markdown, shiki, ảnh)
src/lib/auth/token.ts    HMAC token dùng chung cho cookie admin và sinh viên
src/lib/admin/           mật khẩu admin, session cookie, server actions login/logout/upload,
                         lifecycle-actions (sửa đề, bật/tắt câu, publish/huỷ/lưu trữ),
                         upload.ts (đọc file + preview, gọi parser)
src/lib/quiz/            model Quiz + Attempt, parser Moodle, grading, repository,
                         lifecycle-repository, attempt-repository,
                         content/splitPlaceholders, markdown, slug
src/lib/gemini/          prompt thuần, ExplainClient + SDK Gemini, ExplanationCache,
                         explainQuestion, đọc frame SSE, messages (dùng cho client)
src/app/api/explain/     route handler streaming giải thích
src/components/quiz/explanation-panel.tsx  panel “Giải thích bằng AI”
src/lib/student/         session cookie sinh viên, server actions, answers (helper thuần),
                         feedback (câu chữ phản hồi), exam (helper trình bày trạng thái thi)
src/lib/db.ts            kết nối Mongoose dùng chung
src/middleware.ts        chặn mọi /admin/** khi chưa có phiên hợp lệ
src/test/                helper test: env, mongodb-memory-server
scripts/seed.ts          CLI pnpm seed
```

### Lớp dữ liệu Quiz (`src/lib/quiz/repository.ts`)

Dùng chung bởi server action và các trang admin (trả về object thuần, không phải
Mongoose document):

- `createDraftQuizFromQuestions({ title, slug, questions })` →
  `{ ok: true, quizId, slug } | { ok: false, error }` — tạo đề nháp, kiểm tra
  tên/slug, bắt slug trùng qua unique index (kể cả khi upload đồng thời).
- `listQuizzes()` → `QuizListItem[]` cho `/admin` (số câu, ready/needs_review, lượt làm).
- `getQuizForAdmin(id)` → `QuizDetail | null` cho `/admin/quizzes/[id]`
  (`null` khi id sai hoặc không tồn tại).
- `getQuizBySlug(slug)` → `TestableQuiz | null` cho `/q/<slug>` — chỉ đề
  `published`; `getQuizBySlugAnyStatus(slug)` dùng riêng cho trang tổng kết
  (kể cả đề đã lưu trữ).
- `listTestableQuizzes()` → `TestableQuiz[]` cho trang chủ (chỉ đề `published`).

## Ghi chú

- UI tiếng Việt cứng, tối ưu mobile; không có i18n.
- Cookie phiên admin và cookie danh tính sinh viên là hai cookie khác nhau, cùng
  định dạng `<payload>.<HMAC-SHA256>` ký bằng `SESSION_SECRET`, `httpOnly`,
  `SameSite=Lax`, `Secure` khi production.
- Khi test component `.tsx` bằng Vitest, file test dùng `renderToStaticMarkup`
  (xem `src/components/quiz/question-content.test.tsx`); `@vitejs/plugin-react`
  lo phần JSX vì `tsconfig` giữ JSX cho Next. Server component async phải
  `await` rồi mới render (xem helper `resolveTree` trong
  `src/app/q/summary-page.test.tsx`), và client component được thay bằng
  `client:<Tên>` khi kiểm tra cây props.
- `src/lib/admin/test-helpers.ts` chỉ dùng trong test: đưa đề sang trạng thái bất
  kỳ (`transitionToStatus`) và xoá `Attempt` (`resetAttempts`).
