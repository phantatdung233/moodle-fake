"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  adminAuthEnv,
  ADMIN_SESSION_COOKIE,
  clearedAdminSessionCookie,
  createAdminSessionCookie,
  isValidAdminPassword,
} from "@/lib/admin/session";

export type LoginState = { error?: string };

/** Verifies the admin password and sets the httpOnly session cookie. */
export async function loginAdmin(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const env = adminAuthEnv();

  if (!env.adminPassword) {
    return { error: "Chưa cấu hình ADMIN_PASSWORD trên máy chủ." };
  }
  if (!env.sessionSecret) {
    return { error: "Chưa cấu hình SESSION_SECRET trên máy chủ." };
  }
  if (!isValidAdminPassword(password, env)) {
    return { error: "Mật khẩu không đúng." };
  }

  const cookie = await createAdminSessionCookie(env);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);

  redirect("/admin");
}

/** Clears the admin session cookie and returns to the login page. */
export async function logoutAdmin(): Promise<void> {
  const cookie = clearedAdminSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.options);
  cookieStore.delete(ADMIN_SESSION_COOKIE);

  redirect("/admin/login");
}
