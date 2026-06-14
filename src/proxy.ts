import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

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
  // 匹配除静态资源、图片优化、favicon 外的所有路径
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
