"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { updateModuleControlsAction } from "@/app/admin/modules/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MODULE_STATUS_OPTIONS,
  type ModuleControl,
} from "@/lib/module-control-core";

const STATUS_BADGE_VARIANT: Record<ModuleControl["status"], "default" | "secondary" | "outline" | "destructive"> = {
  open: "default",
  admin: "secondary",
  closed: "destructive",
  hidden: "outline",
  "coming-soon": "outline",
};

export function ModuleControlsForm({ controls }: { controls: ModuleControl[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updateModuleControlsAction(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("模块控制已保存");
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MODULE_STATUS_OPTIONS.map((option) => (
          <div key={option.value} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[option.value]}>{option.label}</Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-36">模块</TableHead>
              <TableHead className="min-w-24">分组</TableHead>
              <TableHead className="min-w-36">状态</TableHead>
              <TableHead className="min-w-72">用户提示</TableHead>
              <TableHead className="min-w-48">说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {controls.map((control) => (
              <TableRow key={control.key}>
                <TableCell>
                  <div className="font-medium">{control.name}</div>
                  <div className="text-xs text-muted-foreground">{control.href}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{control.group}</Badge>
                </TableCell>
                <TableCell>
                  <Select name={`status:${control.key}`} defaultValue={control.status}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODULE_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    name={`message:${control.key}`}
                    defaultValue={control.message}
                    placeholder="留空则使用默认提示"
                    maxLength={120}
                  />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {control.description}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          保存模块控制
        </Button>
      </div>
    </form>
  );
}
