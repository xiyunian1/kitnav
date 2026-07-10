"use client";

import { GenerationForm } from "./generation-form";
import { ProjectList, type ProjectListItem } from "./project-list";
import type { ModuleModelOption } from "@/lib/module-model-options";

interface Props {
  recentProjects: ProjectListItem[];
  modelOptions: ModuleModelOption[];
  creditsPerSlide: number;
}

export function PptWorkbench({
  recentProjects,
  modelOptions,
  creditsPerSlide,
}: Props) {
  const projectListKey = recentProjects
    .map((project) => `${project.id}:${project.status}:${project.progress}`)
    .join("|");

  return (
    <div className="space-y-14">
      <GenerationForm
        modelOptions={modelOptions}
        creditsPerSlide={creditsPerSlide}
      />
      <ProjectList key={projectListKey} projects={recentProjects} />
    </div>
  );
}
