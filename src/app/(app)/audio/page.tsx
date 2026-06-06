import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";

export const metadata = { title: "音频生成" };

export default function AudioPage() {
  const m = getModule("audio")!;
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
