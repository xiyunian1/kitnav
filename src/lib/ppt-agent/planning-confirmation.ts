import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const idSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const directionSchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1).max(80),
	mode: z.string().trim().min(1).max(80),
	visualStyle: z.string().trim().min(1).max(80),
	deliveryPurpose: z.enum(["text", "balanced", "presentation"]),
	rationale: z.string().trim().min(1).max(600),
});

const paletteSchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1).max(80),
	background: hexColorSchema,
	secondaryBackground: hexColorSchema,
	primary: hexColorSchema,
	accent: hexColorSchema,
	bodyText: hexColorSchema,
	rationale: z.string().trim().min(1).max(600),
});

const typographySchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1).max(80),
	heading: z.string().trim().min(1).max(200),
	body: z.string().trim().min(1).max(200),
	bodySize: z.number().int().min(16).max(40),
	rationale: z.string().trim().min(1).max(600),
});

const imageStrategySchema = z.object({
	id: idSchema,
	label: z.string().trim().min(1).max(80),
	usage: z.array(z.enum(["ai", "provided", "none"])).min(1).max(2),
	rendering: z.string().trim().min(1).max(120),
	palette: z.string().trim().min(1).max(120),
	rationale: z.string().trim().min(1).max(600),
});

const pagePlanSchema = z.object({
	page: z.number().int().min(1).max(100),
	title: z.string().trim().min(1).max(200),
	purpose: z.string().trim().min(1).max(400),
	rhythm: z.enum(["anchor", "dense", "breathing"]),
	layoutFamily: z.string().trim().min(1).max(120),
});

const derivationSchema = z.discriminatedUnion("stage", [
	z.object({
		stage: z.literal("design-system"),
		directionId: idSchema,
		derivedAt: z.string().datetime(),
	}),
	z.object({
		stage: z.literal("execution"),
		directionId: idSchema,
		paletteId: idSchema,
		typographyId: idSchema,
		derivedAt: z.string().datetime(),
	}),
]);

export const pptPlanningRecommendationsSchema = z
	.object({
		schema: z.literal("ppt_hosted_planning_recommendations.v1"),
		summary: z.string().trim().min(1).max(1200),
		directions: z.array(directionSchema).length(3),
		palettes: z.array(paletteSchema).length(3),
		typography: z.array(typographySchema).length(3),
		imageStrategies: z.array(imageStrategySchema).min(1).max(3),
		pagePlan: z.array(pagePlanSchema).min(3).max(30),
		recommendedDirectionId: idSchema,
		recommendedPaletteId: idSchema,
			recommendedTypographyId: idSchema,
			recommendedImageStrategyId: idSchema,
			derivation: derivationSchema.optional(),
		})
		.superRefine((value, ctx) => {
			for (const [field, options] of [
				["directions", value.directions],
				["palettes", value.palettes],
				["typography", value.typography],
				["imageStrategies", value.imageStrategies],
			] as const) {
				const ids = options.map((option) => option.id);
				if (new Set(ids).size !== ids.length) {
					ctx.addIssue({
						code: "custom",
						path: [field],
						message: `${field} contains duplicate ids`,
					});
				}
			}
			for (const [field, options, selected] of [
			["recommendedDirectionId", value.directions, value.recommendedDirectionId],
			["recommendedPaletteId", value.palettes, value.recommendedPaletteId],
			["recommendedTypographyId", value.typography, value.recommendedTypographyId],
			[
				"recommendedImageStrategyId",
				value.imageStrategies,
				value.recommendedImageStrategyId,
			],
		] as const) {
			if (!options.some((option) => option.id === selected)) {
				ctx.addIssue({
					code: "custom",
					path: [field],
					message: `${field} does not reference an available option`,
				});
			}
		}
	});

export const pptPlanningDecisionSchema = z.object({
	directionId: idSchema,
	paletteId: idSchema,
	typographyId: idSchema,
	imageStrategyId: idSchema,
});

