import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
	requireModulePageAccess,
	getStaticModuleMeta,
} from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw } from "lucide-react";
import { getProjectSvgPreviews } from "@/lib/ppt-agent/paths";
import { CancelProjectButton } from "../components/cancel-project-button";
import { ProjectStatusCard } from "./project-status-card";
import { PlanningConfirmationPanel } from "./planning-confirmation-panel";
import {
	isPptCompletedStatus,
	isPptProcessingStatus,
	PPT_STATUS_LABELS,
	PPT_USER_FAILURE_MESSAGE,
} from "@/lib/ppt-agent/status";
import {
	resolvePptActiveGenerationTiming,
	resolvePptConfirmationTiming,
} from "@/lib/ppt-agent/timing";
import { summarizePptProjectInput } from "@/lib/ppt-agent/project-input-summary";
import { ProjectInputSummaryCard } from "./project-input-summary-card";
import { RetryProjectButton } from "../components/retry-project-button";
import { canRetryPptProject } from "@/lib/ppt-agent/retry-state";

export const metadata = { title: "PPT 项目" };

export default async function PptProjectPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const session = await auth();
	const access = await requireModulePageAccess("ppt");

	if (!access.usable) {
		const meta = getStaticModuleMeta("ppt");
		return (
			<ModuleUnavailable
				name={access.name}
				message={access.message}
				status={access.status}
				icon={meta?.icon}
			/>
		);
	}

	const { id } = await params;
	const project = await prisma.pptProject.findFirst({
		where: { id, userId: session!.user.id },
	});

	if (!project) notFound();

	const previews = await getProjectSvgPreviews(project.id);
	const isProcessing = isPptProcessingStatus(project.status);
	const canRetry = canRetryPptProject(project);
	const confirmationTiming = resolvePptConfirmationTiming(project);
	const activeGenerationTiming = resolvePptActiveGenerationTiming(project);
	const inputSummary = isPptCompletedStatus(project.status)
		? summarizePptProjectInput(project)
		: null;

	return (
		<div className="mx-auto w-full max-w-[1600px] space-y-6">
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-3xl font-bold">{project.title}</h1>
						<Badge
							variant={
								project.status === "FAILED" ? "destructive" : "secondary"
							}
						>
							{PPT_STATUS_LABELS[project.status] ?? project.status}
						</Badge>
					</div>
					<p className="text-muted-foreground">
						{project.slideCount ?? "-"} 页 · {project.aspectRatio} · 消耗{" "}
						{project.creditsCost} 积分
					</p>
					{project.artifactsDeletedAt && (
						<p className="text-sm text-amber-700">
							生成文件已超过保留期限，项目记录仍保留；需要下载时请重新生成。
						</p>
					)}
				</div>

				<div className="flex gap-2">
					<Link href="/ppt" className={buttonVariants({ variant: "outline" })}>
						<RefreshCw className="size-4" />
						返回列表
					</Link>
					{isPptCompletedStatus(project.status) && project.pptxPath && (
						<a
							href={`/api/ppt/projects/${project.id}/export`}
							className={buttonVariants()}
						>
							<Download className="size-4" />
							下载 PPTX
						</a>
					)}
					{isProcessing && (
						<CancelProjectButton
							projectId={project.id}
							size="default"
							variant="destructive"
						/>
					)}
					{canRetry && (
						<RetryProjectButton
							projectId={project.id}
							size="default"
							variant="default"
						/>
					)}
				</div>
			</div>

			<ProjectStatusCard
				initial={{
					id: project.id,
					status: project.status,
					currentPhase: project.currentPhase,
					error:
						project.status === "FAILED" ? PPT_USER_FAILURE_MESSAGE : null,
					updatedAt: project.updatedAt.toISOString(),
					confirmationWaitDurationMs:
						confirmationTiming.confirmationWaitDurationMs,
					confirmationWaitStartedAt:
						confirmationTiming.confirmationWaitStartedAt?.toISOString() ?? null,
					activeGenerationDurationMs:
						activeGenerationTiming.activeGenerationDurationMs,
					activeGenerationStartedAt:
						activeGenerationTiming.activeGenerationStartedAt?.toISOString() ?? null,
					slideCount: project.slideCount,
					aspectRatio: project.aspectRatio,
				}}
				initialPreviews={previews}
			>
				{inputSummary && <ProjectInputSummaryCard summary={inputSummary} />}
			</ProjectStatusCard>

			{project.status === "AWAITING_CONFIRMATION" && (
				<PlanningConfirmationPanel projectId={project.id} />
			)}

		</div>
	);
}
