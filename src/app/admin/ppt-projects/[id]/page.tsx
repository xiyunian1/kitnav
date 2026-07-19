import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "PPT 记录详情" };

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "草稿", variant: "outline" },
  PENDING: { label: "等待中", variant: "secondary" },
  QUEUED: { label: "排队中", variant: "secondary" },
  GENERATING: { label: "生成中", variant: "secondary" },
  STRATEGIZING: { label: "规划中", variant: "secondary" },
  AWAITING_CONFIRMATION: { label: "等待确认", variant: "secondary" },
  ACQUIRING_IMAGES: { label: "采集素材", variant: "secondary" },
  EXECUTING: { label: "生成中", variant: "secondary" },
  EXPORTING: { label: "导出中", variant: "secondary" },
  READY: { label: "已完成", variant: "default" },
  COMPLETED: { label: "已完成", variant: "default" },
  FAILED: { label: "失败", variant: "destructive" },
};

function formatDate(value: Date | null) {
  if (!value) return "-";
  return value.toLocaleString("zh-CN");
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function parseParams(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export default async function AdminPptProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.pptProject.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  if (!project) notFound();

  const meta = STATUS_META[project.status] || {
    label: project.status,
    variant: "outline" as const,
  };
  const logs = project.logs?.split("\n").filter(Boolean) ?? [];
  const paramsText = parseParams(project.params);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold">{project.title}</h1>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{project.id}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/ppt-projects">返回列表</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">用户</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">昵称：</span>
              <Link href={`/admin/users/${project.userId}`} className="font-medium hover:underline">
                {project.user.name || "—"}
              </Link>
            </div>
            <div>
              <span className="text-muted-foreground">邮箱：</span>
              {project.user.email}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">生成状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">阶段：</span>
              {project.currentPhase || meta.label}
            </div>
            <div>
              <span className="text-muted-foreground">进度：</span>
              {project.progress}%
            </div>
            <div>
              <span className="text-muted-foreground">错误：</span>
              {project.error || "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">计费</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">积分：</span>
              {project.creditsCost}
            </div>
            <div>
              <span className="text-muted-foreground">自带 API：</span>
              {project.usedOwnKey ? "是" : "否"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目参数</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <Info label="来源" value={project.sourceType} />
          <Info label="页数" value={project.slideCount} />
          <Info label="比例" value={project.aspectRatio} />
          <Info label="风格" value={project.style} />
          <Info label="模板" value={project.template} />
          <Info label="创建时间" value={formatDate(project.createdAt)} />
          <Info label="更新时间" value={formatDate(project.updatedAt)} />
          <Info label="完成时间" value={formatDate(project.completedAt)} />
          <Info label="PPTX" value={project.pptxPath} wide />
          <Info label="项目目录" value={project.projectPath} wide />
        </CardContent>
      </Card>

      {paramsText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">完整入参</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {paramsText}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">生成日志</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无日志</p>
          ) : (
            <pre className="max-h-[520px] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
              {logs.join("\n")}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: unknown;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2 xl:col-span-4" : undefined}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words font-medium">{formatValue(value)}</div>
    </div>
  );
}
