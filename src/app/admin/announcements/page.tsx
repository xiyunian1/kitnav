import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnnouncementForm } from "@/components/admin/announcement-form";

export const metadata = { title: "公告管理" };

export default async function AdminAnnouncementsPage() {
  const items = await prisma.siteAnnouncement.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">公告管理</h1>
        <p className="text-muted-foreground">管理前台公告、维护提示和运营消息</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新增公告</CardTitle>
        </CardHeader>
        <CardContent>
          <AnnouncementForm />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {item.title}
                <Badge variant={item.enabled ? "default" : "outline"}>
                  {item.enabled ? "启用" : "停用"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AnnouncementForm item={item} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
