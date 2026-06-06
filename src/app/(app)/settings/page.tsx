import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { maskKey } from "@/lib/crypto";
import { parseModelList } from "@/lib/model-options";
import { MODULES } from "@/lib/modules";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  UserApiConfigForm,
  type UserConfigInitial,
} from "@/components/user-api-config-form";
import { Info } from "lucide-react";

export const metadata = { title: "API 设置" };

// 有 moduleType 的模块才支持 API 配置
const CONFIGURABLE = MODULES.filter((m) => m.moduleType);

export default async function ApiSettingsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const configs = await prisma.userApiConfig.findMany({ where: { userId } });
  const byModule = new Map(configs.map((c) => [c.module, c]));

  function initialFor(moduleType: string): UserConfigInitial {
    const c = byModule.get(moduleType as never);
    return {
      module: moduleType,
      baseUrl: c?.baseUrl ?? "",
      model: c?.model ?? "",
      models: c ? parseModelList(c.models).join("\n") || c.model : "",
      enabled: c?.enabled ?? false,
      hasKey: !!c,
      maskedKey: c ? maskKey(c.apiKey) : "",
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API 设置</h1>
        <p className="text-muted-foreground">
          配置你自己的第三方 API（OpenAI 兼容），使用时不消耗平台积分
        </p>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertDescription>
          支持任何 OpenAI 兼容接口（官方、new-api/one-api 等聚合站）。开启某模块后，该模块将走你的 API、不扣积分；关闭则回到平台模型并按积分计费。你的 Key 加密存储，不会回显明文。
        </AlertDescription>
      </Alert>

      <Tabs defaultValue={CONFIGURABLE[0]?.key} className="w-full">
        <TabsList>
          {CONFIGURABLE.map((m) => (
            <TabsTrigger key={m.key} value={m.key} disabled={m.status !== "active"}>
              {m.name}
              {m.status !== "active" && "（即将上线）"}
            </TabsTrigger>
          ))}
        </TabsList>
        {CONFIGURABLE.map((m) => (
          <TabsContent key={m.key} value={m.key} className="mt-4 max-w-xl">
            {m.status === "active" ? (
              <UserApiConfigForm initial={initialFor(m.moduleType!)} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                该模块即将上线，敬请期待
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
