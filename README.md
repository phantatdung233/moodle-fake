# Moodle Quiz Platform

Web app tiếng Việt cho sinh viên làm bài trắc nghiệm Python xuất từ Moodle, và cho
giảng viên duyệt lại đáp án trước khi publish. Spec đầy đủ: GitHub issue #1
(bản sao trong `.scratch/moodle-quiz-platform/spec.md`).

Đã có (đủ spec ticket #1 → #9): khung Next.js 15 App Router, đăng nhập admin
(`/admin/login`, cookie httpOnly), middleware chặn `/admin/**`, **upload file
Moodle JSON → đề nháp** với màn hình preview (số câu theo loại, số câu cần duyệt,
lỗi parse), danh sách đề ở `/admin`, **parser thuần** biến file Moodle thành
`Question` chuẩn hoá (`src/lib/quiz/parser.ts`), **module chấm điểm thuần**
(`src/lib/quiz/grading.ts`), **luồng sinh viên luyện tập** (`/`, `/q/<slug>`):
nhập MSSV + họ tên, mỗi màn một câu, tự lưu, xem đáp án tức thì, **vòng đời
đề + chế độ thi**: sửa đề nháp, publish (chốt đề), huỷ publish, lưu trữ, thi có
đồng hồ đếm ngược, nộp bài và trang tổng kết (`/q/<slug>/ket-qua`), và **giải
thích Gemini streaming** sau mỗi câu (`POST /api/explain`, cache theo
`Question.hash`), **duyệt đáp án** ở `/admin/quizzes/<id>/review` (chỉ hiện lại
giải thích đã cache; nút **Giải thích bằng AI** mới gọi model lần nữa, qua
`POST /api/admin/explain`), và **quản trị kết quả** (`/admin/results`): bảng mọi lượt làm
có lọc theo đề/MSSV, xuất CSV, reset lượt của một sinh viên trong một đề, và
trang chi tiết từng câu **theo snapshot** của bài đã làm.

## Hướng dẫn nhanh (từ số 0 đến lúc sinh viên làm bài)

```bash
# 1. Cài đặt
brew services start mongodb-community
pnpm install
cp .env.example .env.local      # sửa ADMIN_PASSWORD + SESSION_SECRET

# 2. Chạy
pnpm dev                        # http://localhost:3000

# 3. Quản trị: http://localhost:3000/admin/login
#    → upload moodle_quiz_merged.json → duyệt đáp án → publish

# 4. Sinh viên: http://localhost:3000/ → chọn đề → nhập MSSV + họ tên
#    → làm bài → Nộp bài → xem tổng kết + giải thích

# 5. Giảng viên xem lớp: http://localhost:3000/admin/results
#    → lọc → Xuất CSV → Chi tiết / Reset lượt

# 6. Kiểm tra chất lượng
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Hoặc nạp sẵn một đề nháp bằng `pnpm seed` (xem bên dưới) rồi mở `/admin`.

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
- **Xoá đề nháp** chỉ có ở trang đề `draft`: hộp thoại xác nhận rồi xoá hẳn đề
  cùng giải thích AI đã sinh *của đề đó* (`ExplanationCache` theo hash). Server
  kiểm tra lại trạng thái trong chính câu lệnh xoá, nên đề vừa publish ở tab khác
  bị từ chối: “Chỉ xoá được đề nháp. Đề đã publish hoặc đã lưu trữ phải giữ lại để
  lượt làm cũ còn đọc được.”

### Lớp dữ liệu vòng đời (`src/lib/quiz/lifecycle-repository.ts`)

- `describePublish(quizId)` → `PublishPreview` (số câu giữ lại, số câu bị loại) —
  dùng để hiện cảnh báo trước khi publish.
- `publishQuiz(quizId)` → `{ ok: true, version } | { ok: false, error }`.
- `unpublishQuiz(quizId)`, `archiveQuiz(quizId)` → `{ ok: true } | { ok: false, error }`.
- `updateQuizSettings(quizId, { title, slug, mode, timeLimit, maxAttempts })`.
- `saveQuestionSelection(quizId, { questionId, enabled })`.
- `deleteDraftQuiz(quizId)` — xoá đề `draft` (từ chối mọi trạng thái khác bằng
  `DELETE_NOT_DRAFT_ERROR`) và các `ExplanationCache` mà chỉ đề đó dùng.
- Hằng số lỗi: `NOT_DRAFT_ERROR`, `NOT_PUBLISHED_ERROR`, `NOT_ARCHIVED_ERROR`,
  `ARCHIVED_TERMINAL_ERROR`, `NO_READY_QUESTIONS_ERROR`,
  `UNPUBLISH_HAS_ATTEMPTS_ERROR`, `DELETE_NOT_DRAFT_ERROR`, `TIME_LIMIT_ERROR`,
  `MAX_ATTEMPTS_ERROR`…

Server actions (`src/lib/admin/lifecycle-actions.ts`, đều kiểm tra phiên admin):
`saveQuizSettings`, `toggleQuestion`, `publishQuizAction`, `unpublishQuizAction`,
`archiveQuizAction`, `deleteQuizAction`. Mọi module action admin dùng chung
`withAdminAction(handler)` (`src/lib/admin/with-admin.ts`): trả lỗi phiên hết hạn
bằng tiếng Việt thay vì để lộ lỗi DB, và vẫn để `redirect()`/`notFound()` của Next
đi qua nguyên vẹn.

### Duyệt đáp án (`/admin/quizzes/<id>/review`)

Mỗi lần một câu cần duyệt, đúng thứ tự Moodle; lưu đáp án → câu kế tiếp.
`?tab=ready` mở lại danh sách câu đã có đáp án (chỉ khi đề còn nháp). Nội dung
câu dùng **cùng renderer** với sinh viên (`QuestionContent`), nên placeholder
`[[n]]` nằm đúng vị trí trong chữ và trong code; ở đây ô trống là nhãn chỉ đọc.
Mọi ghi đều kiểm tra lại `status: draft` ở server.

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
- `getCachedExplanation(hash)` → `string | null` — **cửa đọc duy nhất** của
  giải thích đã lưu (trang tổng kết, chi tiết lượt của admin, trang duyệt đáp án).
  Cache hỏng/mất kết nối đọc thành “chưa có”, không làm hỏng màn làm bài.
- Ghi giải thích: `ExplanationCache` upsert theo hash, **và** write-through vào
  `Question.explanation` của mọi đề `draft`/`published` còn mang hash đó — giảng
  viên thấy ngay lời giải thích trong chính document của đề.
- `EXPLANATION.notConfigured` (“Chưa cấu hình Gemini”),
  `EXPLANATION.unavailable` (“Chưa cấu hình hoặc không dùng được Gemini”, lỗi tạm
  thời) và `EXPLANATION.modelUnavailable` (“Gemini không dùng được với cấu hình
  hiện tại — kiểm tra GEMINI_API_KEY hoặc đổi GEMINI_MODEL”, lỗi key/quyền/model)
  nằm ở `messages.ts` — file an toàn cho client, không kéo SDK vào bundle trình
  duyệt. `explanationErrorFor(error)` phân loại lỗi SDK thành hai thông báo sau.
- Model: `GEMINI_MODEL` (mặc định `gemini-2.5-flash`, `thinkingBudget: 0`). Nếu
  project Google chưa được cấp quyền 2.5 chỉ cần đổi biến này, không sửa code.

**Cache** (`ExplanationCache`: `questionHash` unique, `questionId`, `text`,
`createdAt`): khoá là `Question.hash` (SHA-256 của nội dung + đáp án). Sinh viên
thứ hai xem cùng câu → nhận cache, không gọi model. Giảng viên sửa đáp án →
hash đổi → giải thích mới; `Attempt` cũ vẫn mang hash cũ nên đọc đúng bản cũ.

**Trang tổng kết và bài đang làm**: giải thích đã cache được đọc **ở server**
(`explanationsByHash` trong `AttemptView`) nên hiện ngay, không cần bấm gì và
không gọi model; câu chưa có cache vẫn giữ nút **Giải thích bằng AI**.

**Duyệt đáp án** (`/admin/quizzes/<id>/review`): mỗi câu có khối **Giải thích
bằng AI** — hiện giải thích đã cache kèm dấu “đã có sẵn”, và nút **Sinh lại giải
thích** chỉ gọi model khi giảng viên bấm. Không có suy luận tự động kiểu “đáp án
này trông sai”: hệ thống không bao giờ tự gắn cờ một câu. Route
`POST /api/admin/explain` (body `{ quizId, questionId }`) kiểm tra phiên admin,
đọc câu từ đề đó, và stream đúng hợp đồng frame như `/api/explain` (`401` thiếu
phiên, `404` câu không có trong đề — lỗi mềm, tiếng Việt).

**Route** `POST /api/explain` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`):
body `{ questionId, questionHash? }`. Server tự lấy Question + câu trả lời từ
`Attempt` của cookie sinh viên (không tin hash/hay text từ trình duyệt).
Response `text/event-stream` gồm `data: {"text":…}` … `data: {"done":true}`;
lỗi mềm là `data: {"error":…}` với status `200` kèm header
`X-Explain-Status: soft-error`. `401` chưa có danh tính, `404` câu không thuộc
bài, `409` trang đã cũ (hash lệch) → panel nhắc tải lại. Client đọc bằng
`readExplanationFrames()` (`fetch` + `ReadableStream` reader) và có nút **Thử lại**.

