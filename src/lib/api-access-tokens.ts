import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/** 个人访问令牌：`kn_` + 43 位 base64url（32 字节随机数）。数据库只存 SHA-256 摘要。 */
export const API_TOKEN_PREFIX = "kn_";
export const MAX_ACTIVE_API_TOKENS = 5;
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^kn_[A-Za-z0-9_-]{43}$/;

export class ApiTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApiTokenError";
	}
}

export function generateApiTokenValue() {
	return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiToken(token: string) {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 列表中展示的识别前缀，例如 `kn_AbCd1234`。 */
export function apiTokenDisplayPrefix(token: string) {
	return token.slice(0, API_TOKEN_PREFIX.length + 8);
}

/** 从 Authorization 头取出 Bearer 令牌；格式不对时返回 null，避免无效输入查库。 */
export function readBearerToken(header: string | null) {
	if (!header) return null;
	const match = header.match(/^Bearer\s+(\S+)\s*$/i);
	if (!match || !TOKEN_PATTERN.test(match[1])) return null;
	return match[1];
}

export async function createApiAccessToken(input: {
	userId: string;
	name: string;
	expiresInDays: number | null;
	now?: Date;
}) {
	const name = input.name.trim().slice(0, 40);
	if (!name) throw new ApiTokenError("请填写令牌名称");
	if (input.expiresInDays !== null && !API_TOKEN_EXPIRY_DAYS.includes(input.expiresInDays as never)) {
		throw new ApiTokenError("有效期不正确");
	}
	const now = input.now ?? new Date();
	const user = await prisma.user.findUnique({
		where: { id: input.userId },
		select: { role: true, status: true },
	});
	if (!user || user.status !== "ACTIVE" || user.role === "GUEST") {
		throw new ApiTokenError("当前账号不能创建访问令牌");
	}
	const active = await prisma.apiAccessToken.count({
		where: {
			userId: input.userId,
			revokedAt: null,
			OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
		},
	});
	if (active >= MAX_ACTIVE_API_TOKENS) {
		throw new ApiTokenError(`最多同时保留 ${MAX_ACTIVE_API_TOKENS} 个有效令牌，请先撤销不用的令牌`);
	}
	const token = generateApiTokenValue();
	const record = await prisma.apiAccessToken.create({
		data: {
			userId: input.userId,
			name,
			tokenHash: hashApiToken(token),
			tokenPrefix: apiTokenDisplayPrefix(token),
			expiresAt:
				input.expiresInDays === null
					? null
					: new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000),
		},
		select: { id: true, name: true, tokenPrefix: true, expiresAt: true, createdAt: true },
	});
	return { token, record };
}

export async function listApiAccessTokens(userId: string) {
	return prisma.apiAccessToken.findMany({
		where: { userId, revokedAt: null },
		orderBy: { createdAt: "desc" },
		select: { id: true, name: true, tokenPrefix: true, lastUsedAt: true, expiresAt: true, createdAt: true },
	});
}

export async function revokeApiAccessToken(userId: string, id: string) {
	const result = await prisma.apiAccessToken.updateMany({
		where: { id, userId, revokedAt: null },
		data: { revokedAt: new Date() },
	});
	return result.count === 1;
}

/**
 * 校验令牌并返回所属用户。令牌已撤销、已过期，或用户被封禁、是游客时返回 null。
 * 最近使用时间最多每 5 分钟更新一次，避免每个请求都写库。
 */
export async function authenticateApiAccessToken(token: string, now = new Date()) {
	const record = await prisma.apiAccessToken.findUnique({
		where: { tokenHash: hashApiToken(token) },
		select: {
			id: true,
			userId: true,
			revokedAt: true,
			expiresAt: true,
			lastUsedAt: true,
			user: { select: { status: true, role: true } },
		},
	});
	if (!record || record.revokedAt) return null;
	if (record.expiresAt && record.expiresAt <= now) return null;
	if (record.user.status !== "ACTIVE" || record.user.role === "GUEST") return null;
	if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
		await prisma.apiAccessToken
			.update({ where: { id: record.id }, data: { lastUsedAt: now } })
			.catch(() => undefined);
	}
	return { userId: record.userId, tokenId: record.id };
}
