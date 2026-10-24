/**
 * The sinh viên's identity lives in its own httpOnly cookie — a different
 * cookie from the admin session, so the two can never be confused — because the
 * spec has no password for students (Spec, "Làm bài").
 *
 * The cookie holds **only** who the student is: MSSV and họ tên. It is entered
 * once on the home page and then applies to every Quiz. Which Attempt belongs
 * to them is always re-read from the database per Quiz, so one browser can have
 * several open papers without the cookie having to name any of them (and
 * "Làm lại" cannot get stuck pointing at the paper it just submitted).
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
  /** As the student typed it; shown back in the header. */
  studentName: string;
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
      studentName: identity.studentName,
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

  const { studentId, studentName } = payload;
  if (typeof studentId !== "string" || studentId === "") return null;
  // Cookies issued before the name was part of the identity are not usable:
  // the home page always has the name, so signing in again costs one field.
  if (typeof studentName !== "string" || studentName === "") return null;

  return { studentId, studentName };
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
