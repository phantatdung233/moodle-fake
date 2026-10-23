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
nhập MSSV + họ tên, mỗi màn một câu, tự lưu, xem đáp án tức thì, và **giải thích
Gemini streaming** sau mỗi câu (`POST /api/explain`, cache theo `Question.hash`).

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

## Sinh viên làm bài (`/`, `/q/<slug>`)

1. Trang chủ `/` liệt kê các đề đang có (ticket #8 sẽ giới hạn còn đề `published`;
   hiện tại đề nháp cũng hiện, có nhãn "Bản nháp", để demo ngay sau `pnpm seed`).
2. Bấm vào đề → `/q/<slug>`: nếu trình duyệt chưa có danh tính cho đề này thì hiện
   form **MSSV + họ tên** (không mật khẩu). Gửi form sẽ **tiếp tục** bài đang làm
   dở của MSSV đó nếu có, ngược lại tạo `Attempt` mới.
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
tab thua đọc lại bài đã tạo. Làm lại sau khi nộp (ticket #8) sẽ tạo `Attempt` mới.

### Lớp dữ liệu Attempt (`src/lib/quiz/attempt-repository.ts`)

- `resumeOrStartAttempt({ quizId, studentId, studentName })` →
  `{ ok: true, attempt, resumed } | { ok: false, error }` — điểm vào duy nhất.
- `getAttemptForStudent(attemptId, studentId)` → `AttemptView | null` — sai chủ
  thì `null`.
- `getOpenAttempt(quizId, studentId)` → `AttemptView | null`.
- `answerQuestion({ attemptId, studentId, questionId, selectedOptionKeys, blankValues })`
  → `{ ok: true } | { ok: false, error }` — chặn câu đã xem đáp án.
- `revealQuestion({ attemptId, studentId, questionId })` →
  `{ ok: true, feedback } | { ok: false, error }` — chỉ chế độ luyện tập.
- `normalizeStudentId(raw)`, `NOT_YOUR_ATTEMPT_ERROR`, `REVEALED_LOCKED_ERROR`,
  `QUESTION_NOT_FOUND_ERROR`.

Server actions cho trình duyệt (`src/lib/student/actions.ts`):
`beginAttempt`, `loadAttempt`, `saveAnswer`, `revealAnswer`, `forgetStudent`.

## Giải thích bằng Gemini (`src/lib/gemini/`, `/api/explain`)

Sau khi câu được chấm (chế độ luyện tập: bấm **Xem đáp án**) một panel
**“Giải thích bằng AI”** hiện dưới phần phản hồi và chữ chạy dần. Đúng/sai và
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
src/app/                 App Router: / (danh sách đề), /q/[slug] (làm bài),
                         /admin, /admin/login, /admin/quizzes/[id]
src/components/ui/       shadcn/ui (preset radix-nova)
src/components/quiz/     quiz-runner (client: trạng thái, lưu, panel, phản hồi),
                         question-content + highlight (server: markdown, shiki, ảnh)
src/lib/auth/token.ts    HMAC token dùng chung cho cookie admin và sinh viên
src/lib/admin/           mật khẩu admin, session cookie, server actions login/logout/upload,
                         upload.ts (đọc file + preview, gọi parser)
src/lib/quiz/            model Quiz + Attempt, parser Moodle, grading, repository,
                         attempt-repository, content/splitPlaceholders, markdown, slug
src/lib/gemini/          prompt thuần, ExplainClient + SDK Gemini, ExplanationCache,
                         explainQuestion, đọc frame SSE, messages (dùng cho client)
src/app/api/explain/     route handler streaming giải thích
src/components/quiz/explanation-panel.tsx  panel “Giải thích bằng AI”
src/lib/student/         session cookie sinh viên, server actions, answers (helper thuần),
                         feedback (câu chữ phản hồi)
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
- `getQuizBySlug(slug)` → `TestableQuiz | null` cho `/q/<slug>`.
- `listTestableQuizzes()` → `TestableQuiz[]` cho trang chủ.

## Ghi chú

- UI tiếng Việt cứng, tối ưu mobile; không có i18n.
- Cookie phiên admin và cookie danh tính sinh viên là hai cookie khác nhau, cùng
  định dạng `<payload>.<HMAC-SHA256>` ký bằng `SESSION_SECRET`, `httpOnly`,
  `SameSite=Lax`, `Secure` khi production.
- Khi test component `.tsx` bằng Vitest, file test dùng `renderToStaticMarkup`
  (xem `src/components/quiz/question-content.test.tsx`); `@vitejs/plugin-react`
  lo phần JSX vì `tsconfig` giữ JSX cho Next.
