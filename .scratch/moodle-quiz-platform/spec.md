# Spec: Moodle Quiz Platform

Status: `ready-for-agent`

## Problem Statement

Giảng viên có một file JSON đề trắc nghiệm Python xuất từ Moodle (`moodle_quiz_merged.json`, 180 câu) nhưng không có chỗ cho sinh viên làm bài. Họ phải upload file này lên đâu đó, sinh viên vào làm 180 câu trên điện thoại/laptop, và sau mỗi câu sinh viên cần **hiểu vì sao mình sai** — hiện tại không có công cụ nào làm được việc đó.

File dữ liệu có nhiều vấn đề thực tế: 88 câu `notyetanswered` (không có đáp án đúng nào), 10 câu `multianswer` có ô trống `blank.value = ""`, 2 câu có đáp án rác (Q143 = `fruits[0]`, Q179 = `"d"`), và một số câu có đáp án `selected: true` sai về kiến thức Python (Q144, Q153, Q156, Q165…). Nếu tin nguyên file thì gần nửa đề không chấm được hoặc chấm sai. Giảng viên cần một chỗ để **duyệt lại đáp án trước khi sinh viên thi**.

## Solution

Một web app Next.js tiếng Việt, responsive cho điện thoại:

- **Trang chủ** `/` liệt kê các đề đã publish. Sinh viên vào `/q/<slug>`.
- **Sinh viên** nhập MSSV + họ tên (không mật khẩu), làm 1 câu/màn hình với thanh tiến trình và panel danh sách câu. Câu trả lời được lưu ngay vào MongoDB nên reload/mất mạng không mất bài. Vào lại giữa bài thì tiếp tục attempt đang làm.
- **Chế độ luyện tập (practice)**: trả lời xong mỗi câu là thấy ngay đúng/sai, đáp án đúng, và giải thích do Gemini sinh (stream). Câu điền khuyết: ô sai tô đỏ, hiện rõ từng ô gõ gì và đáp án đúng là gì. Câu đã trả lời bị khoá.
- **Chế độ kiểm tra (exam)**: ẩn đáp án và giải thích tới khi nộp; có giới hạn thời gian (auto-submit khi hết giờ) và số lần làm; giải thích hiện trên trang tổng kết.
- **Trang tổng kết** sau khi nộp: % điểm, số câu đúng/sai/bỏ trống, xem lại từng câu kèm đáp án + giải thích.
- **Trang quản trị** (1 admin, password trong env): upload JSON → preview lỗi → tạo đề nháp; trang “Duyệt đáp án” riêng cho câu `needs_review`; chọn câu đưa vào đề; publish; xem bảng kết quả sinh viên, lọc, export CSV, reset lượt làm.

## User Stories

### Upload & tạo đề

1. As a giảng viên, I want to upload file `moodle_quiz_merged.json` trực tiếp trên trang admin, so that tôi không phải nhập lại 180 câu bằng tay.
2. As a giảng viên, I want to xem preview sau khi parse (số câu theo loại, số câu thiếu đáp án, số câu lỗi), so that tôi biết file này có đáng dùng trước khi tạo đề.
3. As a giảng viên, I want to thấy danh sách lỗi parse chi tiết (ID câu, lý do), so that tôi biết đúng câu nào Moodle làm hỏng.
4. As a giảng viên, I want to upload một file JSON rồi tạo ra một đề **nháp** mới, so that tôi chỉnh sửa thoải mái trước khi public.
5. As a giảng viên, I want to đặt tên và slug cho đề, so that sinh viên vào được bằng URL dễ đọc như `/q/python-co-ban`.
6. As a giảng viên, I want to slug tự sinh từ tên nhưng sửa được và phải là duy nhất, so that không có hai đề trùng URL.
7. As a giảng viên, I want to chọn chế độ `practice` hoặc `exam` cho từng đề, so that tôi dùng được cả để ôn tập lẫn để kiểm tra.
8. As a giảng viên, I want to đặt `timeLimit` (phút) và `maxAttempts` cho đề exam, so that sinh viên làm trong khung giờ và số lần tôi quy định.
9. As a giảng viên, I want to bật/tắt từng câu trong đề, so that tôi có thể ra đề 40/180 câu tùy buổi học.
10. As a giảng viên, I want to upload file lần nữa để tạo đề mới mà không ảnh hưởng đề đang chạy, so that cập nhật đề không phá bài đang có người làm.
11. As a giảng viên, I want to xem danh sách các đề (nháp/published/archived) kèm số câu, số lượt làm, so that tôi quản lý được nhiều đề.
12. As a giảng viên, I want to xoá một đề nháp, so that đề thử không nằm lại rác.

