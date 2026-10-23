/**
 * The sinh viên's identity lives in its own httpOnly cookie — a different
 * cookie from the admin session, so the two can never be confused — because the
 * spec has no password for students (Spec, "Làm bài"). The cookie carries the
 * MSSV and the Attempt they are working on; the server re-checks that the
 * Attempt belongs to that MSSV before showing or saving anything.
 */
import {
  isWithinMaxAge,
  issuedAtSeconds,
  readToken,
  signToken,
} from "@/lib/auth/token";

export const STUDENT_SESSION_COOKIE = "student_session";
/** A sinh viên may come back any time; this only bounds a stolen cookie. */
export const STUDENT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type StudentIdentity = {
  /** Normalised MSSV (uppercase, trimmed). */
  studentId: string;
  attemptId: string;
};

export type StudentCookie = {
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

export async function createStudentSessionCookie(
  identity: StudentIdentity,
  sessionSecret: string | undefined,
): Promise<StudentCookie> {
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET chưa được cấu hình");
  }

  const value = await signToken(
    {
      studentId: identity.studentId,
      attemptId: identity.attemptId,
      iat: Math.floor(Date.now() / 1000),
    },
    sessionSecret,
  );

  return {
    name: STUDENT_SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
    },
  };
}

/** The cookie's identity, or `null` when it is missing, forged or expired. */
export async function readStudentSession(
  cookieValue: string | undefined,
  sessionSecret: string | undefined,
): Promise<StudentIdentity | null> {
  if (!cookieValue || !sessionSecret) return null;

  const payload = await readToken(cookieValue, sessionSecret);
  if (!payload) return null;
  if (!isWithinMaxAge(issuedAtSeconds(payload), STUDENT_SESSION_MAX_AGE_SECONDS)) {
    return null;
  }

  const { studentId, attemptId } = payload;
  if (typeof studentId !== "string" || studentId === "") return null;
  if (typeof attemptId !== "string" || attemptId === "") return null;

  return { studentId, attemptId };
}

export function clearedStudentSessionCookie(): StudentCookie {
  return {
    name: STUDENT_SESSION_COOKIE,
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
