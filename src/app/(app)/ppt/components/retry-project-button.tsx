"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
	projectId: string;
	size?: "icon-sm" | "sm" | "default";
	variant?: "outline" | "default";
	iconOnly?: boolean;
	className?: string;
	onRetried?: () => void;
}

export function RetryProjectButton({
	projectId,
	size = "sm",
	variant = "outline",
	iconOnly = false,
	className,
	onRetried,
}: Props) {
	const router = useRouter();
	const [pending, setPending] = useState(false);

	async function handleRetry() {
		setPending(true);
		try {
			const response = await fetch(`/api/ppt/projects/${projectId}/retry`, {
				method: "POST",
			});
			const result = (await response.json().catch(() => null)) as
				| { error?: string; creditsCharged?: number }
				| null;
			if (!response.ok) {
				throw new Error(result?.error || "继续生成失败，请稍后重试。");
			}
			toast.success(
				result?.creditsCharged
					? `已继续生成，预扣 ${result.creditsCharged} 积分。`
					: "已按原模型从现有进度继续生成。",
			);
			onRetried?.();
			router.refresh();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "继续生成失败，请稍后重试。",
			);
		} finally {
			setPending(false);
		}
	}

	return (
		<Button
			type="button"
			size={iconOnly ? "icon-sm" : size}
			variant={variant}
			disabled={pending}
			onClick={() => void handleRetry()}
			className={cn(className)}
			title={iconOnly ? "继续生成" : undefined}
			aria-label={iconOnly ? "继续生成" : undefined}
		>
			{pending ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<RotateCcw className="size-4" />
			)}
			{!iconOnly && "继续生成"}
		</Button>
	);
}
