import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  const type = new URL(req.url).searchParams.get("type") === "PROMPT" ? "PROMPT" : "IMAGE";
  const scopeParam = new URL(req.url).searchParams.get("scope");
  const scope =
    scopeParam === "square" || scopeParam === "favorites" || scopeParam === "mine"
      ? scopeParam
      : "all";
  try {
    if (scope === "square") {
      await assertControlledModuleAvailableForUser("materials", session.user.id);
    } else if (scope === "mine") {
      await assertControlledModuleAvailableForUser("library", session.user.id);
    } else {
      await assertControlledModuleAvailableForUser("library", session.user.id);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材模块已暂停" },
      { status: 503 }
    );
  }

  const scopeWhere =
    scope === "mine"
      ? { ownerId: session.user.id }
      : scope === "favorites"
        ? {
            visibility: "PUBLIC" as const,
            status: "APPROVED" as const,
            favorites: { some: { userId: session.user.id } },
          }
        : scope === "square"
          ? { visibility: "PUBLIC" as const, status: "APPROVED" as const }
          : {
              OR: [
                { ownerId: session.user.id },
                {
                  visibility: "PUBLIC" as const,
                  status: "APPROVED" as const,
                  favorites: { some: { userId: session.user.id } },
                },
              ],
            };

  const materials = await prisma.material.findMany({
    where: {
      type,
      ...scopeWhere,
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: q } },
                  { description: { contains: q } },
                  { tags: { contains: q } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId: session.user.id } },
      likes: { where: { userId: session.user.id } },
      _count: { select: { favorites: true, likes: true } },
    },
  });

  return NextResponse.json({
    materials: materials.map((material) => serializeMaterial(material, session.user.id)),
  });
}
