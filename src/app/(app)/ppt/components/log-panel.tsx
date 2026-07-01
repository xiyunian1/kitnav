"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LogPanelProps {
	/** 全部日志行（服务端传入完整内容，不再截断）。 */
	lines: string[];
	/** 折叠态下默认可见行数。 */
	defaultVisible?: number;
	/** 是否默认展开。生成完成后日志较长，默认折叠以避免占据整屏。 */
	defaultExpanded?: boolean;
}

/**
 * 生成日志面板：展示完整日志，支持折叠/展开。
 *
 * 取代此前仅显示最后 20 行、且无法查看全量的写法。默认折叠为有限高度，
 * 用户可展开查看全部；展开态自动滚动到底部（最新日志）。
 */
export function LogPanel({
	lines,
	defaultVisible = 12,
	defaultExpanded = false,
}: LogPanelProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const scrollRef = useRef<HTMLDivElement>(null);

	// 展开时滚动到底部，展示最新日志。
	useEffect(() => {
		if (expanded && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [expanded, lines.length]);

	if (lines.length === 0) return null;

	return (
		<Card className="p-4">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="mb-3 flex w-full items-center justify-between gap-2 text-left"
				aria-expanded={expanded}
			>
				<span className="flex items-center gap-1.5 font-semibold">
					{expanded ? (
						<ChevronDown className="size-4" />
					) : (
						<ChevronRight className="size-4" />
					)}
					生成日志
					<span className="text-xs font-normal text-muted-foreground">
						（共 {lines.length} 行）
					</span>
				</span>
				<span className="text-xs text-muted-foreground">
					{expanded ? "点击折叠" : "点击展开"}
				</span>
			</button>
			<div
				ref={scrollRef}
				className={cn(
					"space-y-1 overflow-auto font-mono text-xs text-muted-foreground transition-[max-height] duration-200",
					expanded ? "max-h-[480px]" : "max-h-72",
				)}
			>
				{expanded
					? lines.map((item, index) => (
							<p key={index} className="break-all">
								{item}
							</p>
						))
					: lines.slice(-defaultVisible).map((item, index) => (
							<p key={index} className="break-all">
								{item}
							</p>
						))}
			</div>
			{!expanded && lines.length > defaultVisible && (
				<p className="mt-2 text-xs text-muted-foreground">
					仅显示最后 {defaultVisible} 行，点击上方展开查看全部 {lines.length}{" "}
					行。
				</p>
			)}
		</Card>
	);
}
