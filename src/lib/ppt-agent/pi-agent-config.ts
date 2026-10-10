import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { parseModelList } from "@/lib/model-options";
import { isModelEnabled, parseModelMeta } from "@/lib/model-meta";
import type { ModelSource } from "@/lib/module-model-options";
import { assertSafePublicApiUrl } from "@/lib/safe-fetch";
import {
	normalizePptThinkingLevel,
	isPptVisionModel,
	parsePptModelOptions,
	type PptThinkingLevel,
} from "@/lib/ppt-agent/model-options";

export interface PreparedPiAgentConfig {
	configDir: string;
	provider: string;
	model: string;
	apiKey: string;
	thinkingLevel: PptThinkingLevel;
	source: "user" | "platform";
	supportsVision: boolean;
}

interface StoredPptProviderConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	models: string | null;
	modelMeta?: string | null;
	modelOptions: string | null;
}

export async function preparePptPiAgentConfig(input: {
	projectId: string;
	userId: string;
	model?: string;
	modelSource?: ModelSource;
}): Promise<PreparedPiAgentConfig> {
	const project = await prisma.pptProject.findUnique({
		where: { id: input.projectId },
		select: { usedOwnKey: true },
	});
	const userCfg = await prisma.userApiConfig.findUnique({
		where: { userId_module: { userId: input.userId, module: "PPT" } },
		select: {
			baseUrl: true,
			apiKey: true,
			model: true,
			models: true,
			modelOptions: true,
			enabled: true,
		},
	});

	// New jobs persist the selected source explicitly. `usedOwnKey` is only a
	// compatibility fallback for legacy rows that predate modelSource.
	const requestedSource =
		input.modelSource ?? (project?.usedOwnKey ? "user" : undefined);

	if (requestedSource === "user" && !userCfg?.enabled) {
		throw new Error(
			"你的 PPT API 配置已关闭或不可用，请在「API 设置」里重新启用后再生成。",
		);
	}

	if (requestedSource !== "platform" && userCfg?.enabled) {
		await assertSafePublicApiUrl(userCfg.baseUrl);
		return writePiConfig("user", {
			baseUrl: userCfg.baseUrl,
			apiKey: userCfg.apiKey,
			model: userCfg.model,
			models: userCfg.models,
			modelOptions: userCfg.modelOptions,
		}, input.model);
	}

	const platformCfg = await prisma.providerConfig.findUnique({
		where: { module: "PPT" },
		select: {
			baseUrl: true,
			apiKey: true,
			model: true,
			models: true,
			modelMeta: true,
			modelOptions: true,
			enabled: true,
		},
	});
	if (!platformCfg?.enabled) {
		throw new Error("PPT 平台 API 配置不可用，请配置自己的 PPT API 后再生成。");
	}

	return writePiConfig("platform", {
		baseUrl: platformCfg.baseUrl,
		apiKey: platformCfg.apiKey,
		model: platformCfg.model,
		models: platformCfg.models,
		modelMeta: platformCfg.modelMeta,
		modelOptions: platformCfg.modelOptions,
	}, input.model);
}

