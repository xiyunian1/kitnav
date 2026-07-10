import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { parseModelList } from "@/lib/model-options";
import { isModelEnabled, parseModelMeta } from "@/lib/model-meta";
import type { ModelSource } from "@/lib/module-model-options";
import {
	normalizePptThinkingLevel,
	parsePptModelOptions,
	type PptThinkingLevel,
} from "@/lib/ppt-agent/model-options";

export interface PreparedPiAgentConfig {
	configDir: string;
	provider: string;
	model: string;
	thinkingLevel: PptThinkingLevel;
	source: "user" | "platform";
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
	projectDir: string;
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

	const requestedSource =
		input.modelSource ?? (project?.usedOwnKey ? "user" : undefined);

	if (requestedSource === "user" && !userCfg?.enabled) {
		throw new Error(
			"你的 PPT API 配置已关闭或不可用，请在「API 设置」里重新启用后再生成。",
		);
	}

	if (requestedSource !== "platform" && userCfg?.enabled) {
		return writePiConfig(input.projectDir, "user", {
			baseUrl: userCfg.baseUrl,
			apiKey: userCfg.apiKey,
			model: userCfg.model,
			models: userCfg.models,
			modelOptions: userCfg.modelOptions,
		}, input.model);
	}

	if (project?.usedOwnKey) {
		throw new Error(
			"你的 PPT API 配置已关闭或不可用，请在「API 设置」里重新启用后再生成。",
		);
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

	return writePiConfig(input.projectDir, "platform", {
		baseUrl: platformCfg.baseUrl,
		apiKey: platformCfg.apiKey,
		model: platformCfg.model,
		models: platformCfg.models,
		modelMeta: platformCfg.modelMeta,
		modelOptions: platformCfg.modelOptions,
	}, input.model);
}

function writePiConfig(
	projectDir: string,
	source: "user" | "platform",
	stored: StoredPptProviderConfig,
	requestedModel?: string,
): PreparedPiAgentConfig {
	const configDir = join(projectDir, ".pi-agent");
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
	const thinkingLevel = resolvePiThinkingLevel(stored.modelOptions);

	mkdirSync(configDir, { recursive: true });
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
							input: ["text"],
							contextWindow: numberEnv("PPT_PI_CONTEXT_WINDOW", 128000),
							maxTokens: numberEnv("PPT_PI_MAX_TOKENS", 16384),
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
		`${JSON.stringify(
			{
				[provider]: {
					type: "api_key",
					key: "$PPT_PI_API_KEY",
					env: {
						PPT_PI_API_KEY: apiKey,
					},
				},
			},
			null,
			2,
		)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);

	return { configDir, provider, model, thinkingLevel, source };
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

function buildOpenAiCompatibleCompat() {
	return {
		supportsStore: isTruthy(process.env.PPT_PI_SUPPORTS_STORE ?? "false"),
		supportsDeveloperRole: isTruthy(
			process.env.PPT_PI_SUPPORTS_DEVELOPER_ROLE ?? "false",
		),
		supportsReasoningEffort: isTruthy(
			process.env.PPT_PI_SUPPORTS_REASONING_EFFORT ?? "false",
		),
		supportsUsageInStreaming: isTruthy(
			process.env.PPT_PI_SUPPORTS_USAGE_IN_STREAMING ?? "false",
		),
		maxTokensField:
			process.env.PPT_PI_MAX_TOKENS_FIELD === "max_completion_tokens"
				? "max_completion_tokens"
				: "max_tokens",
	};
}

function buildThinkingLevelMap() {
	return {
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: process.env.PPT_PI_THINKING_VALUE || "max",
	};
}
