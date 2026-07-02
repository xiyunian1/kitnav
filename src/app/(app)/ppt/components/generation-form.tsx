"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Loader2,
	Minus,
	Paperclip,
	Plus,
	Presentation,
	Sparkles,
	Trash2,
	Upload,
} from "lucide-react";
import { toast } from "sonner";
import { PPT_STYLE_PRESETS } from "@/lib/ppt-agent/styles";
import { CancelProjectButton } from "./cancel-project-button";
import { formatProjectDurationLabel } from "./duration";
import {
	PPT_STATUS_LABELS,
	PPT_USER_FAILURE_MESSAGE,
} from "@/lib/ppt-agent/status";
import type { PptTemplateOption } from "@/lib/ppt-agent/templates";

interface GenerationFormProps {
	useOwnKey: boolean;
	creditsPerSlide: number;
	templateOptions: PptTemplateOption[];
}

interface UploadedFile {
	id: string;
	name: string;
	size: number;
}

type StyleSource = "preset" | "custom";

export function GenerationForm({
	useOwnKey,
	creditsPerSlide,
	templateOptions,
}: GenerationFormProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [sourceFiles, setSourceFiles] = useState<UploadedFile[]>([]);
	const [uploading, setUploading] = useState(false);
	const [slideCount, setSlideCount] = useState(10);
	const [aspectRatio, setAspectRatio] = useState("16:9");
	const [template, setTemplate] = useState("none");
	const [style, setStyle] = useState("general");
	const [styleSource, setStyleSource] = useState<StyleSource>("preset");
	const [customStyle, setCustomStyle] = useState("");
	const [progress, setProgress] = useState(0);
	const [phase, setPhase] = useState("任务正在排队");
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const [now, setNow] = useState<number | null>(null);
	const [activeProjectId, setActiveProjectId] = useState("");
	const cancelledRef = useRef(false);

	const estimatedCost = useMemo(
		() => (useOwnKey ? 0 : slideCount * creditsPerSlide),
		[creditsPerSlide, slideCount, useOwnKey],
	);
	const attachmentCount = sourceFiles.length;
	const selectedStylePreset = PPT_STYLE_PRESETS.find(
		(preset) => preset.id === style,
	);
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
					template: template === "none" ? undefined : template,
					style: styleSource === "preset" ? style : styleSource,
					customStyle:
						styleSource === "custom" ? customStyle.trim() : undefined,
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
			className="grid min-w-0 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (!loading && !uploading) void handleSubmit();
			}}
		>
			<div className="space-y-5">
				<section className="rounded-lg border bg-card p-5 shadow-sm">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold">内容 brief</h2>
							<p className="text-sm text-muted-foreground">
								主题、受众、结构、素材重点
							</p>
						</div>
						<div className="rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
							{prompt.length.toLocaleString("zh-CN")} / 80,000
						</div>
					</div>
					<Textarea
						id="pptPrompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						rows={10}
						maxLength={80000}
						placeholder="例如：12 页中文融资路演 PPT，面向投资人。重点突出市场规模、产品壁垒、商业模式、增长数据和融资用途。风格要像成熟 SaaS 公司路演稿。"
						className="min-h-72 resize-y border-muted-foreground/20 bg-background text-[15px] leading-7 shadow-none"
					/>
				</section>

				<section className="rounded-lg border bg-card p-5 shadow-sm">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold">参考资料</h2>
							<p className="text-sm text-muted-foreground">
								{attachmentCount > 0
									? `${attachmentCount} 个素材`
									: "上传资料文档或 PPT 模板"}
							</p>
						</div>
						<Paperclip className="size-4 text-muted-foreground" />
					</div>

					<div className="space-y-2">
						<Label htmlFor="sourceFiles">文件</Label>
						<label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted/60">
							{uploading ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Upload className="size-4" />
							)}
							{uploading ? "上传中" : "选择文件"}
							<input
								id="sourceFiles"
								type="file"
								multiple
								accept=".pdf,.docx,.html,.htm,.epub,.ipynb,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.xlsx,.xlsm"
								disabled={uploading}
								onChange={(event) => handleFileChange(event.target.files)}
								className="sr-only"
							/>
						</label>
						<p className="text-xs text-muted-foreground">
							PPT/POT/PPS 文件会作为模板导入，PDF、Word、Excel 等文件会作为内容资料。
						</p>
					</div>

					{attachmentCount > 0 && (
						<div className="mt-4 space-y-2">
							{sourceFiles.map((file) => (
								<AttachmentRow
									key={file.id}
									icon={<Paperclip className="size-4" />}
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
				</section>

				{loading && (
					<section className="rounded-lg border bg-card p-5 shadow-sm">
						<div className="mb-3 flex items-center justify-between text-sm">
							<span className="min-w-0 truncate font-medium">
								{progressLabel}
							</span>
							<span className="text-muted-foreground">{progress}%</span>
						</div>
						<div className="h-2 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
						{durationLabel && (
							<p className="mt-3 text-xs text-muted-foreground">
								{durationLabel}
							</p>
						)}
					</section>
				)}
			</div>

			<aside className="space-y-4 2xl:sticky 2xl:top-20 2xl:max-h-[calc(100dvh-15rem)] 2xl:self-start 2xl:overflow-y-auto 2xl:pr-1">
				<section className="rounded-lg border bg-card p-5 shadow-sm">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold">输出设置</h2>
							<p className="text-sm text-muted-foreground">
								{useOwnKey ? "使用自带 API" : `${creditsPerSlide} 积分 / 页`}
							</p>
						</div>
						<Presentation className="size-4 text-muted-foreground" />
					</div>

					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="slideCount">页数</Label>
							<div className="grid grid-cols-[40px_minmax(0,1fr)_40px] gap-2">
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => updateSlideCount(slideCount - 1)}
								>
									<Minus className="size-4" />
								</Button>
								<Input
									id="slideCount"
									type="number"
									min={3}
									max={30}
									value={slideCount}
									onChange={(event) =>
										updateSlideCount(Number(event.target.value) || 10)
									}
									className="h-10 text-center"
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => updateSlideCount(slideCount + 1)}
								>
									<Plus className="size-4" />
								</Button>
							</div>
						</div>

						<div className="space-y-2">
							<Label>画布</Label>
							<div className="grid grid-cols-2 gap-2">
								{["16:9", "4:3"].map((value) => (
									<Button
										key={value}
										type="button"
										variant={aspectRatio === value ? "default" : "outline"}
										onClick={() => setAspectRatio(value)}
										className="h-10"
									>
										{value}
									</Button>
								))}
							</div>
						</div>

						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">预估消耗</span>
								<span className="font-medium">
									{useOwnKey ? "0 积分" : `${estimatedCost} 积分`}
								</span>
							</div>
						</div>
					</div>
				</section>

				<section className="rounded-lg border bg-card p-5 shadow-sm">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold">视觉方向</h2>
							<p className="text-sm text-muted-foreground">
								{styleSource === "custom"
									? "自定义风格"
									: selectedStylePreset?.label}
							</p>
						</div>
						<Sparkles className="size-4 text-muted-foreground" />
					</div>

					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="template">模板</Label>
							<Select value={template} onValueChange={setTemplate}>
								<SelectTrigger id="template" className="h-10 w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">自由设计</SelectItem>
									{templateOptions.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<Tabs
							value={styleSource}
							onValueChange={(value) => setStyleSource(value as StyleSource)}
						>
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="preset">预设</TabsTrigger>
								<TabsTrigger value="custom">自定义</TabsTrigger>
							</TabsList>

							<TabsContent value="preset" className="mt-3 space-y-2">
								<Select value={style} onValueChange={setStyle}>
									<SelectTrigger id="style" className="h-10 w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PPT_STYLE_PRESETS.map((preset) => (
											<SelectItem key={preset.id} value={preset.id}>
												{preset.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									{selectedStylePreset?.description}
								</p>
							</TabsContent>

							<TabsContent value="custom" className="mt-3">
								<Textarea
									value={customStyle}
									onChange={(event) => setCustomStyle(event.target.value)}
									rows={5}
									maxLength={2000}
									placeholder="深色科技风，强调架构图、流程节点和产品发布感；避免模板化卡片堆叠。"
									className="resize-y bg-background"
								/>
							</TabsContent>
						</Tabs>
					</div>
				</section>

				<section className="rounded-lg border bg-card p-4 shadow-sm">
					<Button
						type="submit"
						disabled={loading || uploading}
						className="h-11 w-full"
					>
						{loading || uploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Presentation className="size-4" />
						)}
						{uploading
							? "正在上传文件"
							: loading
								? "正在生成"
								: useOwnKey
									? "开始生成"
									: `开始生成 · ${estimatedCost} 积分`}
					</Button>
					{loading && activeProjectId && (
						<CancelProjectButton
							projectId={activeProjectId}
							size="default"
							variant="destructive"
							onCancelled={() => {
								cancelledRef.current = true;
							}}
							className="mt-2 w-full"
						/>
					)}
				</section>
			</aside>
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
		<div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm">
			<span className="text-muted-foreground">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Button
				type="button"
				variant="outline"
				size="icon"
				onClick={onRemove}
				aria-label="移除附件"
			>
				<Trash2 className="size-4" />
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
