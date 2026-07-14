"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteProjectButton({
  projectId,
  projectTitle,
  onDeleted,
}: {
  projectId: string;
  projectTitle: string;
  onDeleted: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteProject = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/ppt/projects/${projectId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(result?.error || "删除失败，请稍后重试。");
      }
      setOpen(false);
      onDeleted(projectId);
      toast.success("项目已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title="删除项目"
          aria-label={`删除项目 ${projectTitle}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除这个项目？</DialogTitle>
          <DialogDescription>
            {projectTitle}
            （删除后无法恢复）
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={deleting}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={() => void deleteProject()}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