### Duyệt đáp án

13. As a giảng viên, I want to mọi câu không có đáp án đúng sau khi parse được đánh dấu `needs_review` tự động, so that không câu nào lọt vào đề công khai mà không chấm được.
14. As a giảng viên, I want to thấy riêng một trang “Duyệt đáp án” chỉ chứa câu `needs_review`, so that tôi không phải lật 180 câu để tìm câu cần sửa.
15. As a giảng viên, I want to khi duyệt xong một câu thì hệ thống tự chuyển sang câu kế tiếp, so that tôi duyệt 88 câu nhanh.
16. As a giảng viên, I want to chọn đáp án đúng cho câu `multichoice` bằng cách tick một hoặc nhiều lựa chọn, so that hỗ trợ cả câu chọn nhiều đáp án.
17. As a giảng viên, I want to nhập đáp án đúng cho từng ô trống của câu `multianswer`, so that câu điền khuyết chấm được.
18. As a giảng viên, I want to thấy tiến độ duyệt dạng “X/180 câu đã có đáp án”, so that tôi biết còn bao xa mới publish được.
19. As a giảng viên, I want to đáp án rác trong file (Q143 `fruits[0]`, Q179 `"d"`) được reset về `needs_review` thay vì tự sửa, so that tôi tự quyết đáp án đúng.
20. As a giảng viên, I want to sửa đáp án của câu **đã duyệt** khi đề còn nháp, so that tôi đổi ý được.
21. As a giảng viên, I want to xem giải thích/cảnh báo từ Gemini khi đề và đáp án có vẻ mâu thuẫn (Q066, Q070), so that tôi biết câu nào cần kiểm tra lại.
22. As a giảng viên, I want to giữ nguyên đáp án `selected: true` dù nó sai kiến thức, so that đề giữ đúng nguyên bản Moodle của tôi.
23. As a giảng viên, I want to xoá một câu khỏi đề, so that câu hỏng hẳn không cần duyệt.

### Publish & khoá đề

24. As a giảng viên, I want to publish đề khi tôi đã sẵn sàng, so that sinh viên bắt đầu vào làm được.
25. As a giảng viên, I want to khi publish hệ thống cảnh báo “N câu chưa có đáp án sẽ bị loại”, so that tôi biết trước đề thực tế có bao nhiêu câu.
26. As a giảng viên, I want to publish được cả khi còn câu chưa duyệt, so that tôi không bị chặn nếu chỉ cần chạy 40 câu đã duyệt.
27. As a giảng viên, I want to câu chưa có đáp án bị tự loại khỏi đề đã publish, so that sinh viên không bao giờ gặp câu không chấm được.
28. As a giảng viên, I want to đề đã publish bị đóng băng (không sửa câu/đáp án/chế độ/thời gian), so that không ai bị đổi đề giữa chừng.
29. As a giảng viên, I want to huỷ publish được nếu chưa ai bắt đầu làm, so that tôi sửa được lỗi mình vừa phát hiện.
30. As a giảng viên, I want to khi đã có người làm thì không huỷ publish được, chỉ archive được, so that kết quả cũ không bị ảnh hưởng.
31. As a giảng viên, I want to archive một đề đã đóng, so that nó không còn xuất hiện cho sinh viên mới.
32. As a giảng viên, I want to sinh viên đang làm bài vẫn tiếp tục được với bản đề lúc họ vào, so that đổi đề phía admin không làm hỏng bài của họ.

### Làm bài (sinh viên)

