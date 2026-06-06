import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";

export const metadata = { title: "文案写作" };

export default function CopywritingPage() {
  const m = getModule("copywriting")!;
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
