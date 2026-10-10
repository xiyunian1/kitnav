import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { resolvePptProjectFile, safeDownloadName } from "@/lib/ppt-agent/paths";
import { isPptCompletedStatus } from "@/lib/ppt-agent/status";
import { arePptArtifactsExpired } from "@/lib/ppt-agent/project-public";

/** 签名下载链接的最长有效期。 */
export const PPT_SIGNED_DOWNLOAD_TTL_MS = 60 * 60 * 1000;

/**
 * 以 userId 身份返回项目的 PPTX 文件流。网页端导出接口和签名下载链接共用，调用方负责认证。
 */
export async function servePptxDownload(userId: string, id: string): Promise<Response> {
  try {
    await assertControlledModuleAvailableForUser("ppt", userId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PPT 模块不可用" },
      { status: 403 }
    );
  }

  const project = await prisma.pptProject.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      status: true,
      pptxPath: true,
      completedAt: true,
      updatedAt: true,
      artifactsDeletedAt: true,
    },
  });

  if (project && arePptArtifactsExpired(project)) {
    return Response.json(
      { error: "该项目的生成文件已超过保留期限，请重新生成" },
      { status: 410 },
    );
  }
  if (!project || !isPptCompletedStatus(project.status) || !project.pptxPath) {
    return Response.json({ error: "项目不存在或尚未完成" }, { status: 404 });
  }

  let file: Awaited<ReturnType<typeof resolvePptProjectFile>>;
  try {
    file = await resolvePptProjectFile(project.id, project.pptxPath);
  } catch {
    return Response.json({ error: "项目文件路径无效" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadName(project.title))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function signingSecret(environment: Readonly<Record<string, string | undefined>>) {
  const secret = environment.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET 未配置，无法生成下载链接");
  return secret;
}

export function signPptDownload(
  projectId: string,
  ownerId: string,
  expiresAt: number,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return createHmac("sha256", signingSecret(environment))
    .update(`ppt-download:${projectId}:${ownerId}:${expiresAt}`)
    .digest("base64url");
}

/** 生成带过期时间和 HMAC 签名的下载链接，供 MCP 等无会话的客户端下载。 */
export function createPptDownloadUrl(input: {
  origin: string;
  projectId: string;
  ownerId: string;
  now?: number;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const expiresAt = Math.floor(((input.now ?? Date.now()) + PPT_SIGNED_DOWNLOAD_TTL_MS) / 1000);
  const signature = signPptDownload(input.projectId, input.ownerId, expiresAt, input.environment);
  const url = new URL(`/api/ppt/projects/${encodeURIComponent(input.projectId)}/download`, input.origin);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature);
  return { url: url.toString(), expiresAt: new Date(expiresAt * 1000) };
}

export function verifyPptDownloadSignature(input: {
  projectId: string;
  ownerId: string;
  expiresAt: number;
  signature: string;
  now?: number;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isInteger(input.expiresAt) || input.expiresAt <= nowSeconds) return false;
  // 拒绝有效期超过上限的链接（防止伪造长期链接时绕过）
  if (input.expiresAt - nowSeconds > PPT_SIGNED_DOWNLOAD_TTL_MS / 1000 + 60) return false;
  const expected = Buffer.from(signPptDownload(input.projectId, input.ownerId, input.expiresAt, input.environment));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