33. As a sinh viên, I want to xem danh sách đề đang mở trên trang chủ, so that tôi chọn đúng bài cần làm.
34. As a sinh viên, I want to nhập MSSV và họ tên khi bắt đầu, so that kết quả được ghi cho tôi mà không cần nhớ mật khẩu.
35. As a sinh viên, I want to vào lại bằng cùng MSSV thì tiếp tục đúng bài đang làm dở, so that tôi không phải làm lại từ đầu.
36. As a sinh viên, I want to làm bài trên điện thoại mà không phải zoom, so that tôi học mọi lúc mọi nơi.
37. As a sinh viên, I want to xem mỗi lúc một câu với thanh tiến trình “Câu 12/180”, so that tôi không bị ngợp bởi trang dài 180 câu.
38. As a sinh viên, I want to mở panel danh sách câu và nhảy tới câu bất kỳ, so that tôi quay lại câu đã bỏ dở.
39. As a sinh viên, I want to thấy câu nào đã trả lời / chưa trả lời / đã khoá trong panel, so that tôi biết còn câu nào.
40. As a sinh viên, I want to câu trả lời được lưu ngay khi chọn/gõ, so that mất mạng hay reload không mất bài.
41. As a sinh viên, I want to xem câu hỏi có code Python với thụt lề đúng, syntax highlight, so that tôi đọc được chương trình.
42. As a sinh viên, I want to xem hình ảnh đính kèm của câu hỏi (Q020, Q114), so that tôi thấy đủ đề.
43. As a sinh viên, I want to ô điền khuyết trong câu hiển thị đúng vị trí của `[[1]]`…`[[7]]`, so that tôi biết chỗ nào cần gõ gì.
44. As a sinh viên, I want to ở chế độ luyện tập thấy ngay đúng/sai + đáp án đúng sau mỗi câu, so that tôi học được ngay lúc làm.
45. As a sinh viên, I want to ở chế độ kiểm tra không bị lộ đáp án và giải thích cho tới khi nộp, so that bài kiểm tra công bằng.
46. As a sinh viên, I want to thấy đồng hồ đếm ngược trong chế độ kiểm tra có `timeLimit`, so that tôi biết mình còn bao lâu.
47. As a sinh viên, I want to bài tự động nộp khi hết giờ, so that tôi không mất điểm vì quên bấm nộp.
48. As a sinh viên, I want to câu đã trả lời và xem đáp án thì không sửa lại được, so that kết quả phản ánh đúng lần trả lời đầu tiên.
49. As a sinh viên, I want to bấm “Nộp bài” có hộp thoại xác nhận, so that tôi không nộp nhầm.
50. As a sinh viên, I want to câu bỏ trống tính 0 điểm, so that tôi biết phải cố hết mọi câu.
51. As a sinh viên, I want to làm lại bài trong chế độ luyện tập không giới hạn, so that tôi ôn được nhiều lần.

### Chấm điểm & tổng kết

52. As a sinh viên, I want to câu trắc nghiệm đúng được 1 điểm, sai 0, so that dễ hiểu.
53. As a sinh viên, I want to câu điền khuyết được điểm theo tỉ lệ ô đúng (2/3 ô = 0.67), so that tôi được ghi nhận phần đúng.
54. As a sinh viên, I want to thấy điểm tổng dạng %, so that tôi biết mình làm được bao nhiêu phần.
55. As a sinh viên, I want to ở câu điền khuyết thấy tô đỏ đúng ô gõ sai và đáp án đúng từng ô, so that tôi biết mình gõ sai chỗ nào.
56. As a sinh viên, I want to sau khi nộp thấy số câu đúng/sai/bỏ trống, so that tôi biết mất điểm ở đâu.
57. As a sinh viên, I want to xem lại từng câu sau khi nộp kèm đáp án và giải thích, so that tôi ôn lại toàn bài.
58. As a sinh viên, I want to không xem được kết quả của sinh viên khác, so that dữ liệu của tôi là riêng tư.
59. As a sinh viên, I want to bị chặn làm lượt mới khi đã hết `maxAttempts`, so that giới hạn của giảng viên được tôn trọng.

### Giải thích bằng Gemini

