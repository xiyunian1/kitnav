"use client";

import type { ReactNode } from "react";
import { Copy, FileText, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PptProjectInputSummary } from "@/lib/ppt-agent/project-input-summary";
import { formatPptProjectInputSummary } from "@/lib/ppt-agent/project-input-summary-format";

export function ProjectInputSummaryCard({
  summary,
}: {
  summary: PptProjectInputSummary;
}) {
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(formatPptProjectInputSummary(summary));
      toast.success("本次输入已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">本次输入</h2>
        <Button type="button" variant="outline" size="sm" onClick={copyAll}>
          <Copy className="size-4" />
          复制全部
        </Button>
      </div>

      {summary.textSections.length > 0 && (
        <div className="mt-4 space-y-4">
          {summary.textSections.map((section) => (
            <section key={section.label}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                {section.label}
              </h3>
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-sm leading-6">
                {section.value}
              </div>
            </section>
          ))}
        </div>
      )}

      {(summary.sourceFiles.length > 0 || summary.templateFiles.length > 0) && (
        <div className="mt-4 grid gap-4 border-y py-4 md:grid-cols-2">
          {summary.sourceFiles.length > 0 && (
            <FileList
              title="上传资料"
              files={summary.sourceFiles}
              icon={<FileText className="mt-0.5 size-4" />}
            />
          )}
          {summary.templateFiles.length > 0 && (
            <FileList
              title="上传模板"
              files={summary.templateFiles}
              icon={<LayoutTemplate className="mt-0.5 size-4" />}
            />
          )}
        </div>
      )}

      {summary.settings.length > 0 && (
        <dl className="mt-4 grid gap-x-6 border-t sm:grid-cols-2 xl:grid-cols-3">
          {summary.settings.map((setting) => (
            <div
              key={setting.label}
              className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 border-b py-2.5 text-sm"
            >
              <dt className="text-muted-foreground">{setting.label}</dt>
              <dd className="min-w-0 break-words font-medium">{setting.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function FileList({
  title,
  files,
  icon,
}: {
  title: string;
  files: string[];
  icon: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file} className="flex min-w-0 items-start gap-2 text-sm">
            {icon}
            <span className="min-w-0 break-all">{file}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
