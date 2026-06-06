import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";

export const metadata = { title: "PPT 生成" };

export default function PptPage() {
  const m = getModule("ppt")!;
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
