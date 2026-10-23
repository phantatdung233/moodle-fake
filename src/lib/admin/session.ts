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

/** Constant-time comparison of two UTF-8 strings, safe on the Edge runtime. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufferA = encoder.encode(a);
  const bufferB = encoder.encode(b);
  let difference = bufferA.length ^ bufferB.length;
  for (let i = 0; i < Math.max(bufferA.length, bufferB.length); i += 1) {
    difference |= (bufferA[i] ?? 0) ^ (bufferB[i] ?? 0);
  }
  return difference === 0;
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
 * Web Crypto instead of node:crypto so middleware can verify the cookie on the
 * Edge runtime as well as in Node.
 */
async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Mints an httpOnly session cookie whose token is `<issuedAt>.<hmac>`, so the
 * admin cookie cannot be forged without SESSION_SECRET.
 */
export async function createAdminSessionCookie(
  env: AdminAuthEnv = adminAuthEnv(),
): Promise<SessionCookie> {
  if (!env.sessionSecret) {
    throw new Error("SESSION_SECRET chưa được cấu hình");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = String(issuedAt);
  const value = `${payload}.${await sign(payload, env.sessionSecret)}`;

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

  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return false;

  const expected = await sign(payload, env.sessionSecret);
  if (!safeEqual(signature, expected)) return false;

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  return ageSeconds >= 0 && ageSeconds <= ADMIN_SESSION_MAX_AGE_SECONDS;
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
