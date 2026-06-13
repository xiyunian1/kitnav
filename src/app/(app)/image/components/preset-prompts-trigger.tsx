"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImagePreset } from "@/lib/image-presets";

const PresetPromptsDialog = dynamic(
  () => import("./preset-prompts").then((mod) => mod.PresetPromptsDialog),
  { ssr: false }
);

export function PresetPrompts({ onPick }: { onPick: (preset: ImagePreset) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-center"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <Images className="size-4" /> 选择预设
      </Button>
      {mounted && <PresetPromptsDialog open={open} onOpenChange={setOpen} onPick={onPick} />}
    </>
  );
}
