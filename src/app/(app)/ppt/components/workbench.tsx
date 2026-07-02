"use client";

import { GenerationForm } from "./generation-form";
import { ProjectList, type ProjectListItem } from "./project-list";

interface Props {
  recentProjects: ProjectListItem[];
  useOwnKey: boolean;
  creditsPerSlide: number;
}

export function PptWorkbench({
  recentProjects,
  useOwnKey,
  creditsPerSlide,
}: Props) {
  const projectListKey = recentProjects
    .map((project) => `${project.id}:${project.status}:${project.progress}`)
    .join("|");

  return (
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <GenerationForm
        useOwnKey={useOwnKey}
        creditsPerSlide={creditsPerSlide}
      />
      <ProjectList key={projectListKey} projects={recentProjects} compact />
    </div>
  );
}
