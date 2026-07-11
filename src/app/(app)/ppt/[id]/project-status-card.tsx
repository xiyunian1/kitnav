"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { isPptProcessingStatus, PPT_STATUS_LABELS } from "@/lib/ppt-agent/status";
import { formatProjectDurationLabel } from "../components/duration";

interface ProjectStatusSnapshot {
	id: string;
	status: string;
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
			<div className="flex items-start gap-3 text-sm">
				{isProcessing && (
					<Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
				)}
				<div className="min-w-0">
					<p className="font-medium" role="status" aria-live="polite">
						{phase}
					</p>
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
	);
}