## Kết quả sinh viên (`/admin/results`)

Trang này là nơi giảng viên nhìn cả lớp: **mọi** `Attempt` của **mọi** đề, mới
nhất trước, kể cả bài đang làm dở.

- **Bảng**: MSSV, họ tên, đề (`/q/<slug>`), lượt thứ mấy, % điểm (`—` khi chưa
  nộp), thời gian bắt đầu/nộp (giờ Việt Nam, `dd/MM/yyyy HH:mm`), trạng thái
  (**Đang làm** / **Đã nộp** / **Hết giờ — nộp tự động**). Mỗi dòng có **Chi tiết**
  và **Reset lượt**. Nhãn trạng thái và định dạng `%`/ngày đều lấy từ
  `src/lib/admin/result-format.ts`, dùng chung cho bảng, CSV, trang chi tiết và
  trang tổng kết của sinh viên (CSV và câu văn ngắn dùng “Hết giờ”).
- **Lượt thứ mấy** đếm các `Attempt` cùng `(quizId, studentId)` có `startedAt` ≤
  lượt này — nên lịch sử làm lại hiện đủ 1, 2, 3…; reset mới xoá được lịch sử đó.
- **Lọc**: chọn **Đề** (hoặc “Tất cả đề”) và gõ **MSSV** — khớp chính xác hoặc
  chỉ cần **chứa** đoạn đã gõ, không phân biệt hoa thường (`b201` tìm ra
  `B2012345`). Nút **Xoá lọc** hiện khi đang lọc.