function writePiConfig(
	source: "user" | "platform",
	stored: StoredPptProviderConfig,
	requestedModel?: string,
): PreparedPiAgentConfig {
	const provider =
		source === "user" ? "ppt-user" : process.env.PPT_PI_PROVIDER || "ppt-platform";
	const modelIds = resolveConfiguredModels(source, stored);
	const model = requestedModel
		? modelIds.includes(requestedModel)
			? requestedModel
			: ""
		: modelIds.includes(stored.model)
			? stored.model
			: modelIds[0];
	if (!model) {
		throw new Error("所选 PPT 模型未保存、已停用或对应 API 配置不可用。");
	}
	const apiKey = decrypt(stored.apiKey);
	const modelOptions = parsePptModelOptions(stored.modelOptions);
	const thinkingLevel = resolvePiThinkingLevel(stored.modelOptions);
	const supportsVision = isPptVisionModel(modelOptions, model);
	const tempRoot = resolve(process.env.PPT_PI_CONFIG_TMP_DIR || tmpdir());
	mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
	const configDir = mkdtempSync(join(tempRoot, "ppt-pi-"));

	try {
		writeFileSync(
			join(configDir, "settings.json"),
			`${JSON.stringify(
				{
					defaultProvider: provider,
					defaultModel: model,
					defaultThinkingLevel: thinkingLevel,
					packages: [],
				},
				null,
				2,
			)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);

		writeFileSync(
			join(configDir, "models.json"),
			`${JSON.stringify(
				{
					providers: {
						[provider]: {
							name: source === "user" ? "User PPT API" : "PPT Platform",
							baseUrl: stored.baseUrl,
							apiKey: "$PPT_PI_API_KEY",
							api: process.env.PPT_PI_API_TYPE || "openai-completions",
							headers: buildPiProviderHeaders(),
							compat: buildOpenAiCompatibleCompat(),
							models: modelIds.map((id) => ({
								id,
								name: id,
								reasoning: resolvePiReasoningEnabled(),
								input: isPptVisionModel(modelOptions, id)
									? ["text", "image"]
									: ["text"],
								contextWindow: numberEnv("PPT_PI_CONTEXT_WINDOW", 128000),
								maxTokens: numberEnv("PPT_PI_MAX_TOKENS", 16384),
								cost: resolvePptModelPricing(id),
								thinkingLevelMap: buildThinkingLevelMap(),
							})),
						},
					},
				},
				null,
				2,
			)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);

		writeFileSync(
			join(configDir, "auth.json"),
			"{}\n",
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch (error) {
		rmSync(configDir, { recursive: true, force: true });
		throw error;
	}

	return {
		configDir,
		provider,
		model,
		apiKey,
		thinkingLevel,
		source,
		supportsVision,
	};
}

export function cleanupPptPiAgentConfig(config: PreparedPiAgentConfig) {
	rmSync(config.configDir, { recursive: true, force: true });
}

function resolveConfiguredModels(
	source: "user" | "platform",
	stored: StoredPptProviderConfig,
) {
	const configured = parseModelList(stored.models);
	const models = configured.length > 0 ? configured : [stored.model];
	if (source === "user") return models;
	const meta = parseModelMeta(stored.modelMeta);
	return models.filter((model) => isModelEnabled(meta, model));
}

function numberEnv(name: string, fallback: number) {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isTruthy(value: string) {
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function resolvePiThinkingLevel(modelOptions?: string | null): PptThinkingLevel {
	return normalizePptThinkingLevel(
		process.env.PPT_PI_THINKING?.trim() ||
			parsePptModelOptions(modelOptions).thinkingLevel,
	);
}

function resolvePiReasoningEnabled() {
	return isTruthy(process.env.PPT_PI_REASONING ?? "true");
}

function buildPiProviderHeaders() {
	return {
		"User-Agent": process.env.PPT_PI_USER_AGENT?.trim() || "node",
	};
}

export interface PptModelPricing {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * 读取 PPT_PI_MODEL_PRICING（JSON，单位：元/百万 token），按模型 ID 匹配，"*" 为默认值，例如：
 * {"deepseek-v4-pro": {"input": 4, "output": 16, "cacheRead": 1}, "*": {"input": 2, "output": 8}}
 * 单价写入 models.json 后，Pi 会按每次回复的实际用量计算费用，费用随运行记录一起保存。
 */
export function resolvePptModelPricing(
	modelId: string,
	environment: Readonly<Record<string, string | undefined>> = process.env,
): PptModelPricing {
	const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const raw = environment.PPT_PI_MODEL_PRICING?.trim();
	if (!raw) return zero;
	let table: unknown;
	try {
		table = JSON.parse(raw);
	} catch {
		return zero;
	}
	if (!table || typeof table !== "object" || Array.isArray(table)) return zero;
	const entries = table as Record<string, unknown>;
	const entry = entries[modelId] ?? entries["*"];
	if (!entry || typeof entry !== "object") return zero;
	const price = (key: keyof PptModelPricing) => {
		const value = Number((entry as Record<string, unknown>)[key]);
		return Number.isFinite(value) && value >= 0 ? value : 0;
	};
	return {
		input: price("input"),
		output: price("output"),
		cacheRead: price("cacheRead"),
		cacheWrite: price("cacheWrite"),
	};
}

export function buildOpenAiCompatibleCompat(
	environment: Readonly<Record<string, string | undefined>> = process.env,
) {
	return {
		supportsStore: isTruthy(environment.PPT_PI_SUPPORTS_STORE ?? "false"),
		supportsDeveloperRole: isTruthy(
			environment.PPT_PI_SUPPORTS_DEVELOPER_ROLE ?? "false",
		),
		supportsReasoningEffort: isTruthy(
			environment.PPT_PI_SUPPORTS_REASONING_EFFORT ?? "true",
		),
		supportsUsageInStreaming: isTruthy(
			environment.PPT_PI_SUPPORTS_USAGE_IN_STREAMING ?? "false",
		),
		maxTokensField:
			environment.PPT_PI_MAX_TOKENS_FIELD === "max_completion_tokens"
				? "max_completion_tokens"
				: "max_tokens",
	};
}

export function buildThinkingLevelMap(
	environment: Readonly<Record<string, string | undefined>> = process.env,
) {
	return {
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: environment.PPT_PI_THINKING_VALUE || "xhigh",
	};
}
