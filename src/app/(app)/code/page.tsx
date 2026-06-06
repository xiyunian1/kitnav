import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";

export const metadata = { title: "代码助手" };

export default function CodePage() {
  const m = getModule("code")!;
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
