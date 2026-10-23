/**
 * Throwaway smoke harness for ticket #9. Not part of the app and not a test:
 * it drives the real data layer and a real Chromium against `next start` so
 * `/admin/results`, the CSV export and the reset action can be exercised the way
 * a giảng viên uses them. Uses a throwaway local database
 * (`moodle_quiz_smoke_t9`), never the dev database.
 *
 *   # terminal 1 — seed, then serve
 *   SMOKE_MONGODB_URI=mongodb://127.0.0.1:27017/moodle_quiz_smoke_t9 pnpm exec tsx scripts/smoke-t9.ts seed
 *   MONGODB_URI=mongodb://127.0.0.1:27017/moodle_quiz_smoke_t9 \
 *     ADMIN_PASSWORD=smoke-pass SESSION_SECRET=smoke-secret-0123456789abcdef \
 *     GEMINI_API_KEY= pnpm exec next start -p 3457
 *
 *   # terminal 2 — two quiz ids from the seed go into the constants below, then
 *   pnpm exec tsx scripts/smoke-t9-browser.ts
 *
 * Prints PASS/FAIL lines and exits non-zero on failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = "http://localhost:3457";
const PRACTICE_QUIZ = "6adb896980d587962283ad1d";
const EXAM_QUIZ = "6adb896980d587962283ad1e";

const results: [string, boolean, string][] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  // Use the cached Chrome for Testing build instead of downloading a browser.
  const chromePath =
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await chromium.launch({
    executablePath: existsSync(chromePath) ? chromePath : undefined,
  });
  const page: Page = await browser.newPage();

  // ── gate ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/results`, { timeout: 15_000 });
  check(
    "/admin/results without a session lands on the login page",
    new URL(page.url()).pathname === "/admin/login",
    page.url(),
  );
  // Middleware redirects every `/admin/**` request to the login page before the
  // route runs; the route itself still answers 401 for a direct call (unit test).
  const csvBlocked = await page.request.get(`${BASE}/admin/results/export.csv`, { maxRedirects: 0 });
  check(
    "export.csv without a session is refused (middleware redirect, route 401)",
    csvBlocked.status() === 307 && (csvBlocked.headers()["location"] ?? "").includes("/admin/login"),
    `${csvBlocked.status()} → ${csvBlocked.headers()["location"] ?? ""}`,
  );

  // ── login ────────────────────────────────────────────────────────────────
  // Submit the correct password first: the action answers 303 to `/admin`, so
  // `waitForURL` settles on a real navigation (a failed action stays on the
  // same URL and its result is a React state update, not a navigation).
  await page.fill("#password", "smoke-pass");
  await Promise.all([
    page.waitForURL(`${BASE}/admin`, { timeout: 8000 }),
    page.click("button[type=submit]"),
  ]);
  check("correct password opens /admin", page.url() === `${BASE}/admin`, page.url());
  const cookies = await page.context().cookies();
  const adminCookie = cookies.find((cookie) => cookie.name === "admin_session");
  check("session cookie is httpOnly", adminCookie?.httpOnly === true);

  // Log out, then try a wrong password: the form must show the Vietnamese
  // error and keep the visitor on the login page.
  await Promise.all([
    page.waitForURL(`${BASE}/admin/login`, { timeout: 8000 }),
    page.click("button:has-text('Đăng xuất')"),
  ]);
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  // Poll the DOM for the error text: the alert only exists after the action's
  // state update re-renders the form.
  const alert: string | null = await page
    .waitForFunction(() => document.querySelector("[role=alert]")?.textContent ?? null, undefined, {
      timeout: 8000,
    })
    .then((handle) => handle.jsonValue() as Promise<string | null>)
    .catch(() => null);
  check(
    "wrong password shows a Vietnamese error and stays put",
    (alert ?? "").includes("Mật khẩu không đúng.") && new URL(page.url()).pathname === "/admin/login",
    `${alert ?? ""} @ ${new URL(page.url()).pathname}`,
  );

  await page.fill("#password", "smoke-pass");
  await Promise.all([
    page.waitForURL(`${BASE}/admin`, { timeout: 8000 }),
    page.click("button[type=submit]"),
  ]);
  check("logging in again works after a failed attempt", page.url() === `${BASE}/admin`);

  // ── results table ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/results`);
  const body = await page.textContent("main");
  check("table shows a MSSV", body?.includes("B2012345") ?? false);
  check("table shows a name with a quoted comma", body?.includes('Lê "Bình", lớp 2') ?? false);
  check("table shows a score", body?.includes("33,3%") ?? false);
  check("table shows an in-progress row", body?.includes("Đang làm") ?? false);
  const rows = await page.locator("tbody tr").count();
  check("table lists every attempt", rows === 5, `${rows} rows`);

  await page.fill("#filter-student", "b201");
  await page.click("button:has-text('Lọc')");
  await page.waitForURL(/studentId=b201/, { timeout: 8000 });
  const filteredBody = await page.textContent("tbody");
  check("studentId filter keeps B2012345", filteredBody?.includes("B2012345") ?? false);
  check("studentId filter drops B2099999", !(filteredBody?.includes("B2099999") ?? true));
  check("'Xoá lọc' appears while filtering", (await page.locator("a:has-text('Xoá lọc')").count()) === 1);

  await page.click("a:has-text('Xoá lọc')");
  await page.waitForURL(`${BASE}/admin/results`, { timeout: 8000 });
  await page.selectOption("#filter-quiz", EXAM_QUIZ);
  await page.click("button:has-text('Lọc')");
  await page.waitForURL(/quizId=/, { timeout: 8000 });
  const quizFilteredBody = await page.textContent("tbody");
  check(
    "quizId filter keeps only the exam quiz",
    (quizFilteredBody?.includes("Kiểm tra giữa kỳ") ?? false) &&
      !(quizFilteredBody?.includes("B2099999") ?? true),
  );

  // ── CSV through a real download ──────────────────────────────────────────
  await page.goto(`${BASE}/admin/results?quizId=${PRACTICE_QUIZ}&studentId=2012345`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }),
    page.click("a:has-text('Xuất CSV')"),
  ]);
  const path = await download.path();
  check("CSV download has a .csv name", download.suggestedFilename().endsWith(".csv"), download.suggestedFilename());
  const csv = path && existsSync(path) ? readFileSync(path) : Buffer.from([]);
  check("CSV starts with a UTF-8 BOM", csv.subarray(0, 3).toString("hex") === "efbbbf");
  const text = csv.subarray(3).toString("utf8");
  const lines = text.trim().split("\r\n");
  check("CSV header row is Vietnamese", text.startsWith("MSSV,Họ tên,Đề,Lượt,Điểm (%),Trạng thái,Bắt đầu,Nộp bài\r\n"));
  check("CSV has exactly the filtered rows", lines.length === 3, `${lines.length - 1} rows`);
  check("CSV has no other student", !text.includes("B2099999"));

  const allCsv = await (await page.request.get(`${BASE}/admin/results/export.csv`)).text();
  check("CSV escapes quotes and commas", allCsv.includes('"Lê ""Bình"", lớp 2"'));

  // ── attempt detail ───────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/results?studentId=B2012345`);
  await page.locator("a:has-text('Chi tiết')").first().click();
  await page.waitForURL(/\/admin\/results\/[a-f0-9]{24}/, { timeout: 8000 });
  const detail = await page.textContent("main");
  check("detail shows the student", detail?.includes("B2012345") ?? false);
  check("detail reviews each question", (detail?.includes("Mã Q001") ?? false) && (detail?.includes("Mã Q003") ?? false));
  check("detail shows the correct answer", detail?.includes("đáp án đúng") ?? false);
  check("detail shows the stored-explanation slot", detail?.includes("Chưa có giải thích") ?? false);

  // ── reset through the confirm dialog + server action ─────────────────────
  await page.goto(`${BASE}/admin/results`);
  const binhRow = page.locator("tbody tr", { hasText: "B2099999" });
  await binhRow.locator("button:has-text('Reset lượt')").click();
  const dialog = page.locator("[role=alertdialog]");
  check("reset asks for confirmation", (await dialog.count()) === 1);
  check("dialog names the student and the quiz", (await dialog.textContent())?.includes("B2099999") ?? false);
  await dialog.locator("button:has-text('Reset lượt')").click();
  await page.waitForFunction(() => !document.body.innerText.includes("B2099999"), undefined, { timeout: 8000 });
  const afterReset = await page.textContent("tbody");
  check("reset removes the target's attempts", !(afterReset?.includes("B2099999") ?? true));
  check("reset keeps other students in the same quiz", afterReset?.includes("B3000001") ?? false);
  check("reset keeps the same student's other quiz", afterReset?.includes("Kiểm tra giữa kỳ") ?? false);

  const stillThere = await (await page.request.get(`${BASE}/admin/results?quizId=${EXAM_QUIZ}`)).text();
  check("the exam attempt survives the reset", stillThere.includes("B2012345"));

  // ── student-facing pages still work after the reset ──────────────────────
  await page.goto(`${BASE}/q/python-co-ban`);
  check("the practice quiz page still opens", (await page.textContent("main"))?.includes("Vào làm bài") ?? false);

  await browser.close();
}

main()
  .catch((error) => {
    console.error("SMOKE FAILED", error);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
  });