60. As a sinh viên, I want to nhận giải thích do AI sinh bằng tiếng Việt, ngắn gọn, so that tôi hiểu vì sao đáp án đó đúng/sai.
61. As a sinh viên, I want to giải thích hiện dần (streaming) thay vì chờ xong, so that tôi không phải đợi lâu.
62. As a sinh viên, I want to được giải thích ở cả câu đúng và câu sai, so that tôi hiểu sâu hơn cả khi đoán đúng.
63. As a sinh viên, I want to với câu điền khuyết, giải thích dựa trên toàn bộ các ô, so that tôi biết cả câu làm thiếu gì.
64. As a sinh viên, I want to khi đáp án ghi nhận trong đề sai kiến thức, Gemini được nói thẳng điều đó, so that tôi không học kiến thức sai.
65. As a sinh viên, I want to giải thích câu đã có cache hiện ra gần như ngay, so that lần sau tôi không phải chờ.
66. As a sinh viên, I want to thấy thông báo “chưa cấu hình Gemini” thay vì trang vỡ, so that tôi vẫn làm bài được dù server thiếu key.

### Quản trị kết quả

67. As a giảng viên, I want to xem bảng kết quả gồm MSSV, họ tên, đề, lượt thứ mấy, % điểm, thời gian bắt đầu/nộp, trạng thái, so that tôi nắm được tình hình lớp.
68. As a giảng viên, I want to lọc bảng theo đề và theo MSSV, so that tôi tìm nhanh một sinh viên.
69. As a giảng viên, I want to export CSV kết quả, so that tôi nhập vào Excel để chấm điểm tổng kết.
70. As a giảng viên, I want to reset lượt làm của một sinh viên cho một đề, so that em đó được làm lại khi có sự cố.
71. As a giảng viên, I want to xem chi tiết một lượt làm từng câu, so that tôi giải thích được với sinh viên.
72. As a giảng viên, I want to lịch sử lượt làm cũ **không bị xoá** khi sinh viên làm lại, so that tôi đối chiếu được quá trình.
73. As a giảng viên, I want to trang admin chỉ vào được khi có password đúng, so that người ngoài không upload/xem được.
74. As a giảng viên, I want to phiên đăng nhập admin lưu bằng cookie httpOnly, so that không lộ bằng JS phía browser.
75. As a giảng viên, I want to đăng xuất admin, so that máy dùng chung không bị người khác vào.

### Dữ liệu & vận hành

76. As a developer, I want to `pnpm seed` nạp `moodle_quiz_merged.json` thành một đề nháp, so that tôi test được ngay sau khi cài.
77. As a developer, I want to `README` + `.env.example` nêu rõ biến môi trường, so that deploy Atlas/Vercel về sau không mò.
78. As a developer, I want to lỗi Gemini/DB được báo mềm trên UI, so that người dùng không thấy stack trace.
79. As a developer, I want to không phải chạy migration khi thêm trường mới, so that schema linh hoạt khi còn prototype.

## Implementation Decisions

### Stack

- **Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui**. App Router server components + server actions cho mọi mutation; streaming giải thích là route handler.
- **pnpm** là package manager duy nhất.
- **Mongoose** cho MongoDB; dev chạy `mongod` local, prod dùng `MONGODB_URI` (Atlas).
- **UI tiếng Việt cứng**, không i18n framework. Responsive tối ưu mobile.
- **Render markdown + syntax highlight** cho nội dung câu hỏi (94/180 câu có khối code nhiều dòng). Sanitize HTML sau render.
- Deploy target: Vercel + Atlas, nhưng v1 chạy local; không có Docker compose.

### Domain model

Đề (`Quiz`) chứa **câu hỏi nhúng** (không tách collection `Question`). 180 câu/đề nên nhúng là hợp lý, và cần **snapshot** trong attempt.

Tên domain dùng xuyên suốt spec, code, test:

