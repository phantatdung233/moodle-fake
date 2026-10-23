import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  readAdminSession,
} from "@/lib/admin/session";

/**
 * Guards every `/admin/**` page except `/admin/login`: without a valid session
 * cookie the request is redirected to the login page.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoggedIn = await readAdminSession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );

  if (pathname === "/admin/login") {
    if (isLoggedIn) {
      const adminUrl = new URL("/admin", request.url);
      return NextResponse.redirect(adminUrl);
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
