"use client";

import { GenerationForm } from "./generation-form";
import { ProjectList, type ProjectListItem } from "./project-list";
import type { PptTemplateOption } from "@/lib/ppt-agent/templates";

interface Props {
  recentProjects: ProjectListItem[];
  useOwnKey: boolean;
  creditsPerSlide: number;
  templateOptions: PptTemplateOption[];
}

export function PptWorkbench({
  recentProjects,
  useOwnKey,
  creditsPerSlide,
  templateOptions,
}: Props) {
  const projectListKey = recentProjects
    .map((project) => `${project.id}:${project.status}:${project.progress}`)
    .join("|");

  return (
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <GenerationForm
        useOwnKey={useOwnKey}
        creditsPerSlide={creditsPerSlide}
        templateOptions={templateOptions}
      />
      <ProjectList key={projectListKey} projects={recentProjects} compact />
    </div>
  );
}