- **Quiz** — đề: `title`, `slug` (unique), `mode` (`practice` | `exam`), `timeLimit?` (phút), `maxAttempts?`, `status` (`draft` | `published` | `archived`), `questions[]`, `version`, `publishedAt`
- **Question** — `id` (Q001…Q180 từ Moodle), `no`, `type` (`multichoice` | `multianswer`), `content` (chuỗi gốc Moodle, có `[[n]]`), `options[]` `{ key, text, correct: boolean }`, `blanks[]` `{ name, acceptedAnswer }`, `images[]`, `enabled`, `status` (`needs_review` | `ready`), `hash` (hash nội dung + đáp án), `explanation?`
- **Attempt** — `studentId` (MSSV), `studentName`, `quizId`, `quizVersion`, `mode`, `status` (`in_progress` | `submitted` | `expired`), `startedAt`, `submittedAt?`, `deadline?`, `questionsSnapshot[]`, `answers[]` `{ questionId, selectedOptionKeys[], blankValues[], revealed: boolean, graded }`, `result?` `{ total, perQuestion[] }`
- **ExplanationCache** — `questionHash`, `questionId`, `text`, `createdAt`

**Decision: `multichoice` lưu `correct: boolean` trên từng option**, tức hỗ trợ nhiều đáp án đúng tự nhiên. Không hardcode "đúng 1 đáp án".

**Decision: `multianswer` lưu `acceptedAnswer` đơn (không phải mảng biến thể)**. Chấm dựa trên chuẩn hoá (trim, gộp khoảng trắng, lowercase). Biến thể do người duyệt không cần nhập ở v1.

**Decision: câu đáp án rác Q143/Q179** → parser đánh `needs_review` khi đáp án của `multianswer` không khớp pattern code của đề; nhưng **không tự sinh đáp án**. Riêng điều này là heuristic — xem Further Notes.

**Decision: câu đáp án sai kiến thức** (Q144, Q153, Q156, Q165…) → giữ nguyên `correct` từ Moodle, không block; Gemini được yêu cầu nói thẳng nếu đáp án ghi nhận sai.

### Parser / upload

- Một module parser thuần: nhận JSON đã `JSON.parse` → `{ quiz: { questions, stats }, errors }`.
- Moodle → internal: `options[].selected` → `options[].correct`; `blanks[].value` → `blanks[].acceptedAnswer`. `images[]` lưu nguyên URL (không tải về CDN ở v1).
- Đếm `stats`: số câu theo loại, số câu không có đáp án, số câu `needs_review`, số câu có đáp án rỗng.
- `errors[]`: `{ questionId, reason }` — ví dụ `multichoice` không có `selected: true` nào, `multianswer` không có blank.
- Upload qua trang admin (server action nhận `FormData` file) → tạo `Quiz` mới với `status: draft`. Không cho upload JSON sai cấu trúc top-level (phải là array).
- Upload lần nữa tạo đề **mới**, không GHI đè đề cũ.

### Publish state machine

```
draft ──publish──> published ──archive──> archived
  ▲                   │
  └──unpublish────────┘  (chỉ khi chưa có attempt nào)
```

- `publish`: lọc `questions` còn `enabled && status === 'ready'`, nếu rỗng thì chặn. Hiện cảnh báo số câu bị loại trước khi xác nhận.
- `published`: **đóng băng** — không sửa `questions`, `mode`, `timeLimit`, `maxAttempts`, `slug`; chỉ `archive`. Server action chặn ở tầng thay đổi trạng thái, không chỉ ẩn UI.
- `unpublish`: chỉ khi đếm `Attempt` theo `quizId` = 0.
- `archive`: đề không hiện cho sinh viên mới; attempt cũ vẫn đọc được.
- Attempt ghi `quizVersion` + `questionsSnapshot` → nếu admin publish bản mới, người đang làm tiếp tục với bản cũ.

### Làm bài

- URL: `/q/<slug>` → nếu chưa có cờ định danh thì form MSSV + họ tên → tạo/tiếp tục `Attempt`.
- Danh tính sinh viên nằm trong một cookie httpOnly riêng (không phải session admin), chứa `studentId` + `attemptId`; server kiểm tra để không xem được attempt của người khác.
- **Practice**: mỗi câu có nút “Xem đáp án”/tự reveal sau khi trả lời → đúng/sai, đáp án đúng, giải thích stream; câu đó khoá (`revealed: true`).
- **Exam**: không reveal cho tới khi submit; hiện countdown nếu có `timeLimit`; auto-submit khi hết giờ; `maxAttempts` kiểm tra lúc tạo attempt.
- **Lưu ngay từng câu**: server action `saveAnswer` sau mỗi thay đổi (debounce ở client cho ô điền khuyết).
- **Chấm khi nộp** (không chấm chạy liên tục): `submitAttempt` chạy một lần, lưu `result`.
- Câu bỏ trống = 0 điểm.

