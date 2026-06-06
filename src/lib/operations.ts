import { prisma } from "@/lib/db";
import { getSetting, getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import type { ModuleType } from "@prisma/client";

export class OperationBlockedError extends Error {
  constructor(message: string, public status = 403) {
    super(message);
    this.name = "OperationBlockedError";
  }
}

export function parseAllowlist(value: string) {
  return value
    .split(/[,\n，、\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getRequestIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}

export async function assertRegistrationAllowed(input: {
  provider: "credentials" | "linux-do";
  email?: string | null;
  ip?: string | null;
  inviteCode?: string | null;
}) {
  const mode = await getSetting(SETTING_KEYS.REGISTRATION_MODE);
  if (mode === "closed") {
    throw new OperationBlockedError("注册已关闭");
  }
  if (mode === "linuxdo" && input.provider !== "linux-do") {
    throw new OperationBlockedError("当前仅支持 Linux.do 注册");
  }
  if (mode === "invite") {
    const code = input.inviteCode?.trim();
    if (!code) throw new OperationBlockedError("请输入邀请码");
    const invite = await prisma.inviteCode.findUnique({ where: { code } });
    if (!invite || !invite.enabled) throw new OperationBlockedError("邀请码无效");
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new OperationBlockedError("邀请码已过期");
    }
    if (invite.usedCount >= invite.maxUses) {
      throw new OperationBlockedError("邀请码已用完");
    }
  }

  const maxUsers = await getSettingNumber(SETTING_KEYS.MAX_USERS);
  if (maxUsers > 0) {
    const count = await prisma.user.count();
    if (count >= maxUsers) {
      throw new OperationBlockedError("注册人数已达上限");
    }
  }

  const allowlist = parseAllowlist(await getSetting(SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST));
  const email = input.email?.trim().toLowerCase();
  if (email && allowlist.length > 0) {
    const domain = email.split("@")[1] ?? "";
    if (!allowlist.includes(domain)) {
      throw new OperationBlockedError("该邮箱域名暂不允许注册");
    }
  }

  const dailyIpLimit = await getSettingNumber(SETTING_KEYS.DAILY_IP_REGISTER_LIMIT);
  if (dailyIpLimit > 0 && input.ip) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const count = await prisma.registrationEvent.count({
      where: { ip: input.ip, createdAt: { gte: since } },
    });
    if (count >= dailyIpLimit) {
      throw new OperationBlockedError("该 IP 今日注册次数已达上限");
    }
  }
}

export async function recordRegistration(input: {
  userId: string;
  email?: string | null;
  provider: string;
  ip?: string | null;
  inviteCode?: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.registrationEvent.create({
      data: {
        userId: input.userId,
        email: input.email,
        provider: input.provider,
        ip: input.ip,
        inviteCode: input.inviteCode,
      },
    });
    if (input.inviteCode) {
      await tx.inviteCode.updateMany({
        where: { code: input.inviteCode, enabled: true },
        data: { usedCount: { increment: 1 } },
      });
    }
  });
}

export async function assertModuleOperationAllowed(userId: string, module: ModuleType) {
  if (module !== "IMAGE") return;

  const enabled = await getSettingNumber(SETTING_KEYS.IMAGE_MODULE_ENABLED);
  if (enabled !== 1) throw new OperationBlockedError("图片生成已暂停", 503);

  const dailyLimit = await getSettingNumber(SETTING_KEYS.IMAGE_DAILY_USER_LIMIT);
  if (dailyLimit > 0) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const count = await prisma.imageTurn.count({
      where: {
        conversation: { userId },
        createdAt: { gte: since },
      },
    });
    if (count >= dailyLimit) throw new OperationBlockedError("今日图片生成次数已达上限", 429);
  }

  const userConcurrent = await getSettingNumber(SETTING_KEYS.IMAGE_USER_CONCURRENT_LIMIT);
  if (userConcurrent > 0) {
    const count = await prisma.imageTurn.count({
      where: { status: "PENDING", conversation: { userId } },
    });
    if (count >= userConcurrent) throw new OperationBlockedError("你的图片任务并发数已达上限", 429);
  }

  const globalConcurrent = await getSettingNumber(SETTING_KEYS.IMAGE_GLOBAL_CONCURRENT_LIMIT);
  if (globalConcurrent > 0) {
    const count = await prisma.imageTurn.count({ where: { status: "PENDING" } });
    if (count >= globalConcurrent) throw new OperationBlockedError("全站图片任务繁忙，请稍后再试", 429);
  }
}
