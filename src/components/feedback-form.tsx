"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { submitFeedbackAction } from "@/app/(app)/feedback/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TYPES = [
  ["FEATURE", "功能建议"],
  ["BUG", "Bug 问题"],
  ["EXPERIENCE", "体验问题"],
  ["BILLING", "充值问题"],
  ["OTHER", "其他"],
] as const;

const MODULES = [
  ["IMAGE", "图片生成"],
  ["MATERIALS", "素材库"],
  ["CREDITS", "积分充值"],
  ["AUTH", "登录注册"],
  ["PROFILE", "个人设置"],
  ["OTHER", "其他"],
] as const;

export function FeedbackForm({ sourcePath }: { sourcePath: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState("FEATURE");
  const [module, setModule] = useState("IMAGE");

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await submitFeedbackAction(formData);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("反馈已提交");
      formRef.current?.reset();
      setType("FEATURE");
      setModule("IMAGE");
    });
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>反馈建议</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-5">
          <input type="hidden" name="pagePath" value={sourcePath} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>反馈类型</Label>
              <input type="hidden" name="type" value={type} />
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>所属模块</Label>
              <input type="hidden" name="module" value={module} />
              <Select value={module} onValueChange={setModule}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODULES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-title">标题</Label>
            <Input
              id="feedback-title"
              name="title"
              maxLength={80}
              placeholder="一句话说明问题或建议"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-content">详细描述</Label>
            <Textarea
              id="feedback-content"
              name="content"
              maxLength={2000}
              rows={7}
              placeholder="请描述你遇到的问题、期望的改进，或可以复现的操作步骤"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-screenshots">截图</Label>
            <Input
              id="feedback-screenshots"
              name="screenshots"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
            />
            <p className="text-xs text-muted-foreground">
              最多 3 张，单张不超过 5MB，支持 PNG、JPG、WEBP。
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              提交反馈
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
