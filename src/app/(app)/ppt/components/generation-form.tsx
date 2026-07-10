"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ArrowRight,
	Bot,
	Coins,
	FileText,
	KeyRound,
	Languages,
	LayoutTemplate,
	Loader2,
	Minus,
	Paperclip,
	Plus,
	Sparkles,
	Upload,
	X,
} from "lucide-react";
import { toast } from "sonner";
import { PPT_STYLE_PRESETS } from "@/lib/ppt-agent/styles";
import { CancelProjectButton } from "./cancel-project-button";
import { formatProjectDurationLabel } from "./duration";
import {
	PPT_STATUS_LABELS,
	PPT_USER_FAILURE_MESSAGE,
} from "@/lib/ppt-agent/status";
import type { ModuleModelOption } from "@/lib/module-model-options";
import { cn } from "@/lib/utils";

interface GenerationFormProps {
	modelOptions: ModuleModelOption[];
	creditsPerSlide: number;
}

interface UploadedFile {
	id: string;
	name: string;
	size: number;
}

type StyleSource = "preset" | "custom";

const DOCUMENT_ACCEPT =
	".pdf,.docx,.html,.htm,.epub,.ipynb,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.xlsx,.xlsm";
const TEMPLATE_ACCEPT = ".pptx,.pptm,.ppsx,.ppsm,.potx,.potm";

