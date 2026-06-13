"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MaterialView } from "./material-types";

const MaterialPickerDialog = dynamic(
  () => import("./material-picker").then((mod) => mod.MaterialPickerDialog),
  { ssr: false }
);

export function MaterialPicker({ onPick }: { onPick: (material: MaterialView) => void }) {
  const [open, setOpen] = useState(false);
  // 未打开过不挂载，弹窗代码按需加载
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <ImageIcon className="size-4" /> 从素材库选择
      </Button>
      {mounted && <MaterialPickerDialog open={open} onOpenChange={setOpen} onPick={onPick} />}
    </>
  );
}
