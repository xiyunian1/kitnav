"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { isPptProcessingStatus, PPT_STATUS_LABELS } from "@/lib/ppt-agent/status";
import { formatProjectDurationLabel } from "../components/duration";

interface ProjectStatusSnapshot {
	id: string;
	status: string;
	progress: number;
	currentPhase: string | null;
	error: string | null;
	createdAt?: string;
	completedAt?: string | null;
	updatedAt?: string;
}

interface ProjectStatusCardProps {
	initial: ProjectStatusSnapshot;
}

export function ProjectStatusCard({ initial }: ProjectStatusCardProps) {
	const router = useRouter();
	const [snapshot, setSnapshot] = useState(initial);
	const [now, setNow] = useState<number | null>(null);
	const isProcessing = isPptProcessingStatus(snapshot.status);
	const progress = clampProgress(snapshot.progress);
	const phase =
		snapshot.currentPhase || PPT_STATUS_LABELS[snapshot.status] || "处理中";
	const durationLabel = formatProjectDurationLabel({
		startedAt: snapshot.createdAt,
		completedAt: snapshot.completedAt,
		updatedAt: snapshot.updatedAt,
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
		let lastStatus = snapshot.status;

		const poll = async () => {
			try {
				const res = await fetch(`/api/ppt/projects/${initial.id}`, {
					cache: "no-store",
				});
				const data = (await res.json().catch(() => null)) as
					| ProjectStatusSnapshot
					| null;
				if (!res.ok || !data || cancelled) return;
				setSnapshot((prev) => ({ ...prev, ...data }));
				if (lastStatus !== data.status) {
					lastStatus = data.status;
					router.refresh();
				}
				if (!isPptProcessingStatus(data.status)) router.refresh();
			} catch {
				// 下一轮轮询会重试，避免瞬时网络错误打断详情页。
			}
		};

		const interval = window.setInterval(poll, 2500);
		void poll();
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [initial.id, isProcessing, router, snapshot.status]);

	return (
		<Card className="p-4">
			<div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium">{phase}</p>
					{durationLabel && (
						<p className="mt-1 text-xs text-muted-foreground">
							{durationLabel}
						</p>
					)}
				</div>
				<span className="shrink-0 text-muted-foreground">{progress}%</span>
			</div>
			<div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-all"
					style={{ width: `${progress}%` }}
				/>
			</div>
			{snapshot.error && (
				<p className="mt-3 text-sm text-destructive">{snapshot.error}</p>
			)}
		</Card>
	);
}

function clampProgress(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, Math.round(value)));
}