- Bảng giới hạn **200 dòng mới nhất** (`RESULTS_PAGE_SIZE`) và nói rõ “Chỉ hiện
  200/N…”; file CSV **không** bị giới hạn, nên cứ thu hẹp bộ lọc để xem tiếp.
  Mọi truy vấn đều có `limit` — trang không bao giờ kéo cả collection vào bộ nhớ.

### Xuất CSV (`/admin/results/export.csv`)

`GET /admin/results/export.csv?quizId=…&studentId=…` dùng **đúng** bộ lọc của
bảng (nút **Xuất CSV** mang theo query string hiện tại):

- `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`;
  tên file `ket-qua-<tên đề không dấu>-<ngày>.csv` (hoặc `ket-qua-tat-ca-de-…`
  khi không lọc theo đề — dùng đúng slug của đề nếu có). Bắt đầu bằng **BOM UTF-8**
  để Excel nhận đúng tiếng Việt.- Cột: `MSSV,Họ tên,Đề,Lượt,Điểm (%),Trạng thái,Bắt đầu,Nộp bài`; dấu phẩy, dấu
  nháy kép (`"`, nhân đôi thành `""`) và xuống dòng đều được bọc nháy kép đúng
  chuẩn RFC 4180. Điểm dùng dấu phẩy thập phân kiểu Việt Nam (`33,3`) nên luôn
  được bọc nháy.
- Route tự kiểm tra cookie admin (`401` nếu thiếu) — middleware chỉ là cổng UX;
  phép kiểm tra thật nằm trong route và trong từng server action.

### Reset lượt làm

Nút **Reset lượt** (mỗi dòng) mở hộp thoại xác nhận ghi rõ **MSSV + tên + đề**.
Xác nhận sẽ **xoá mọi `Attempt` của đúng sinh viên đó trong đúng đề đó** rồi
`revalidatePath("/admin/results")`:

- Van an toàn: xoá theo cặp `(studentId, quizId)` — không có đường nào xoá cả đề
  hay cả lớp; lượt của sinh viên khác và đề khác không bị đụng tới.
- Server action kiểm tra phiên admin lại lần nữa, không tin nút trên UI.
- Sinh viên đó lại được làm từ lượt 1 (bộ đếm `maxAttempts` cũng được reset).
  Lịch sử cũ **mất** khi bấm reset — đây là thao tác có chủ đích cho sự cố kỹ
  thuật; muốn giữ lịch sử thì đừng reset, cứ để sinh viên làm lại.

### Chi tiết một lượt (`/admin/results/[attemptId]`)

