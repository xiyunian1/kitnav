"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
	ArrowDown,
	ArrowUp,
	Check,
	Image as ImageIcon,
	LayoutTemplate,
	Loader2,
	Palette,
	RefreshCw,
	Type,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
	PptPlanningConfirmationStage,
	PptPlanningDecision,
	PptPlanningDraft,
	PptPlanningRecommendations,
} from "@/lib/ppt-agent/planning-confirmation";
import type { PptTemplateFillConfirmation } from "@/lib/ppt-agent/template-fill-confirmation";

interface PlanningConfirmationPanelProps {
	projectId: string;
}

interface DesignPlanningResponse {
	kind: "design";
	status: string;
	stage: PptPlanningConfirmationStage;
	recommendations: PptPlanningRecommendations;
	draft: PptPlanningDraft | null;
}

interface TemplatePlanningResponse {
	kind: "template-fill";
	status: string;
	templatePlan: PptTemplateFillConfirmation;
}

type PlanningResponse = DesignPlanningResponse | TemplatePlanningResponse;

export function PlanningConfirmationPanel({
	projectId,
}: PlanningConfirmationPanelProps) {
	const router = useRouter();
	const [data, setData] = useState<PlanningResponse | null>(null);
	const [decision, setDecision] = useState<PptPlanningDecision | null>(null);
	const [templateSlides, setTemplateSlides] = useState<
		PptTemplateFillConfirmation["plannedSlides"]
	>([]);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	const applyResponse = useCallback((body: PlanningResponse) => {
		setData(body);
		if (body.kind === "design") {
			setDecision(recommendedDecision(body.recommendations, body.draft));
			setTemplateSlides([]);
		} else {
			setDecision(null);
			setTemplateSlides(body.templatePlan.plannedSlides);
		}
	}, []);

	const load = useCallback(async () => {
		try {
			applyResponse(await fetchPlanningResponse(projectId));
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "无法读取确认方案");
		} finally {
			setLoading(false);
		}
	}, [applyResponse, projectId]);

	useEffect(() => {
		let cancelled = false;
		void fetchPlanningResponse(projectId)
			.then((body) => {
				if (!cancelled) applyResponse(body);
			})
			.catch((loadError) => {
				if (!cancelled) {
					setError(
						loadError instanceof Error ? loadError.message : "无法读取确认方案",
					);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [applyResponse, projectId]);

	async function submit() {
		if (!data || submitting) return;
		const payload =
			data.kind === "template-fill"
				? {
						kind: "template-fill",
						slides: templateSlides.map((slide) => ({
							planIndex: slide.planIndex,
							sourceSlide: slide.sourceSlide,
						})),
					}
				: buildDesignSubmission(data.stage, decision);
		if (!payload) return;

		setSubmitting(true);
		try {
			const response = await fetch(
				`/api/ppt/projects/${projectId}/planning-confirmation`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(body?.error || "确认方案失败");
			toast.success("方案已确认，任务继续生成。");
			router.refresh();
		} catch (submitError) {
			toast.error(submitError instanceof Error ? submitError.message : "确认方案失败");
		} finally {
			setSubmitting(false);
		}
	}

	function moveTemplateSlide(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= templateSlides.length) return;
		setTemplateSlides((current) => {
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	}

	if (loading) {
		return (
			<Card className="flex min-h-36 items-center justify-center p-6">
				<Loader2 className="size-5 animate-spin text-primary" aria-label="读取确认方案" />
			</Card>
		);
	}

	if (!data || error) {
		return (
			<Card className="flex items-center justify-between gap-4 p-4">
				<p className="text-sm text-destructive">{error || "确认方案不可用"}</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						setLoading(true);
						setError("");
						void load();
					}}
				>
					<RefreshCw className="size-4" />
					重试
				</Button>
			</Card>
		);
	}

	if (data.kind === "template-fill") {
		return (
			<Card className="overflow-hidden p-0">
				<div className="border-b px-5 py-4">
					<h2 className="text-lg font-semibold">确认模板页面方案</h2>
					<p className="mt-1 text-sm text-muted-foreground">{data.templatePlan.summary}</p>
				</div>
				<div className="divide-y">
					{templateSlides.map((slide, index) => (
						<div
							key={slide.planIndex}
							className="grid gap-3 px-5 py-4 lg:grid-cols-[56px_minmax(180px,1fr)_minmax(260px,1.4fr)_80px] lg:items-center"
						>
							<div className="text-sm font-semibold">第 {index + 1} 页</div>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{slide.purpose}</p>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									{slide.layoutPattern}
								</p>
							</div>
							<Select
								value={String(slide.sourceSlide)}
								onValueChange={(value) =>
									setTemplateSlides((current) =>
										current.map((item) =>
											item.planIndex === slide.planIndex
												? { ...item, sourceSlide: Number(value) }
												: item,
										),
									)
								}
							>
								<SelectTrigger className="w-full min-w-0">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{data.templatePlan.availableSlides.map((option) => (
										<SelectItem
											key={option.sourceSlide}
											value={String(option.sourceSlide)}
										>
											P{option.sourceSlide} · {option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="flex justify-end gap-1">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									title="上移"
									disabled={index === 0}
									onClick={() => moveTemplateSlide(index, -1)}
								>
									<ArrowUp className="size-4" />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									title="下移"
									disabled={index === templateSlides.length - 1}
									onClick={() => moveTemplateSlide(index, 1)}
								>
									<ArrowDown className="size-4" />
								</Button>
							</div>
						</div>
					))}
				</div>
				<ConfirmationFooter submitting={submitting} onSubmit={() => void submit()} />
			</Card>
		);
	}

	if (!decision) return null;
	const recommendations = data.recommendations;
	const stageTitle = {
		direction: "确认设计方向",
		"design-system": "确认设计系统",
		execution: "确认图片与执行方案",
	}[data.stage];

	return (
		<Card className="overflow-hidden p-0">
			<div className="border-b px-5 py-4">
				<h2 className="text-lg font-semibold">{stageTitle}</h2>
				<p className="mt-1 text-sm text-muted-foreground">{recommendations.summary}</p>
			</div>

			<div className="divide-y">
				{data.stage === "direction" && (
					<ChoiceSection icon={<LayoutTemplate className="size-4" />} title="设计方向">
						{recommendations.directions.map((option) => (
							<Choice
								key={option.id}
								name="direction"
								selected={decision.directionId === option.id}
								recommended={option.id === recommendations.recommendedDirectionId}
								title={option.label}
								detail={option.rationale}
								meta={`${option.mode} · ${option.visualStyle}`}
								onSelect={() => setDecision({ ...decision, directionId: option.id })}
							/>
						))}
					</ChoiceSection>
				)}

				{data.stage === "design-system" && (
					<>
						<ChoiceSection icon={<Palette className="size-4" />} title="配色">
							{recommendations.palettes.map((option) => (
								<Choice
									key={option.id}
									name="palette"
									selected={decision.paletteId === option.id}
									recommended={option.id === recommendations.recommendedPaletteId}
									title={option.label}
									detail={option.rationale}
									onSelect={() => setDecision({ ...decision, paletteId: option.id })}
									visual={<PaletteSwatches option={option} />}
								/>
							))}
						</ChoiceSection>
						<ChoiceSection icon={<Type className="size-4" />} title="字体">
							{recommendations.typography.map((option) => (
								<Choice
									key={option.id}
									name="typography"
									selected={decision.typographyId === option.id}
									recommended={option.id === recommendations.recommendedTypographyId}
									title={option.label}
									detail={option.rationale}
									meta={`${option.heading} · 正文 ${option.bodySize}px`}
									onSelect={() =>
										setDecision({ ...decision, typographyId: option.id })
									}
								/>
							))}
						</ChoiceSection>
					</>
				)}

				{data.stage === "execution" && (
					<ChoiceSection icon={<ImageIcon className="size-4" />} title="图片策略">
						{recommendations.imageStrategies.map((option) => (
							<Choice
								key={option.id}
								name="image-strategy"
								selected={decision.imageStrategyId === option.id}
								recommended={
									option.id === recommendations.recommendedImageStrategyId
								}
								title={option.label}
								detail={option.rationale}
								meta={`${option.rendering} · ${option.palette}`}
								onSelect={() =>
									setDecision({ ...decision, imageStrategyId: option.id })
								}
							/>
						))}
					</ChoiceSection>
				)}
			</div>

			<ConfirmationFooter submitting={submitting} onSubmit={() => void submit()} />
		</Card>
	);
}

async function fetchPlanningResponse(projectId: string) {
	const response = await fetch(
		`/api/ppt/projects/${projectId}/planning-confirmation`,
		{ cache: "no-store" },
	);
	const body = (await response.json().catch(() => null)) as
		| PlanningResponse
		| { error?: string }
		| null;
	if (!response.ok || !body || !("kind" in body)) {
		throw new Error(
			body && "error" in body ? body.error || "无法读取确认方案" : "无法读取确认方案",
		);
	}
	return body;
}

function recommendedDecision(
	recommendations: PptPlanningRecommendations,
	draft: PptPlanningDraft | null,
): PptPlanningDecision {
	return {
		directionId: draft?.directionId || recommendations.recommendedDirectionId,
		paletteId: draft?.paletteId || recommendations.recommendedPaletteId,
		typographyId: draft?.typographyId || recommendations.recommendedTypographyId,
		imageStrategyId: recommendations.recommendedImageStrategyId,
	};
}

function buildDesignSubmission(
	stage: PptPlanningConfirmationStage,
	decision: PptPlanningDecision | null,
) {
	if (!decision) return null;
	if (stage === "direction") {
		return { kind: "design", stage, directionId: decision.directionId };
	}
	if (stage === "design-system") {
		return {
			kind: "design",
			stage,
			paletteId: decision.paletteId,
			typographyId: decision.typographyId,
		};
	}
	return {
		kind: "design",
		stage,
		imageStrategyId: decision.imageStrategyId,
	};
}

function ConfirmationFooter({
	submitting,
	onSubmit,
}: {
	submitting: boolean;
	onSubmit: () => void;
}) {
	return (
		<div className="flex justify-end border-t bg-muted/20 px-5 py-4">
			<Button type="button" onClick={onSubmit} disabled={submitting}>
				{submitting ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Check className="size-4" />
				)}
				确认并继续生成
			</Button>
		</div>
	);
}

function PaletteSwatches({
	option,
}: {
	option: PptPlanningRecommendations["palettes"][number];
}) {
	return (
		<div className="flex shrink-0 overflow-hidden rounded border">
			{[
				option.background,
				option.secondaryBackground,
				option.primary,
				option.accent,
				option.bodyText,
			].map((color, index) => (
				<span
					key={`${option.id}-${index}`}
					className="size-6"
					style={{ backgroundColor: color }}
					title={color}
				/>
			))}
		</div>
	);
}

function ChoiceSection({
	icon,
	title,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="grid gap-3 px-5 py-4 lg:grid-cols-[140px_1fr]">
			<h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
				{icon}
				{title}
			</h3>
			<div className="grid gap-2 lg:grid-cols-3">{children}</div>
		</section>
	);
}

function Choice({
	name,
	selected,
	recommended,
	title,
	detail,
	meta,
	visual,
	onSelect,
}: {
	name: string;
	selected: boolean;
	recommended: boolean;
	title: string;
	detail: string;
	meta?: string;
	visual?: React.ReactNode;
	onSelect: () => void;
}) {
	return (
		<label
			className={cn(
				"relative flex min-h-28 cursor-pointer flex-col border p-3 transition-colors",
				selected
					? "border-primary bg-primary/5 ring-1 ring-primary"
					: "border-border hover:bg-muted/40",
			)}
		>
			<input
				type="radio"
				name={name}
				checked={selected}
				onChange={onSelect}
				className="sr-only"
			/>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-medium">{title}</span>
					{recommended && <Badge variant="secondary">推荐</Badge>}
				</div>
				{visual}
			</div>
			<p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{detail}</p>
			{meta && <p className="mt-auto truncate pt-2 text-xs font-medium">{meta}</p>}
		</label>
	);
}
