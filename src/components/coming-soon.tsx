import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Construction } from "lucide-react";

interface Props {
  name: string;
  description: string;
  icon: LucideIcon;
}

export function ComingSoon({ name, description, icon: Icon }: Props) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-10 text-muted-foreground" />
      </div>
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
        <Construction className="size-3.5" />
        即将上线
      </div>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{description}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        该模块正在开发中，敬请期待
      </p>
      <Button className="mt-6" variant="outline" asChild>
        <Link href="/">返回首页</Link>
      </Button>
    </div>
  );
}
