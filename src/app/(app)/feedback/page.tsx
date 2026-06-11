import { FeedbackForm } from "@/components/feedback-form";
import { requireModulePageAccess } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";

export const metadata = { title: "反馈建议" };

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const access = await requireModulePageAccess("feedback");
  if (!access.usable) {
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
      />
    );
  }
  const params = await searchParams;
  const sourcePath = (params.from?.trim() || "/feedback").slice(0, 300);

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">反馈建议</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          你的反馈会直接进入后台，便于我们跟进和改进。
        </p>
      </div>
      <FeedbackForm sourcePath={sourcePath} />
    </div>
  );
}
