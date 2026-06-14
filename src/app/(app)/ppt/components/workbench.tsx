"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GenerationForm } from "./generation-form";
import { ProjectList, type ProjectListItem } from "./project-list";
import { Plus, History } from "lucide-react";
import type { PptStyleMaterialOption } from "@/lib/ppt-agent/styles";
import type { PptTemplateOption } from "@/lib/ppt-agent/templates";

interface Props {
  recentProjects: ProjectListItem[];
  useOwnKey: boolean;
  creditsPerSlide: number;
  styleMaterials: PptStyleMaterialOption[];
  initialStyleMaterialId?: string;
  templateOptions: PptTemplateOption[];
}

export function PptWorkbench({
  recentProjects,
  useOwnKey,
  creditsPerSlide,
  styleMaterials,
  initialStyleMaterialId,
  templateOptions,
}: Props) {
  const [activeTab, setActiveTab] = useState<"new" | "history">("new");

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "new" | "history")}>
        <TabsList>
          <TabsTrigger value="new">
            <Plus className="size-4" />
            新建项目
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" />
            历史项目
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <Card className="p-6">
            <GenerationForm
              useOwnKey={useOwnKey}
              creditsPerSlide={creditsPerSlide}
              styleMaterials={styleMaterials}
              initialStyleMaterialId={initialStyleMaterialId}
              templateOptions={templateOptions}
            />
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <ProjectList projects={recentProjects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
