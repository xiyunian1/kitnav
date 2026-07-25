import { prisma } from "@/lib/db";
import { isGuestUserEmail } from "@/lib/guest-mode";
import { getSettingNumber } from "@/lib/credits";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "@/lib/settings-config";
import { Prisma, type ModuleType } from "@prisma/client";
import {
  getModuleControlDefinitionByModuleType,
  isModuleUsable,
  loadModuleControls,
} from "@/lib/module-control-core";

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

type RegistrationProvider = "credentials" | "linux-do";

interface RegistrationPolicyInput {
  provider: RegistrationProvider;
  email?: string | null;
  ip?: string | null;
  inviteCode?: string | null;
}

interface CreateRegisteredUserInput extends RegistrationPolicyInput {
  email: string;
  passwordHash?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
}

const REGISTRATION_SETTING_KEYS = [
  SETTING_KEYS.REGISTRATION_MODE,
  SETTING_KEYS.MAX_USERS,
  SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST,
  SETTING_KEYS.DAILY_IP_REGISTER_LIMIT,
  SETTING_KEYS.SIGNUP_BONUS,
] as const;

function numericSetting(settings: Map<string, string>, key: string) {
  const raw = settings.get(key) ?? DEFAULT_SETTINGS[key] ?? "0";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number(DEFAULT_SETTINGS[key] ?? 0);
}

async function loadRegistrationPolicy(
  db: Prisma.TransactionClient | typeof prisma,
) {
  const rows = await db.setting.findMany({
    where: { key: { in: [...REGISTRATION_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    mode:
      settings.get(SETTING_KEYS.REGISTRATION_MODE) ??
      DEFAULT_SETTINGS[SETTING_KEYS.REGISTRATION_MODE],
    maxUsers: numericSetting(settings, SETTING_KEYS.MAX_USERS),
    allowlist: parseAllowlist(
      settings.get(SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST) ??
        DEFAULT_SETTINGS[SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST],
    ),
    dailyIpLimit: numericSetting(
      settings,
      SETTING_KEYS.DAILY_IP_REGISTER_LIMIT,
    ),
    signupBonus: numericSetting(settings, SETTING_KEYS.SIGNUP_BONUS),
  };
}

async function inspectRegistrationPolicy(
  db: Prisma.TransactionClient | typeof prisma,
  input: RegistrationPolicyInput,
) {
  const policy = await loadRegistrationPolicy(db);
  if (policy.mode === "closed") {
    throw new OperationBlockedError("注册已关闭");
  }
  if (policy.mode === "linuxdo" && input.provider !== "linux-do") {
    throw new OperationBlockedError("当前仅支持 Linux.do 注册");
  }

  let invite: { id: string; code: string } | null = null;
  if (policy.mode === "invite") {
    const code = input.inviteCode?.trim();
    if (!code) throw new OperationBlockedError("请输入邀请码");
    const row = await db.inviteCode.findUnique({ where: { code } });
    if (!row || !row.enabled) throw new OperationBlockedError("邀请码无效");
    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new OperationBlockedError("邀请码已过期");
    }
    if (row.usedCount >= row.maxUses) {
      throw new OperationBlockedError("邀请码已用完");
    }
    invite = { id: row.id, code: row.code };
  }

  if (policy.maxUsers > 0) {
    const count = await db.user.count({ where: { role: { not: "GUEST" } } });
    if (count >= policy.maxUsers) {
      throw new OperationBlockedError("注册人数已达上限");
    }
  }

  const email = input.email?.trim().toLowerCase();
  if (email && policy.allowlist.length > 0) {
    const domain = email.split("@")[1] ?? "";
    if (!policy.allowlist.includes(domain)) {
      throw new OperationBlockedError("该邮箱域名暂不允许注册");
    }
  }

  if (policy.dailyIpLimit > 0 && input.ip) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const count = await db.registrationEvent.count({
      where: { ip: input.ip, createdAt: { gte: since } },
    });
    if (count >= policy.dailyIpLimit) {
      throw new OperationBlockedError("该 IP 今日注册次数已达上限");
    }
  }

  return { ...policy, invite };
}

export async function assertRegistrationAllowed(input: RegistrationPolicyInput) {
  await inspectRegistrationPolicy(prisma, input);
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

async function runRegistrationTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      // One short PostgreSQL transaction lock protects count-based registration
      // limits across every web instance without producing serialization retries.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(734271984155881321)`;
      return callback(tx);
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

export async function createRegisteredUser(input: CreateRegisteredUserInput) {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new OperationBlockedError("邮箱不能为空", 400);
  if (isGuestUserEmail(email)) {
    throw new OperationBlockedError("该邮箱不可用于注册", 400);
  }

  try {
    return await runRegistrationTransaction(async (tx) => {
      const policy = await inspectRegistrationPolicy(tx, {
        ...input,
        email,
      });
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (existing) {
        throw new OperationBlockedError("该邮箱已注册", 409);
      }

      const signupBonus = Math.max(0, Math.trunc(policy.signupBonus));
      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          image: input.image,
          emailVerified: input.emailVerified,
          passwordHash: input.passwordHash,
          credits: signupBonus,
          role: "USER",
        },
      });

      if (signupBonus > 0) {
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            amount: signupBonus,
            type: "SIGNUP_BONUS",
            balanceAfter: signupBonus,
            description:
              input.provider === "linux-do"
                ? "Linux.do 注册赠送"
                : "注册赠送",
          },
        });
      }
      if (policy.invite) {
        await tx.inviteCode.update({
          where: { id: policy.invite.id },
          data: { usedCount: { increment: 1 } },
        });
      }
      await tx.registrationEvent.create({
        data: {
          userId: user.id,
          email: user.email,
          provider: input.provider,
          ip: input.ip,
          inviteCode: policy.invite?.code,
        },
      });
      return user;
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      throw new OperationBlockedError("该邮箱已注册", 409);
    }
    throw error;
  }
}

export async function assertModuleOperationAllowed(userId: string, module: ModuleType) {
  const definition = getModuleControlDefinitionByModuleType(module);
  if (definition) {
    const [controls, user] = await Promise.all([
      loadModuleControls(),
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);
    const control = controls[definition.key];
    if (control && !isModuleUsable(control, user?.role === "ADMIN")) {
      throw new OperationBlockedError(control.message, 503);
    }
  }

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
