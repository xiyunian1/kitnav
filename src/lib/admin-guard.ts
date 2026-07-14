import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./db";

// 后台页面/Server Action 统一调用：校验登录且角色为 ADMIN。
// 中间件已拦截一层，这里是纵深防御（防止中间件配置遗漏或被绕过）。
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user) redirect("/login");
  if (user.status !== "ACTIVE") redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return session;
}

// 用于 Server Action 中的软校验（返回布尔，不重定向）
export async function isAdmin(): Promise<boolean> {
  return Boolean(await getActiveAdminId());
}

export async function getActiveAdminId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  return user?.role === "ADMIN" && user.status === "ACTIVE"
    ? session.user.id
    : null;
}
