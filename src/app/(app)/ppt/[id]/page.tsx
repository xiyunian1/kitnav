import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireModulePageAccess, getStaticModuleMeta } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Download, RefreshCw } from "lucide-react";
import { getProjectSvgPreviews } from "@/lib/ppt-agent/paths";
import { CancelProjectButton } from "../components/cancel-project-button";

export const metadata = { title: "PPT 项目" };

const STATUS_LABELS: Record<string, string> = {
  PENDING: "等待中",
  QUEUED: "排队中",
  STRATEGIZING: "规划中",
  ACQUIRING_IMAGES: "采集素材",
  EXECUTING: "生成中",
  EXPORTING: "导出中",
  COMPLETED: "已完成",
  FAILED: "失败",
};
const PROCESSING_STATUSES = ["PENDING", "QUEUED", "STRATEGIZING", "ACQUIRING_IMAGES", "EXECUTING", "EXPORTING"];

export default async function PptProjectPage({ params }: { params: Promise<{ id: string }> }) {
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
  const logs = project.logs?.split("\n").filter(Boolean).slice(-20) ?? [];
  const isProcessing = PROCESSING_STATUSES.includes(project.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{project.title}</h1>
            <Badge variant={project.status === "FAILED" ? "destructive" : "secondary"}>
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {project.slideCount ?? "-"} 页 · {project.aspectRatio} · 消耗 {project.creditsCost} 积分
          </p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/ppt">
              <RefreshCw className="size-4" />
              返回列表
            </Link>
          </Button>
          {project.status === "COMPLETED" && project.pptxPath && (
            <Button asChild>
              <a href={`/api/ppt/projects/${project.id}/export`}>
                <Download className="size-4" />
                下载 PPTX
              </a>
            </Button>
          )}
          {isProcessing && <CancelProjectButton projectId={project.id} size="default" variant="destructive" />}
        </div>
      </div>

      {project.status !== "COMPLETED" && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{project.currentPhase || STATUS_LABELS[project.status] || "处理中"}</span>
            <span className="text-muted-foreground">{project.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} />
          </div>
          {project.error && <p className="mt-3 text-sm text-destructive">{project.error}</p>}
        </Card>
      )}

      {previews.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {previews.map((preview, index) => (
            <Card key={preview.url} className="overflow-hidden p-0">
              <div className="border-b px-4 py-2 text-sm font-medium">第 {index + 1} 页</div>
              <div className="bg-muted/30 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt={`第 ${index + 1} 页预览`} className="w-full rounded border bg-white" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">生成日志</h2>
          <div className="max-h-80 space-y-1 overflow-auto text-xs text-muted-foreground">
            {logs.map((item, index) => (
              <p key={`${item}-${index}`} className="font-mono">
                {item}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