Mở bằng **Chi tiết** ở bảng kết quả: hiện điểm, trạng thái, thời điểm, và **từng
câu** của bài đó — nội dung câu, đáp án sinh viên đã chọn/gõ, đáp án đúng, từng
ô trống đúng/sai với đáp án mong đợi, điểm từng câu, và **giải thích đã lưu**.

- Đọc **`questionsSnapshot` của `Attempt`**, không đọc bản đề hiện tại — giảng
  viên giải thích đúng bản đề sinh viên đã làm (user stories 71–72).
- Giải thích lấy từ cache theo `Question.hash` (`getCachedExplanation`) — trang
  **không gọi Gemini**; câu chưa từng được giải thích hiện “Chưa có giải thích
  cho câu này.”.
- Bài đang làm dở: chưa có điểm, chỉ hiện câu trả lời đã lưu.

## Kiểm thử

```bash
pnpm test        # Vitest; MongoDB trong bộ nhớ (mongodb-memory-server)
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm build       # production build (turbopack)
```

Test của ticket này:

- `src/lib/admin/results-repository.test.ts` — bảng, lọc chính xác/chứa/hoa
  thường, lượt thứ mấy, giới hạn 200, reset đúng cặp, chi tiết lượt.
- `src/lib/admin/results-csv-export.test.ts` — bọc nháy, dấu phẩy, xuống dòng,
  tên file; export cùng bộ lọc với bảng.
- `src/app/admin/results/export.csv/route.test.ts` — `text/csv`, BOM, `401`.
- `src/lib/admin/results-actions.test.ts` — reset cần phiên admin.
- `src/app/admin/results/page.test.tsx`, `[attemptId]/page.test.tsx` — bảng, bộ
  lọc, nút reset, trang chi tiết.
- `src/lib/admin/attempt-detail.test.ts` — chi tiết dùng đúng snapshot.
- `src/lib/admin/snapshot-integrity.test.ts` — **toàn vẹn snapshot**: publish v1 →
  sinh viên làm → đề bị đóng băng → upload/publish v2 → chi tiết bài cũ **và**
  trang tổng kết của sinh viên vẫn hiện nội dung + giải thích của v1.
- `src/lib/admin/result-format.test.ts` — nhãn trạng thái, `33,3%`, `dd/MM/yyyy`.
- `src/lib/admin/with-admin.test.ts` — action admin thiếu phiên trả lỗi tiếng Việt.
- `src/app/api/admin/explain/route.test.ts` — route “Giải thích bằng AI” với
  **fake Gemini client** (`useTestGeminiClient`, chỉ có tác dụng khi
  `NODE_ENV=test`): `401` thiếu phiên, `404` câu không có, sinh rồi cache, lỗi mô
  hình ra thông báo tiếng Việt.
- `src/app/admin/quizzes/[id]/review/page.test.tsx` +
  `admin-explanation.test.tsx` — giải thích đã cache được truyền sẵn vào cây
  props, nút chỉ hiện văn bản khi bấm.
- `src/lib/quiz/lifecycle-repository.delete.test.ts` — xoá đề nháp, từ chối đề đã
  publish, không xoá giải thích của đề khác.

### Smoke test thật (đã chạy)

Ngoài test tự động, ticket này được chạy tay trên `next start` với mongod thật.
Bộ khung nằm ở `scripts/smoke-t9.ts` (seed/xoá database dùng-một-lần) và
`scripts/smoke-t9-browser.ts` (Playwright + Chromium). Đây là **công cụ chạy tay
tuỳ chọn cho lập trình viên** — không chạy trên CI, không phải một phần của
`pnpm test`; hai file này cũng bị loại khỏi `tsc --noEmit` (`exclude` trong
`tsconfig.json`) để không kéo `playwright` vào bước kiểm tra kiểu của app. Các
bước đã chạy:

1. Seed một database dùng-một-lần (`moodle_quiz_smoke_t9`): 2 đề published
   (practice + exam), 5 `Attempt` (đã nộp, sai, đang làm dở; có MSSV/họ tên chứa
   dấu phẩy và nháy kép).
2. Đăng nhập `/admin/login` bằng sai mật khẩu (báo “Mật khẩu không đúng.”) rồi
   đúng; kiểm tra cookie `admin_session` là `httpOnly`.
3. `/admin/results`: thấy đủ 5 dòng, điểm `33,3%`, dòng “Đang làm”; lọc
   `studentId=b201` và lọc theo đề; **Xoá lọc**.
4. **Xuất CSV**: tải file thật — có BOM, header tiếng Việt, đúng số dòng theo bộ
   lọc, họ tên `Lê "Bình", lớp 2` được bọc `"Lê ""Bình"", lớp 2"`.