### Chấm điểm

- `multichoice`: tập key được chọn **phải trùng khít** tập key `correct` → 1, ngược lại 0.
- `multianswer`: `correctBlanksCount / totalBlanks` (vòng 0.01), mỗi ô so `normalizeBlank(value)` với `normalizeBlank(acceptedAnswer)`.
- `normalizeBlank`: `trim`, gộp mọi khoảng trắng liên tiếp thành 1, lowercase. Không bỏ dấu tiếng Việt (đáp án đa số là code).
- Tổng: `sum(score) / questionCount * 100`, hiển thị % (0 chữ số thập phân, hoặc 1 nếu cần — chốt 1 chữ số thập phân).
- Trang tổng kết: đúng/sai/chưa trả lời, mỗi câu kèm đáp án sinh viên đã chọn + đáp án đúng + giải thích.

### Gemini

- Server-side `gemini-2.5-flash`, stream qua route handler (SSE/chunked). Key `GEMINI_API_KEY` từ env.
- Prompt được build bởi hàm thuần: chứa nội dung câu, lựa chọn, đáp án đúng, câu trả lời của sinh viên, yêu cầu tiếng Việt ngắn gọn, yêu cầu được nói nếu đáp án ghi nhận sai, yêu cầu với `multianswer` giải thích theo cả câu.
- Cache theo `Question.hash` (hash nội dung + đáp án); hash đổi khi admin sửa → giải thích mới. Cache nằm trong `Question.explanation` + bảng `ExplanationCache` theo hash (để attempt cũ vẫn thấy giải thích của bản cũ).
- Topic hiện đúng sai/đáp án **không** phụ thuộc Gemini: đó là kết quả chấm cục bộ; Gemini chỉ sinh giải thích.
- Không rate-limit ở v1; lỗi thiếu key → UI báo “Chưa cấu hình Gemini”, phần chấm điểm vẫn hoạt động.

### Admin

- 1 tài khoản admin; password hash (scrypt/bcrypt) so với `ADMIN_PASSWORD_HASH` (hoặc `ADMIN_PASSWORD` cho dev) trong `.env.local`.
- Session: cookie httpOnly chứa token có HMAC `SESSION_SECRET`, middleware chặn mọi route `/admin/**` ngoài `/admin/login`.
- Trang: `/admin` (danh sách đề), `/admin/quizzes/[id]` (chi tiết: sửa nháp, chọn câu, publish/unpublish/archive), `/admin/quizzes/[id]/review` (duyệt đáp án), `/admin/results` (bảng kết quả + lọc + CSV + reset), `/admin/results/[attemptId]` (chi tiết lượt làm).
- Chỉ cho **sửa nội dung câu + xoá câu khỏi đề** khi `draft`; không tạo câu mới từ tay.

### Seed & env

- `pnpm seed` đọc `moodle_quiz_merged.json`, chạy parser, tạo 1 đề nháp “Python cơ bản”.
- `.env.example`: `MONGODB_URI`, `ADMIN_PASSWORD` (dev), `SESSION_SECRET`, `GEMINI_API_KEY`.
- `git init` + commit đầu tiên đã có; `.gitignore` không commit `.env*`, `node_modules`, `.next`.

## Testing Decisions

**Good test**: chỉ assert hành vi quan sát được từ ngoài module (input → output), không assert helper nội bộ, không mock những thứ không phải biên hệ thống. Test phải đọc được như mô tả nghiệp vụ bằng ngôn ngữ domain (Quiz, Question, Attempt, blank, option).

**Seams (4, đã chốt):**

1. **Parser** — `parseQuizJson(rawJson)` → `{ questions, stats, errors }`.
   - Nuôi bằng `moodle_quiz_merged.json` thật: 180 câu vào, 180 câu ra; đếm đúng 161 `multichoice` + 19 `multianswer`; ít nhất 88 câu `needs_review`; Q143/Q179 nằm trong `needs_review`; Q066/Q070 giữ nguyên nội dung (không auto-sửa); `errors` nêu đúng câu `multichoice` không có đáp án.
   - Fixture nhỏ: mỗi loại câu 1 cái để test map `selected` → `correct`, `value` → `acceptedAnswer`, `[[n]]` giữ nguyên.
