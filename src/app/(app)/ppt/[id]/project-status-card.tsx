"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { isPptProcessingStatus, PPT_STATUS_LABELS } from "@/lib/ppt-agent/status";
import type { ProjectSvgPreview } from "@/lib/ppt-agent/paths";
import { formatProjectDurationLabel } from "../components/duration";

interface ProjectStatusSnapshot {
	id: string;
	status: string;
	currentPhase: string | null;
	error: string | null;
	createdAt?: string;
	completedAt?: string | null;
	updatedAt?: string;
	confirmationWaitDurationMs?: number;
	confirmationWaitStartedAt?: string | null;
	slideCount?: number | null;
	aspectRatio?: string;
	previews?: ProjectSvgPreview[];
}

interface ProjectStatusCardProps {
	initial: ProjectStatusSnapshot;
	initialPreviews: ProjectSvgPreview[];
	children?: ReactNode;
}

export function ProjectStatusCard({
	initial,
	initialPreviews,
	children,
}: ProjectStatusCardProps) {
	const router = useRouter();
	const [snapshot, setSnapshot] = useState(initial);
	const [now, setNow] = useState<number | null>(null);
	const isProcessing = isPptProcessingStatus(snapshot.status);
	const isWaitingForConfirmation = snapshot.status === "AWAITING_CONFIRMATION";
	const isActivelyRunning = isProcessing && !isWaitingForConfirmation;
	const phase =
		snapshot.currentPhase || PPT_STATUS_LABELS[snapshot.status] || "处理中";
	const previews = snapshot.previews ?? initialPreviews;
	const totalSlides = snapshot.slideCount;
	const generatedSlides =
		typeof totalSlides === "number"
			? Math.min(previews.length, totalSlides)
			: previews.length;
	const previewAspectClass =
		snapshot.aspectRatio === "4:3" ? "aspect-[4/3]" : "aspect-video";
	const durationLabel = formatProjectDurationLabel({
		startedAt: snapshot.createdAt,
		completedAt: snapshot.completedAt,
		updatedAt: snapshot.updatedAt,
		pausedDurationMs: snapshot.confirmationWaitDurationMs,
		pausedAt: snapshot.confirmationWaitStartedAt,
		running: isProcessing,
		now,
	});

	useEffect(() => {
		if (!isProcessing) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [isProcessing]);

	useEffect(() => {
		if (!isProcessing) return;
		let cancelled = false;
		let timeout: number | undefined;

		const poll = async () => {
			let shouldPollAgain = true;
			try {
				const res = await fetch(`/api/ppt/projects/${initial.id}`, {
					cache: "no-store",
				});
				const data = (await res.json().catch(() => null)) as
					| ProjectStatusSnapshot
						| null;
				if (!res.ok || !data || cancelled) return;
				setSnapshot((prev) => ({ ...prev, ...data }));
				const nextIsProcessing = isPptProcessingStatus(data.status);
				if (snapshot.status !== data.status || !nextIsProcessing) {
					router.refresh();
				}
				if (!nextIsProcessing) {
					shouldPollAgain = false;
				}
			} catch {
				// 下一轮轮询会重试，避免瞬时网络错误打断详情页。
			} finally {
				if (!cancelled && shouldPollAgain) {
					timeout = window.setTimeout(poll, 2000);
				}
			}
		};

		void poll();
		return () => {
			cancelled = true;
			if (timeout !== undefined) window.clearTimeout(timeout);
		};
	}, [initial.id, isProcessing, router, snapshot.status]);

	return (
		<div className="space-y-6">
			<Card className="p-4">
				<div className="flex items-start gap-3 text-sm">
					{isActivelyRunning && (
						<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
					)}
					<div className="min-w-0" role="status" aria-live="polite">
						<p className="font-medium">
							{phase}
						</p>
						{typeof totalSlides === "number" && totalSlides > 0 && (
							<p className="mt-1 text-xs text-muted-foreground">
								已生成 {generatedSlides} / {totalSlides} 页
							</p>
						)}
						{durationLabel && (
							<p className="mt-1 text-xs text-muted-foreground">
								{durationLabel}
							</p>
						)}
					</div>
				</div>
				{snapshot.error && (
					<p className="mt-3 text-sm text-destructive">{snapshot.error}</p>
				)}
			</Card>

			{children}

			{previews.length > 0 && (
				<div className="grid gap-4 md:grid-cols-2">
					{previews.map((preview, index) => (
						<Card key={preview.filename} className="overflow-hidden p-0">
							<div className="border-b px-4 py-2 text-sm font-medium">
								第 {index + 1} 页
							</div>
							<div className="bg-muted/30 p-3">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={preview.url}
									alt={`第 ${index + 1} 页预览`}
									className={`w-full rounded border bg-white object-contain ${previewAspectClass}`}
								/>
							</div>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