5. Mở **Chi tiết** một lượt: đủ câu, đáp án đúng, ô trống, khối giải thích đã lưu.
6. **Reset lượt** qua hộp thoại: đúng MSSV đó biến mất, sinh viên khác trong cùng
   đề và đề khác của cùng sinh viên vẫn còn; trang `/q/<slug>` vẫn mở bình thường.
7. Xoá database smoke (`dropDatabase`) sau khi xong.

## Triển khai (Atlas + Vercel)

1. Tạo cluster **Atlas** (M0 đủ dùng), Database Access một user chỉ đọc/ghi
   database của app, Network Access mở cho Vercel (`0.0.0.0/0` hoặc IP Vercel).
2. `MONGODB_URI` dạng `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/moodle_quiz`
   — nhớ tên database ở cuối URI.
3. Trên Vercel đặt `MONGODB_URI`, `ADMIN_PASSWORD`, `SESSION_SECRET`
   (`openssl rand -hex 32`), `GEMINI_API_KEY` (để trống nếu chưa muốn AI) và
   `GEMINI_MODEL` (tuỳ chọn). **Không** commit `.env.local`.
4. Deploy, mở `/admin/login`, upload đề → duyệt → publish.
5. Cookie đặt `Secure` tự động khi `NODE_ENV=production` (Vercel luôn production),
   nên phải dùng HTTPS — bản địa phương chạy `http://localhost:3000` vẫn OK.
6. Mọi trang dữ liệu là `dynamic = "force-dynamic"`, không có bước migrate: thêm
   trường mới vào schema Mongoose là xong (dữ liệu cũ đọc được với giá trị mặc
   định).

## Cấu trúc

```
src/app/                 App Router: / (danh sách đề đã publish), /q/[slug] (làm bài),
                         /q/[slug]/ket-qua (tổng kết + review từng câu),
                         /admin, /admin/login, /admin/quizzes/[id] (sửa đề + vòng đời),
                         /admin/results (bảng kết quả + lọc), /admin/results/[attemptId]
                         (chi tiết một lượt), /admin/results/export.csv (tải CSV),
                         /admin/quizzes/[id]/review (duyệt đáp án + giải thích AI),
                         /api/explain (streaming giải thích cho sinh viên),
                         /api/admin/explain (streaming giải thích khi giảng viên bấm)
src/components/ui/       shadcn/ui (preset radix-nova)
src/components/quiz/     quiz-runner (client: trạng thái, lưu, panel, phản hồi, đồng hồ,
                         nộp bài), question-content + highlight (server: markdown, shiki, ảnh)
src/lib/auth/token.ts    HMAC token dùng chung cho cookie admin và sinh viên
src/lib/admin/           mật khẩu admin, session cookie, server actions login/logout/upload,
                         lifecycle-actions (sửa đề, bật/tắt câu, publish/huỷ/lưu trữ),
                         upload.ts (đọc file + preview, gọi parser),
                         results-repository (bảng/filter/reset/chi tiết), results-csv
                         (CSV thuần + tên file), results-csv-export, results-actions (reset)
src/lib/quiz/            model Quiz + Attempt, parser Moodle, grading, repository,
                         lifecycle-repository, attempt-repository,
                         content/splitPlaceholders, markdown, slug
src/lib/gemini/          prompt thuần, ExplainClient + SDK Gemini, ExplanationCache,
                         explainQuestion, đọc frame SSE, messages (dùng cho client)
src/app/api/explain/     route handler streaming giải thích
src/app/admin/results/   bảng kết quả, trang chi tiết lượt, route export CSV, nút reset
src/components/quiz/explanation-panel.tsx  panel “Giải thích bằng AI”
src/lib/student/         session cookie sinh viên, server actions, answers (helper thuần),
                         feedback (câu chữ phản hồi), exam (helper trình bày trạng thái thi)
src/lib/db.ts            kết nối Mongoose dùng chung (đọc MONGODB_URI)
src/lib/mongodb.ts       ensureConnection + isDuplicateKeyError dùng chung cho mọi repository
src/middleware.ts        chặn mọi /admin/** khi chưa có phiên hợp lệ
src/test/                helper test: env, mongodb-memory-server
src/lib/admin/with-admin.ts  withAdmin / withAdminAction: một cổng kiểm tra phiên admin
src/lib/admin/result-format.ts  nhãn trạng thái + formatPercent/formatDate dùng chung
scripts/seed.ts          CLI pnpm seed
scripts/smoke-*          khung smoke chạy tay (Playwright), ngoài CI và ngoài typecheck
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
