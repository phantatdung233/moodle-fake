/**
 * The session check every admin server action shares.
 *
 * Middleware already gates `/admin/**` in the browser, but anyone who can POST
 * to an action (or call the CSV route) skips that gate, so each handler must
 * ask again. Kept out of the `"use server"` modules (which may only export async
 * functions) so every action imports the same wrapper.
 */
import { unstable_rethrow } from "next/navigation";
import { NO_SESSION_ERROR } from "./review-messages";
import { hasAdminSession } from "./session";

export const GENERIC_ACTION_ERROR =
  "Không thực hiện được thao tác. Kiểm tra kết nối rồi thử lại.";

/** The refusal a wrapped handler returns when nobody is signed in. */
export function noSession(): { ok: false; error: string } {
  return { ok: false, error: NO_SESSION_ERROR };
}

/**
 * Wraps an admin handler. No valid admin session → `unauthorised()` without
 * running the body; the default shape is every action's `{ ok: false, error }`,
 * and an action with a different state type passes its own (e.g. the upload
 * page's `{ error }`). A body that catches its own failures keeps its message;
 * anything it lets through becomes one generic Vietnamese message, so a DB
 * failure never reaches the browser as a stack trace.
 *
 * Next's own control flow (`redirect()`, `notFound()`) is rethrown untouched:
 * catching it here would turn a successful upload into an error state.
 */
export function withAdmin<Args extends unknown[], T, Refusal>(
  handler: (...args: Args) => Promise<T>,
  unauthorised: () => Refusal,
): (...args: Args) => Promise<T | Refusal | { ok: false; error: string }> {
  return async (...args) => {
    if (!(await hasAdminSession())) return unauthorised();
    try {
      return await handler(...args);
    } catch (error) {
      unstable_rethrow(error);
      return { ok: false as const, error: GENERIC_ACTION_ERROR };
    }
  };
}

/** `withAdmin` for the usual action shape: `{ ok: false, error: NO_SESSION_ERROR }`. */
export function withAdminAction<Args extends unknown[], T>(
  handler: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T | { ok: false; error: string }> {
  return withAdmin(handler, noSession);
}
