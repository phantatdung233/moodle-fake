import { cookies } from "next/headers";
import {
  isWithinMaxAge,
  issuedAtSeconds,
  readToken,
  safeEqual,
  signToken,
} from "@/lib/auth/token";

export const ADMIN_SESSION_COOKIE = "admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export type AdminAuthEnv = {
  adminPassword: string | undefined;
  sessionSecret: string | undefined;
};

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  };
};

/** Reads the admin secrets from the process environment. */
export function adminAuthEnv(): AdminAuthEnv {
  return {
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
  };
}

/** True only when the submitted password matches the configured ADMIN_PASSWORD. */
export function isValidAdminPassword(
  submitted: string,
  env: AdminAuthEnv = adminAuthEnv(),
): boolean {
  if (!env.adminPassword || !submitted) return false;
  return safeEqual(submitted, env.adminPassword);
}

/**
 * Mints an httpOnly session cookie whose token carries the issue time and is
 * signed with SESSION_SECRET, so the admin cookie cannot be forged.
 */
export async function createAdminSessionCookie(
  env: AdminAuthEnv = adminAuthEnv(),
): Promise<SessionCookie> {
  if (!env.sessionSecret) {
    throw new Error("SESSION_SECRET chưa được cấu hình");
  }

  const value = await signToken(
    { iat: Math.floor(Date.now() / 1000) },
    env.sessionSecret,
  );

  return {
    name: ADMIN_SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    },
  };
}

/** True when the cookie carries a valid, unexpired admin session token. */
export async function readAdminSession(
  cookieValue: string | undefined,
  env: AdminAuthEnv = adminAuthEnv(),
): Promise<boolean> {
  if (!cookieValue || !env.sessionSecret) return false;

  const payload = await readToken(cookieValue, env.sessionSecret);
  if (!payload) return false;

  return isWithinMaxAge(issuedAtSeconds(payload), ADMIN_SESSION_MAX_AGE_SECONDS);
}

/**
 * True when the current request carries a valid admin session cookie. Server
 * actions must call this themselves: middleware already gates `/admin/**` in
 * the browser, but anyone who can POST to an action skips that gate.
 */
export async function hasAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

/** The cookie value that clears the admin session. */
export function clearedAdminSessionCookie(): SessionCookie {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    },
  };
}