export const pptPlanningConfirmationStageSchema = z.enum([
	"direction",
	"design-system",
	"execution",
]);

export const pptPlanningDraftSchema = z
	.object({
		schema: z.literal("ppt_hosted_planning_draft.v1"),
		nextStage: z.enum(["design-system", "execution"]),
		directionId: idSchema,
		paletteId: idSchema.optional(),
		typographyId: idSchema.optional(),
		updatedAt: z.string().datetime(),
	})
	.superRefine((value, ctx) => {
		if (
			value.nextStage === "execution" &&
			(!value.paletteId || !value.typographyId)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["nextStage"],
				message: "execution stage requires paletteId and typographyId",
			});
		}
	});

export const pptPlanningResultSchema = pptPlanningDecisionSchema.extend({
	schema: z.literal("ppt_hosted_planning_result.v1"),
	source: z.enum(["automatic", "user"]),
	confirmedAt: z.string().datetime(),
});

export type PptPlanningRecommendations = z.infer<
	typeof pptPlanningRecommendationsSchema
>;
export type PptPlanningDecision = z.infer<typeof pptPlanningDecisionSchema>;
export type PptPlanningResult = z.infer<typeof pptPlanningResultSchema>;
export type PptPlanningConfirmationStage = z.infer<
	typeof pptPlanningConfirmationStageSchema
>;
export type PptPlanningDraft = z.infer<typeof pptPlanningDraftSchema>;

export interface PptPlanningValidationOptions {
	expectedSlideCount: number;
	allowAiImages: boolean;
	skillDir?: string;
}

export class PptPlanningConfirmationRequiredError extends Error {
	constructor(
		public readonly kind: "design" | "template-fill" = "design",
		public readonly stage: PptPlanningConfirmationStage | "template-fill" =
			"direction",
	) {
		super(
			kind === "template-fill"
				? "PPT 模板填充方案正在等待用户确认。"
				: "PPT 设计方案正在等待用户确认。",
		);
		this.name = "PptPlanningConfirmationRequiredError";
	}
}

export function isPptPlanningConfirmationRequiredError(
	error: unknown,
): error is PptPlanningConfirmationRequiredError {
	return error instanceof PptPlanningConfirmationRequiredError;
}

export function getPptPlanningRecommendationsPath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_confirmation.json");
}

export function getPptPlanningDecisionPath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_confirmation_result.json");
}

export function getPptPlanningDraftPath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_confirmation_draft.json");
}

export function hasPptPlanningRecommendations(projectDir: string) {
	return existsSync(getPptPlanningRecommendationsPath(projectDir));
}

export function hasPptPlanningDecision(projectDir: string) {
	return existsSync(getPptPlanningDecisionPath(projectDir));
}

export function hasPptPlanningDraft(projectDir: string) {
	return existsSync(getPptPlanningDraftPath(projectDir));
}

