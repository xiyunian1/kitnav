"use client";

import { GenerationForm } from "./generation-form";
import { ProjectList, type ProjectListItem } from "./project-list";
import type { ModuleModelOption } from "@/lib/module-model-options";

interface Props {
  recentProjects: ProjectListItem[];
  modelOptions: ModuleModelOption[];
  imageModelOptions: ModuleModelOption[];
  creditsPerSlide: number;
  imageCreditCost: number;
}

export function PptWorkbench({
  recentProjects,
  modelOptions,
  imageModelOptions,
  creditsPerSlide,
  imageCreditCost,
}: Props) {
  const projectListKey = recentProjects
    .map((project) => `${project.id}:${project.status}:${project.currentPhase ?? ""}`)
    .join("|");

  return (
    <div className="space-y-10">
      <GenerationForm
        modelOptions={modelOptions}
        imageModelOptions={imageModelOptions}
        creditsPerSlide={creditsPerSlide}
        imageCreditCost={imageCreditCost}
      />
      <ProjectList key={projectListKey} projects={recentProjects} />
    </div>
  );
}
