import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function getCurrentUserOrUnauthorized() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "请先登录", status: 401 as const };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });

  if (!user) {
    return { error: "登录已失效，请重新登录", status: 401 as const };
  }

  return { user };
}
