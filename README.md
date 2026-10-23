# Moodle Quiz Platform

Web app tiếng Việt cho sinh viên làm bài trắc nghiệm Python xuất từ Moodle, và cho
giảng viên duyệt lại đáp án trước khi publish. Spec đầy đủ: GitHub issue #1
(bản sao trong `.scratch/moodle-quiz-platform/spec.md`).

Ticket hiện tại (Ticket 4) gồm: khung Next.js 15 App Router, đăng nhập admin
(`/admin/login`, cookie httpOnly), middleware chặn `/admin/**`, **upload file
Moodle JSON → đề nháp** với màn hình preview (số câu theo loại, số câu cần duyệt,
lỗi parse), danh sách đề ở `/admin`, **parser thuần** biến file Moodle thành
`Question` chuẩn hoá (`src/lib/quiz/parser.ts`), và **module chấm điểm thuần**
(`src/lib/quiz/grading.ts`).

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
`mongodb-memory-server`; các package này đã nằm trong `allowBuilds` của
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
| `SESSION_SECRET` | Bí mật HMAC để ký cookie phiên admin. Tạo bằng `openssl rand -hex 32`. |
| `GEMINI_API_KEY` | Key Google Gemini cho phần giải thích (chưa dùng ở ticket này). |
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
  và số lượt làm. Chưa có model `Attempt` nên số lượt làm luôn là 0.

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

## Cấu trúc

```
src/app/                 App Router: trang chủ, /admin, /admin/login, /admin/quizzes/[id]
src/components/ui/       shadcn/ui (preset radix-nova)
src/lib/admin/           mật khẩu admin, session cookie, server actions login/logout/upload,
                         upload.ts (đọc file + preview, gọi parser)
src/lib/quiz/            model Quiz (Mongoose), parser Moodle, repository (tạo/đọc Quiz), slug
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

## Ghi chú

- UI tiếng Việt cứng, tối ưu mobile; không có i18n.
- Cookie phiên admin là `<issuedAt>.<HMAC-SHA256>` ký bằng `SESSION_SECRET`,
  `httpOnly`, `SameSite=Lax`, `Secure` khi production.