export function readPptPlanningRecommendations(projectDir: string) {
	const path = getPptPlanningRecommendationsPath(projectDir);
	try {
		return pptPlanningRecommendationsSchema.parse(
			JSON.parse(readFileSync(path, "utf-8")),
		);
	} catch (error) {
		throw new Error(
			`无法读取有效的 PPT 设计候选：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function readPptPlanningResult(projectDir: string) {
	const path = getPptPlanningDecisionPath(projectDir);
	try {
		return pptPlanningResultSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		throw new Error(
			`无法读取有效的 PPT 设计确认结果：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function readPptPlanningDraft(projectDir: string) {
	const path = getPptPlanningDraftPath(projectDir);
	try {
		return pptPlanningDraftSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		throw new Error(
			`无法读取有效的 PPT 分阶段确认草稿：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function assertPptPlanningRecommendations(
	projectDir: string,
	options: PptPlanningValidationOptions,
) {
	const recommendations = readPptPlanningRecommendations(projectDir);
	if (recommendations.pagePlan.length !== options.expectedSlideCount) {
		throw new Error(
			`PPT 设计候选页数不正确：${recommendations.pagePlan.length}/${options.expectedSlideCount}。`,
		);
	}
	const pages = recommendations.pagePlan.map((page) => page.page);
	const expectedPages = Array.from(
		{ length: options.expectedSlideCount },
		(_, index) => index + 1,
	);
	if (pages.some((page, index) => page !== expectedPages[index])) {
		throw new Error("PPT 设计候选的逐页计划必须从第 1 页连续排列。");
	}
	if (
		!options.allowAiImages &&
		recommendations.imageStrategies.some((strategy) => strategy.usage.includes("ai"))
	) {
		throw new Error("任务未启用图片模型，但设计候选包含 AI 图片策略。");
	}
	if (
		options.allowAiImages &&
		(recommendations.imageStrategies.length !== 3 ||
			recommendations.imageStrategies.some(
				(strategy) => !strategy.usage.includes("ai"),
			))
	) {
		throw new Error("任务已启用图片模型，必须提供 3 个使用 AI 的图片风格候选。");
	}
	if (options.skillDir) {
		for (const direction of recommendations.directions) {
			assertOfficialReferenceId(
				options.skillDir,
				"modes",
				direction.mode,
				"叙事模式",
			);
			assertOfficialReferenceId(
				options.skillDir,
				"visual-styles",
				direction.visualStyle,
				"视觉风格",
			);
		}
	}
	return recommendations;
}

export function validatePptPlanningDecision(
	recommendations: PptPlanningRecommendations,
	input: unknown,
) {
	const decision = pptPlanningDecisionSchema.parse(input);
	const available = [
		[decision.directionId, recommendations.directions],
		[decision.paletteId, recommendations.palettes],
		[decision.typographyId, recommendations.typography],
		[decision.imageStrategyId, recommendations.imageStrategies],
	] as const;
	if (available.some(([id, options]) => !options.some((option) => option.id === id))) {
		throw new Error("选择的 PPT 设计方案已失效，请刷新后重试。");
	}
	return decision;
}

export function validatePptPlanningDirection(
	recommendations: PptPlanningRecommendations,
	directionId: string,
) {
	const id = idSchema.parse(directionId);
	if (!recommendations.directions.some((option) => option.id === id)) {
		throw new Error("选择的 PPT 设计方向已失效，请刷新后重试。");
	}
	return id;
}

export function validatePptPlanningDesignSystem(
	recommendations: PptPlanningRecommendations,
	draft: PptPlanningDraft,
	input: { paletteId: string; typographyId: string },
) {
	if (
		draft.nextStage !== "design-system" ||
		!recommendations.directions.some((option) => option.id === draft.directionId)
	) {
		throw new Error("PPT 设计方向确认状态已失效，请刷新后重试。");
	}
	const paletteId = idSchema.parse(input.paletteId);
	const typographyId = idSchema.parse(input.typographyId);
	if (!recommendations.palettes.some((option) => option.id === paletteId)) {
		throw new Error("选择的 PPT 配色方案已失效，请刷新后重试。");
	}
	if (!recommendations.typography.some((option) => option.id === typographyId)) {
		throw new Error("选择的 PPT 字体方案已失效，请刷新后重试。");
	}
	return { paletteId, typographyId };
}

export function validatePptPlanningExecution(
	recommendations: PptPlanningRecommendations,
	draft: PptPlanningDraft,
	imageStrategyId: string,
) {
	if (
		draft.nextStage !== "execution" ||
		!draft.paletteId ||
		!draft.typographyId ||
		!recommendations.directions.some((option) => option.id === draft.directionId) ||
		!recommendations.palettes.some((option) => option.id === draft.paletteId) ||
		!recommendations.typography.some((option) => option.id === draft.typographyId)
	) {
		throw new Error("PPT 设计系统确认状态已失效，请刷新后重试。");
	}
	const id = idSchema.parse(imageStrategyId);
	if (!recommendations.imageStrategies.some((option) => option.id === id)) {
		throw new Error("选择的 PPT 图片策略已失效，请刷新后重试。");
	}
	return {
		directionId: draft.directionId,
		paletteId: draft.paletteId,
		typographyId: draft.typographyId,
		imageStrategyId: id,
	};
}

export function writePptPlanningDecision(
	projectDir: string,
	decision: PptPlanningDecision,
	source: "automatic" | "user",
) {
	const path = getPptPlanningDecisionPath(projectDir);
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		temporaryPath,
		`${JSON.stringify(
			{
				schema: "ppt_hosted_planning_result.v1",
				...decision,
				source,
				confirmedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);
	renameSync(temporaryPath, path);
	return path;
}

export function writePptPlanningDraft(
	projectDir: string,
	draft: Omit<PptPlanningDraft, "schema" | "updatedAt">,
) {
	const path = getPptPlanningDraftPath(projectDir);
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	const value = pptPlanningDraftSchema.parse({
		schema: "ppt_hosted_planning_draft.v1",
		...draft,
		updatedAt: new Date().toISOString(),
	});
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, path);
	return path;
}

export function writeAutomaticPptPlanningDecision(projectDir: string) {
	const recommendations = readPptPlanningRecommendations(projectDir);
	return writePptPlanningDecision(
		projectDir,
		{
			directionId: recommendations.recommendedDirectionId,
			paletteId: recommendations.recommendedPaletteId,
			typographyId: recommendations.recommendedTypographyId,
			imageStrategyId: recommendations.recommendedImageStrategyId,
		},
		"automatic",
	);
}

export function markStoredPptPlanningConfirmed(paramsJson: string | null) {
	return updateStoredPptPlanningState(paramsJson, {
		planningConfirmed: true,
		planningConfirmationStage: "complete",
	});
}

export function markStoredPptPlanningStage(
	paramsJson: string | null,
	stage: Exclude<PptPlanningConfirmationStage, "direction">,
) {
	return updateStoredPptPlanningState(paramsJson, {
		planningConfirmed: false,
		planningConfirmationStage: stage,
	});
}

export function readStoredPptPlanningStage(
	paramsJson: string | null,
): PptPlanningConfirmationStage {
	if (!paramsJson) return "direction";
	try {
		const parsed = JSON.parse(paramsJson) as Record<string, unknown>;
		return pptPlanningConfirmationStageSchema.catch("direction").parse(
			parsed.planningConfirmationStage,
		);
	} catch {
		return "direction";
	}
}

function updateStoredPptPlanningState(
	paramsJson: string | null,
	state: Record<string, unknown>,
) {
	if (!paramsJson) throw new Error("PPT 项目缺少生成参数，无法继续确认流程。");
	let parsed: unknown;
	try {
		parsed = JSON.parse(paramsJson);
	} catch {
		throw new Error("PPT 项目生成参数已损坏，无法继续确认流程。");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("PPT 项目生成参数格式不正确，无法继续确认流程。");
	}
	return JSON.stringify({
		...(parsed as Record<string, unknown>),
		...state,
	});
}

export function assertPptPlanningStageDerived(
	recommendations: PptPlanningRecommendations,
	draft: PptPlanningDraft,
	stage: "design-system" | "execution",
) {
	const derivation = recommendations.derivation;
	if (!derivation || derivation.stage !== stage) {
		throw new Error(`PPT ${stage} 候选缺少基于上游选择的重新推导记录。`);
	}
	if (derivation.directionId !== draft.directionId) {
		throw new Error("PPT 分阶段候选没有基于用户确认的设计方向重新推导。");
	}
	if (!recommendations.directions.some((option) => option.id === draft.directionId)) {
		throw new Error("PPT 分阶段候选丢失了用户确认的设计方向。");
	}
	if (stage === "execution") {
		if (
			derivation.stage !== "execution" ||
			derivation.paletteId !== draft.paletteId ||
			derivation.typographyId !== draft.typographyId
		) {
			throw new Error("PPT 执行候选没有基于用户确认的配色与字体重新推导。");
		}
		if (
			!recommendations.palettes.some((option) => option.id === draft.paletteId) ||
			!recommendations.typography.some((option) => option.id === draft.typographyId)
		) {
			throw new Error("PPT 执行候选丢失了用户确认的设计系统。");
		}
	}
	return recommendations;
}

export function resolvePptPlanningSelection(
	recommendations: PptPlanningRecommendations,
	decision: PptPlanningDecision,
) {
	const valid = validatePptPlanningDecision(recommendations, decision);
	return {
		direction: recommendations.directions.find(
			(option) => option.id === valid.directionId,
		)!,
		palette: recommendations.palettes.find(
			(option) => option.id === valid.paletteId,
		)!,
		typography: recommendations.typography.find(
			(option) => option.id === valid.typographyId,
		)!,
		imageStrategy: recommendations.imageStrategies.find(
			(option) => option.id === valid.imageStrategyId,
		)!,
		pagePlan: recommendations.pagePlan,
	};
}

export function assertPptPlanningDecisionApplied(projectDir: string) {
	const recommendations = readPptPlanningRecommendations(projectDir);
	const result = readPptPlanningResult(projectDir);
	const selected = resolvePptPlanningSelection(recommendations, result);
	const specLockPath = join(projectDir, "spec_lock.md");
	const designSpecPath = join(projectDir, "design_spec.md");
	if (!existsSync(specLockPath) || !existsSync(designSpecPath)) {
		throw new Error("应用设计确认结果后缺少 design_spec.md 或 spec_lock.md。");
	}
	const specLock = readFileSync(specLockPath, "utf-8");
	const requiredLines = [
		`- mode: ${selected.direction.mode}`,
		`- visual_style: ${selected.direction.visualStyle}`,
		`- bg: ${selected.palette.background}`,
		`- secondary_bg: ${selected.palette.secondaryBackground}`,
		`- primary: ${selected.palette.primary}`,
		`- accent: ${selected.palette.accent}`,
		`- text: ${selected.palette.bodyText}`,
		`- body: ${selected.typography.bodySize}`,
	];
	const missingLines = requiredLines.filter((line) => !specLock.includes(line));
	if (missingLines.length > 0) {
		throw new Error(
			`spec_lock.md 未完整应用确认结果：${missingLines.join("、")}`,
		);
	}
	for (const family of [selected.typography.heading, selected.typography.body]) {
		if (!specLock.includes(family)) {
			throw new Error(`spec_lock.md 未应用确认字体：${family}`);
		}
	}
	for (const page of selected.pagePlan) {
		const line = `- P${String(page.page).padStart(2, "0")}: ${page.rhythm}`;
		if (!specLock.includes(line)) {
			throw new Error(`spec_lock.md 未应用第 ${page.page} 页节奏：${page.rhythm}`);
		}
	}
	if (selected.imageStrategy.usage.includes("ai")) {
		for (const line of [
			`- image_rendering: ${selected.imageStrategy.rendering}`,
			`- image_palette: ${selected.imageStrategy.palette}`,
		]) {
			if (!specLock.includes(line)) {
				throw new Error(`spec_lock.md 未应用图片策略：${line.slice(2)}`);
			}
		}
	}
	return selected;
}

function assertOfficialReferenceId(
	skillDir: string,
	family: "modes" | "visual-styles",
	id: string,
	label: string,
) {
	if (id === "custom") return;
	const path = join(skillDir, "references", family, `${id}.md`);
	if (!existsSync(path)) {
		throw new Error(`PPT 设计候选使用了未知的官方${label}：${id}。`);
	}
}
