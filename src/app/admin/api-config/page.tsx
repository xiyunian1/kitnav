import { prisma } from "@/lib/db";
import { maskKey } from "@/lib/crypto";
import { parseModelList } from "@/lib/model-options";
import { parseModelMeta } from "@/lib/model-meta";
import { MODULES } from "@/lib/modules";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ProviderConfigForm,
  type ProviderConfigInitial,
} from "@/components/admin/provider-config-form";
import { Info } from "lucide-react";

export const metadata = { title: "API 配置" };

const CONFIGURABLE = MODULES.filter((m) => m.moduleType);

export default async function AdminApiConfigPage() {
  const configs = await prisma.providerConfig.findMany();
  const byModule = new Map(configs.map((c) => [c.module, c]));

  function initialFor(
    moduleType: string,
    moduleName: string,
    active: boolean
  ): ProviderConfigInitial {
    const c = byModule.get(moduleType as never);
    return {
      module: moduleType,
      moduleName,
      baseUrl: c?.baseUrl ?? "",
      model: c?.model ?? "",
      models: c ? parseModelList(c.models).join("\n") || c.model : "",
      modelMeta: c ? parseModelMeta(c.modelMeta) : {},
      enabled: c?.enabled ?? false,
      hasKey: !!c,
      maskedKey: c ? maskKey(c.apiKey) : "",
      active,
    };
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API 配置</h1>
        <p className="text-muted-foreground">
          配置各模块的平台上游 API，方便随时更换上游服务商
        </p>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertDescription>
          支持任何 OpenAI 兼容接口。用户走平台模型时使用这套配置（按积分计费）。Key 加密存储、不回显明文。可在同一个 API 下配置多个模型，创作台支持切换。
        </AlertDescription>
      </Alert>

      <div className="space-y-5">
        {CONFIGURABLE.map((m) => (
          <ProviderConfigForm
            key={m.key}
            initial={initialFor(m.moduleType!, m.name, m.status === "active")}
          />
        ))}
      </div>
    </div>
  );
}
