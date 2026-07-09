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
    <div className="space-y-14">
      <GenerationForm
        useOwnKey={useOwnKey}
        creditsPerSlide={creditsPerSlide}
      />
      <ProjectList key={projectListKey} projects={recentProjects} />
    </div>
  );
}
