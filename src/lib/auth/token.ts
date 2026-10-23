/**
 * Signed tokens shared by the admin session and the student identity cookie.
 *
 * Web Crypto instead of node:crypto so middleware can verify a cookie on the
 * Edge runtime as well as in Node. No `node:` imports here on purpose.
 *
 * Wire format: `<payload>.<hmac>`, where the payload is the base64url-encoded
 * JSON object the caller supplies and `<hmac>` is the hex HMAC-SHA256 of the
 * *payload segment* as written.
 */

const encoder = new TextEncoder();

/** Constant-time comparison of two UTF-8 strings. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = encoder.encode(a);
  const bufferB = encoder.encode(b);
  let difference = bufferA.length ^ bufferB.length;
  for (let i = 0; i < Math.max(bufferA.length, bufferB.length); i += 1) {
    difference |= (bufferA[i] ?? 0) ^ (bufferB[i] ?? 0);
  }
  return difference === 0;
}

async function sign(payload: string, secret: string): Promise<string> {
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

function toBase64Url(value: string): string {
  let binary = "";
  for (const byte of encoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Mints `<base64url(JSON)>.<hmac>`; the secret must be configured. */
export async function signToken(payload: unknown, secret: string): Promise<string> {
  if (!secret) {
    throw new Error("SESSION_SECRET chưa được cấu hình");
  }
  const segment = toBase64Url(JSON.stringify(payload));
  return `${segment}.${await sign(segment, secret)}`;
}

/**
 * Verifies the signature and returns the JSON object the token carries, or
 * `null` for a missing/tampered token, a wrong secret, or a payload that is not
 * a JSON object. Expiry is the caller's business (see `isWithinMaxAge`).
 */
export async function readToken(
  token: string | undefined,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (!token || !secret) return null;

  const [segment, signature] = token.split(".");
  if (!segment || !signature) return null;

  const expected = await sign(segment, secret);
  if (!safeEqual(signature, expected)) return null;

  const payload = fromBase64Url(segment);
  if (payload === null) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function issuedAtSeconds(payload: Record<string, unknown>): number | null {
  const issuedAt = payload.iat;
  return typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : null;
}

/** True when `issuedAt` (unix seconds) is not in the future and not older than `maxAgeSeconds`. */
export function isWithinMaxAge(
  issuedAt: number | null,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  if (issuedAt === null) return false;
  const ageSeconds = Math.floor(nowMs / 1000) - issuedAt;
  return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}
