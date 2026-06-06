import { redirect } from "next/navigation";
import { auth } from "./auth";

// 后台页面/Server Action 统一调用：校验登录且角色为 ADMIN。
// 中间件已拦截一层，这里是纵深防御（防止中间件配置遗漏或被绕过）。
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/");
  return session;
}

// 用于 Server Action 中的软校验（返回布尔，不重定向）
export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === "ADMIN";
}
