import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import {
  GUEST_MODE_MESSAGE,
  shouldBlockGuestRequest,
  shouldEvictGuestSession,
} from "@/lib/guest-mode";

const { auth } = NextAuth(authConfig);

// 需要登录的用户区路径前缀
const PROTECTED_PREFIXES = [
  "/image",
  "/ppt",
  "/video",
  "/audio",
  "/copywriting",
  "/code",
  "/materials",
  "/library",
  "/credits",
  "/profile",
  "/settings",
];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;
  const path = nextUrl.pathname;

  if (shouldEvictGuestSession({ role, pathname: path })) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "游客入口已关闭" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (
    shouldBlockGuestRequest({
      role,
      method: req.method,
      pathname: path,
    })
  ) {
    return NextResponse.json({ error: GUEST_MODE_MESSAGE }, { status: 403 });
  }

  const isAdminRoute = path.startsWith("/admin");
  const isProtected =
    isAdminRoute || PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));

  if (!isProtected) return NextResponse.next();

  // 未登录 → 跳登录页并带回跳地址
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // 已登录但非管理员访问后台 → 跳首页
  if (isAdminRoute && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // API must pass through the guest write guard. The second matcher covers
  // pages and Server Actions while excluding static assets.
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
