import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleControlsForm } from "@/components/admin/module-controls-form";
import { getModuleControls } from "@/lib/module-controls";

export const metadata = { title: "模块控制" };

export default async function AdminModulesPage() {
  const controls = Object.values(await getModuleControls());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">模块控制</h1>
        <p className="text-muted-foreground">
          控制前台模块的展示、开放范围和暂停提示，适合灰度上线和临时关闭功能。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">模块状态</CardTitle>
          <CardDescription>
          前台入口会按状态自动显示或隐藏；图片等生成动作也会在服务端校验状态。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModuleControlsForm controls={controls} />
        </CardContent>
      </Card>
    </div>
  );
}