export function GenerationForm({
	modelOptions,
	creditsPerSlide,
}: GenerationFormProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [sourceFiles, setSourceFiles] = useState<UploadedFile[]>([]);
	const [uploading, setUploading] = useState(false);
	const [slideCount, setSlideCount] = useState(10);
	const [aspectRatio, setAspectRatio] = useState("16:9");
	const [style, setStyle] = useState("auto");
	const [styleSource, setStyleSource] = useState<StyleSource>("preset");
	const [customStyle, setCustomStyle] = useState("");
	const [modelValue, setModelValue] = useState(modelOptions[0]?.value ?? "");
	const [progress, setProgress] = useState(0);
	const [phase, setPhase] = useState("任务正在排队");
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const [now, setNow] = useState<number | null>(null);
	const [activeProjectId, setActiveProjectId] = useState("");
	const cancelledRef = useRef(false);

	const selectedModel =
		modelOptions.find((option) => option.value === modelValue) ?? modelOptions[0];
	const useOwnKey = selectedModel?.source === "user";
	const estimatedCost = useMemo(
		() => (useOwnKey ? 0 : slideCount * creditsPerSlide),
		[creditsPerSlide, slideCount, useOwnKey],
	);
	const attachmentCount = sourceFiles.length;
	const progressLabel = phase || progressMessage(progress);
	const durationLabel = formatProjectDurationLabel({
		startedAt,
		running: loading,
		now,
	});

	useEffect(() => {
		if (!loading) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [loading]);

	function updateSlideCount(value: number) {
		setSlideCount(Math.max(3, Math.min(30, Math.round(value))));
	}

	async function handleSubmit() {
		const normalizedPrompt = prompt.trim();
		if (!normalizedPrompt && sourceFiles.length === 0) {
			toast.error("请描述你想生成的 PPT，或上传文件资料。");
			return;
		}
		if (styleSource === "custom" && !customStyle.trim()) {
			toast.error("请填写自定义 PPT 风格描述。");
			return;
		}
		if (!selectedModel) {
			toast.error("暂无可用模型，请先在 API 设置中保存模型或联系管理员。");
			return;
		}

		setLoading(true);
		setProgress(0);
		setPhase("任务正在排队");
		const submitStartedAt = Date.now();
		setStartedAt(submitStartedAt);
		setNow(submitStartedAt);
		setActiveProjectId("");
		cancelledRef.current = false;

		let projectId = "";

		try {
			const res = await fetch("/api/ppt/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: normalizedPrompt,
					sourceFileUrls: sourceFiles.map((file) => file.id),
					slideCount,
					aspectRatio,
					style: styleSource === "preset" ? style : styleSource,
					customStyle:
						styleSource === "custom" ? customStyle.trim() : undefined,
					model: selectedModel.model,
					modelSource: selectedModel.source,
				}),
			});

			const data = await res.json().catch(() => null);
			if (!res.ok || !data?.projectId) {
				throw new Error(data?.error || "创建生成任务失败");
			}
			projectId = data.projectId;
			setActiveProjectId(projectId);

			// 生成已入队，由后台 worker 异步处理；轮询项目状态直到完成或失败。
			const POLL_INTERVAL_MS = 1500;
			const MAX_EMPTY_POLLS = 20;
			let emptyPolls = 0;
			while (true) {
				await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
				let status: {
					status?: string;
					progress?: number;
					currentPhase?: string | null;
					error?: string;
					createdAt?: string;
				} | null = null;
				try {
					const statusRes = await fetch(`/api/ppt/projects/${projectId}`);
					const data = await statusRes.json().catch(() => null);
					if (!statusRes.ok) {
						throw new Error(data?.error || "读取生成状态失败");
					}
					status = data;
				} catch {
					status = null;
				}
				if (status) {
					emptyPolls = 0;
					if (typeof status.progress === "number")
						setProgress(clampProgress(status.progress));
					if (status.createdAt) {
						const createdTime = new Date(status.createdAt).getTime();
						if (Number.isFinite(createdTime)) setStartedAt(createdTime);
					}
					if (status.currentPhase) {
						setPhase(status.currentPhase);
					} else if (status.status) {
						setPhase(PPT_STATUS_LABELS[status.status] ?? "正在生成 PPT");
					}
					if (status.status === "COMPLETED") {
						toast.success("PPT 生成完成。");
						router.push(`/ppt/${projectId}`);
						router.refresh();
						return;
					}
					if (status.status === "FAILED") {
						// 用户主动停止也会落到 FAILED：用 cancelledRef 区分提示文案。
						if (cancelledRef.current) {
							toast.info("已停止生成");
							router.refresh();
						} else {
							throw new Error(status.error || PPT_USER_FAILURE_MESSAGE);
						}
						return;
					}
				} else {
					emptyPolls += 1;
					if (emptyPolls >= MAX_EMPTY_POLLS) {
						throw new Error("暂时无法读取生成状态，请稍后在最近项目中查看结果。");
					}
				}
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "生成失败");
			if (projectId) router.refresh();
		} finally {
			setLoading(false);
			setActiveProjectId("");
		}
	}

	async function handleFileChange(files?: FileList | null) {
		const list = Array.from(files || []);
		if (list.length === 0) return;
		setUploading(true);
		try {
			const uploaded: UploadedFile[] = [];
			for (const file of list) {
				const form = new FormData();
				form.append("file", file);
				const res = await fetch("/api/ppt/upload", {
					method: "POST",
					body: form,
				});
				const data = await res.json().catch(() => null);
				if (!res.ok) throw new Error(data?.error || `${file.name} 上传失败`);
				uploaded.push({
					id: data.id,
					name: data.name || file.name,
					size: data.size || file.size,
				});
			}
			setSourceFiles((prev) => [...prev, ...uploaded]);
			toast.success(
				uploaded.length === 1
					? "文件已上传。"
					: `已上传 ${uploaded.length} 个文件。`,
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "文件上传失败");
		} finally {
			setUploading(false);
		}
	}

	return (
		<form
			className="mx-auto w-full max-w-[980px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (!loading && !uploading) void handleSubmit();
			}}
		>
			<div className="ppt-workspace-grid relative isolate px-0 py-3 sm:px-8 sm:py-7">
				<section className="relative z-10 overflow-hidden rounded-lg border border-border/80 bg-card shadow-[0_18px_60px_rgba(24,24,27,0.10)]">
					<div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2 sm:px-4">
						<div className="flex flex-wrap items-center gap-1">
							<div className="flex h-8 items-center gap-2 rounded-md bg-background px-3 text-sm font-medium shadow-sm ring-1 ring-border/70">
								<Sparkles className="size-4 text-violet-500" />
								智能生成
							</div>
							<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground">
								<FileText className="size-4" />
								从文件生成
								<input
									type="file"
									multiple
									accept={DOCUMENT_ACCEPT}
									disabled={uploading}
									onChange={(event) => {
										void handleFileChange(event.target.files);
										event.target.value = "";
									}}
									className="sr-only"
								/>
							</label>
							<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground">
								<LayoutTemplate className="size-4" />
								上传模板
								<input
									type="file"
									accept={TEMPLATE_ACCEPT}
									disabled={uploading}
									onChange={(event) => {
										void handleFileChange(event.target.files);
										event.target.value = "";
									}}
									className="sr-only"
								/>
							</label>
						</div>
						<span className="text-xs text-muted-foreground">
							{prompt.length.toLocaleString("zh-CN")} / 80,000
						</span>
					</div>

					<div className="px-4 pt-3 sm:px-5">
						<Textarea
							id="pptPrompt"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							rows={6}
							maxLength={80000}
							placeholder="描述你的主题、受众和想表达的重点，或直接上传资料文档……"
							className="min-h-40 resize-none border-0 bg-transparent px-0 text-[15px] leading-7 shadow-none focus-visible:ring-0"
						/>

						{attachmentCount > 0 && (
							<div className="flex flex-wrap gap-2 pb-3">
								{sourceFiles.map((file) => (
									<AttachmentRow
										key={file.id}
										icon={<Paperclip className="size-3.5" />}
										label={`${file.name} · ${formatBytes(file.size)}`}
										onRemove={() =>
											setSourceFiles((prev) =>
												prev.filter((item) => item.id !== file.id),
											)
										}
									/>
								))}
							</div>
						)}

						<div className="flex items-center justify-between gap-3 border-t py-3">
							<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
								<label
									title="上传资料或 PPT 模板"
									className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
								>
									{uploading ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Paperclip className="size-4" />
									)}
									<input
										type="file"
										multiple
										accept={DOCUMENT_ACCEPT}
										disabled={uploading}
										onChange={(event) => {
											void handleFileChange(event.target.files);
											event.target.value = "";
										}}
										className="sr-only"
									/>
								</label>
								<span className="flex items-center gap-1.5 rounded-md bg-muted/70 px-2.5 py-1.5 text-xs text-foreground">
									{useOwnKey ? (
										<KeyRound className="size-3.5" />
									) : (
										<Coins className="size-3.5" />
									)}
									{!selectedModel
										? "暂无可用模型"
										: useOwnKey
											? "自带 API"
											: `${creditsPerSlide} 积分 / 页`}
								</span>
							</div>

							<Button
								type="submit"
								size="icon"
								disabled={loading || uploading || !selectedModel}
								className="size-10 shrink-0 rounded-full"
								title={loading ? "正在生成" : "开始生成"}
							>
								{loading || uploading ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<ArrowRight className="size-5" />
								)}
								<span className="sr-only">开始生成</span>
							</Button>
						</div>
					</div>

					{styleSource === "custom" && (
						<div className="border-t bg-muted/15 px-4 py-3 sm:px-5">
							<label htmlFor="pptCustomStyle" className="mb-2 block text-sm font-medium">
								自定义视觉方向
							</label>
							<Textarea
								id="pptCustomStyle"
								value={customStyle}
								onChange={(event) => setCustomStyle(event.target.value)}
								rows={3}
								maxLength={2000}
								placeholder="例如：深色科技风，强调架构图和产品发布感。"
								className="resize-y bg-background"
							/>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2 border-t bg-muted/15 px-3 py-2.5 sm:px-4">
						<div className="flex h-9 items-center rounded-md border bg-background px-1">
							<span className="px-2 text-xs text-muted-foreground">页数</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={slideCount <= 3}
								onClick={() => updateSlideCount(slideCount - 1)}
								className="size-7"
								title="减少页数"
							>
								<Minus className="size-3.5" />
							</Button>
							<span className="w-12 text-center text-sm font-medium">{slideCount} 页</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={slideCount >= 30}
								onClick={() => updateSlideCount(slideCount + 1)}
								className="size-7"
								title="增加页数"
							>
								<Plus className="size-3.5" />
							</Button>
						</div>

						<Select value={aspectRatio} onValueChange={setAspectRatio}>
							<SelectTrigger className="h-9 w-[104px] bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="16:9">16:9</SelectItem>
								<SelectItem value="4:3">4:3</SelectItem>
							</SelectContent>
						</Select>

						<Select
							value={selectedModel?.value}
							onValueChange={setModelValue}
							disabled={modelOptions.length === 0}
						>
							<SelectTrigger className="h-9 w-[220px] max-w-full bg-background">
								<Bot className="size-3.5 text-muted-foreground" />
								<SelectValue placeholder="暂无可用模型" />
							</SelectTrigger>
							<SelectContent>
								{modelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										<span className="flex min-w-0 items-center gap-2">
											<span className="truncate">{option.model}</span>
											<span
												className={cn(
													"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
													option.source === "user"
														? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
														: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
												)}
											>
												{option.sourceLabel}
											</span>
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<Select
							value={styleSource === "custom" ? "custom" : style}
							onValueChange={(value) => {
								if (value === "custom") {
									setStyleSource("custom");
									return;
								}
								setStyleSource("preset");
								setStyle(value);
							}}
						>
							<SelectTrigger className="h-9 w-[148px] bg-background">
								<Sparkles className="size-3.5 text-muted-foreground" />
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{PPT_STYLE_PRESETS.map((preset) => (
									<SelectItem key={preset.id} value={preset.id}>
										{preset.label}
									</SelectItem>
								))}
								<SelectItem value="custom">自定义风格</SelectItem>
							</SelectContent>
						</Select>

						<div className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground">
							<Languages className="size-4" />
							简体中文
						</div>

						<div className="ml-auto flex h-9 items-center px-2 text-sm">
							<span className="text-muted-foreground">预估</span>
							<span className="ml-1.5 font-medium">
								{!selectedModel
									? "--"
									: useOwnKey
										? "0 积分"
										: `${estimatedCost} 积分`}
							</span>
						</div>
					</div>

					{loading && (
						<div className="border-t px-4 py-3 sm:px-5">
							<div className="mb-2 flex items-center justify-between gap-3 text-sm">
								<div className="min-w-0">
									<p className="truncate font-medium">{progressLabel}</p>
									{durationLabel && (
										<p className="mt-0.5 text-xs text-muted-foreground">
											{durationLabel}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground">{progress}%</span>
									{activeProjectId && (
										<CancelProjectButton
											projectId={activeProjectId}
											size="sm"
											variant="destructive"
											onCancelled={() => {
												cancelledRef.current = true;
											}}
										/>
									)}
								</div>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					)}
				</section>

				<div className="relative z-10 mt-4 flex flex-wrap justify-center gap-2">
					<label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted">
						<span className="flex size-6 items-center justify-center rounded-md bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
							<Upload className="size-3.5" />
						</span>
						上传资料
						<input
							type="file"
							multiple
							accept={DOCUMENT_ACCEPT}
							disabled={uploading}
							onChange={(event) => {
								void handleFileChange(event.target.files);
								event.target.value = "";
							}}
							className="sr-only"
						/>
					</label>
					<label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted">
						<span className="flex size-6 items-center justify-center rounded-md bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
							<LayoutTemplate className="size-3.5" />
						</span>
						上传模板
						<input
							type="file"
							accept={TEMPLATE_ACCEPT}
							disabled={uploading}
							onChange={(event) => {
								void handleFileChange(event.target.files);
								event.target.value = "";
							}}
							className="sr-only"
						/>
					</label>
				</div>
			</div>
		</form>
	);
}

function AttachmentRow({
	icon,
	label,
	onRemove,
}: {
	icon: React.ReactNode;
	label: string;
	onRemove: () => void;
}) {
	return (
		<div className="flex max-w-full items-center gap-2 rounded-md border bg-muted/35 py-1.5 pr-1.5 pl-2.5 text-xs">
			<span className="text-muted-foreground">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={onRemove}
				aria-label="移除附件"
				className="size-6 shrink-0"
			>
				<X className="size-3.5" />
			</Button>
		</div>
	);
}

function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
	if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function clampProgress(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function progressMessage(progress: number) {
	if (progress <= 0) return "任务正在排队";
	return "正在生成 PPT";
}
