import { getAllSettings } from "@/lib/credits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "@/components/admin/settings-form";

export const metadata = { title: "系统设置" };

export default async function AdminSettingsPage() {
  const settings = await getAllSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">系统设置</h1>
        <p className="text-muted-foreground">管理站点名称、积分单价等全局配置</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础配置</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm values={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