2. **Chấm điểm** — `gradeAnswer(question, answer)` → `{ correct, score, perBlank? }`; `gradeAttempt(quiz, answers)` → `{ total, perQuestion }`.
   - MC: chọn đúng → 1; bỏ trống → 0; chọn thiếu 1 trong 2 đáp án đúng → 0.
   - Multianswer: 3 ô, đúng 2 → 0.67; đúng hết → 1; sai hết → 0.
   - `normalizeBlank`: `" While:"` = `"while:"`; `"a  b"` = `"a b"`; `"Đúng"` ≠ `"dung"`.
3. **Prompt Gemini** — `buildExplanationPrompt(question, studentAnswer, correctAnswer)` → string.
   - Chứa nội dung câu + đề; chứa đáp án đúng; chứa câu trả lời của sinh viên; yêu cầu trả lời tiếng Việt; yêu cầu nói thẳng nếu đề sai; với `multianswer` liệt kê mọi ô.
4. **Integration layer (server actions / repository)** — với `mongodb-memory-server`:
   - Upload tạo Quiz `draft`, không đụng đề cũ.
   - `publish` loại câu `needs_review`, đề còn 0 câu ready thì báo lỗi.
   - `published` chặn mọi sửa; `unpublish` chặn khi có Attempt.
   - Hai Attempt cùng MSSV + quiz: lần 2 tiếp tục attempt `in_progress` chứ không tạo mới.
   - `submitAttempt` chỉ chấm một lần, `maxAttempts` chặn attempt thứ 3.

**Không test**: Gemini API thật, streaming transport (test prompt builder thay), UI component (không e2e Playwright ở v1), CSS.

**Prior art**: repo chưa có code — đây là bộ test đầu tiên. Dùng Vitest + `mongodb-memory-server`; test file đặt cạnh module nguồn theo domain (parser, grading, gemini, server actions).

## Out of Scope

- Câu hỏi loại khác `multichoice` / `multianswer` (shortanswer, essay, matching, drag-and-drop…).
- Admin tạo câu hỏi mới từ tay; soạn đề trong WYSIWYG.
- Nhiều tài khoản admin, phân quyền, đăng nhập sinh viên bằng mật khẩu/email/OAuth.
- i18n / đa ngôn ngữ UI.
- Upload ảnh lên Storage/CDN; ảnh chỉ lưu URL từ Moodle.
- Chấm điểm tay (override điểm sau khi nộp); chấm partial cho `multichoice` chọn nhiều.
- Xáo trộn câu/đáp án; nhóm câu; chấm theo độ khó.
- Rate limit Gemini, tracking chi phí token, multi-model fallback.
- E2E Playwright, CI/CD, Docker compose, việc deploy production thật.
- Anti-cheat (chặn tab khác, copy/paste, proctoring).

## Further Notes

- **Heuristic phát hiện đáp án rác**: chỉ Q143/Q179 lộ rõ vì đáp án (`fruits[0]`, `"d"`) không liên quan đề. Parser sẽ coi đáp án `multianswer` là đáng ngờ khi nội dung đề không chứa từ/cấu trúc mà đáp án nhắc tới; cách chắc chắn nhất là **luôn** đánh `needs_review` cho Q143/Q179 qua danh sách ID đã biết, còn heuristic chỉ là phương án dự phòng. Chấp nhận cách theo danh sách ID.
- File hiện có **94 câu nhiều dòng** → markdown + highlight có ảnh hưởng đến hiển thị. Nên chuẩn hoá backtick: hiện file không có code fence, chỉ là text nhiều dòng, nên renderer cần phát hiện khối logic bằng thụt lề/vòng dòng thay vì chỉ tin markdown.
- **`.opencode/skills/`** đang bị untracked; quyết định có commit hay giữ local nên chốt trước commit đầu tiên về tính năng.
- Repo GitHub `phantatdung233/moodle-fake`, mặc định public, chưa có branch — commit đầu tiên sẽ tạo `main`.
