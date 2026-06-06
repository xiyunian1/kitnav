import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";

export const metadata = { title: "视频生成" };

export default function VideoPage() {
  const m = getModule("video")!;
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
