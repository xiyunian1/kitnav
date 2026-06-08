import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveImageBlob, tagsToJson } from "@/lib/materials";
import { resolveMaterialSubmissionState } from "@/lib/material-review";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const image = form.get("file");
  if (!(image instanceof Blob) || image.size === 0) {
    return NextResponse.json({ error: "请上传图片" }, { status: 400 });
  }

  const title = String(form.get("title") || "").trim().slice(0, 80);
  const description = String(form.get("description") || "").trim().slice(0, 400);
  const tags = String(form.get("tags") || "").trim().slice(0, 200);
  const visibility = form.get("visibility") === "PUBLIC" ? "PUBLIC" : "PRIVATE";

  try {
    const stored = await saveImageBlob(image, session.user.id);
    const finalTitle = title || "未命名素材";
    const submission = await resolveMaterialSubmissionState(visibility, {
      type: "IMAGE",
      title: finalTitle,
      description,
      tags,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    });
    const material = await prisma.material.create({
      data: {
        ownerId: session.user.id,
        ownerType: "USER",
        type: "IMAGE",
        source: "UPLOAD",
        visibility: submission.visibility,
        status: submission.status,
        rejectionReason: submission.rejectionReason,
        reviewedAt: submission.reviewedAt,
        title: finalTitle,
        description: description || null,
        tags: tagsToJson(tags),
        url: stored.url,
        storageKey: stored.storageKey,
        thumbnailUrl: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      },
      select: { id: true, status: true },
    });

    return NextResponse.json({ ok: true, id: material.id, status: material.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "上传失败" },
      { status: 400 }
    );
  }
}
