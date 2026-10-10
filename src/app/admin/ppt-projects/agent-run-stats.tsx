import { formatChinaDateTime } from "@/lib/date-format";
import {
  pptAgentPhaseLabel,
  type PptAgentRunSummary,
  type PptAgentRunTotals,
} from "@/lib/ppt-agent/agent-run-metrics";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const RUN_STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ok: { label: "完成", variant: "default" },
  recovered: { label: "退出后恢复", variant: "secondary" },
  stalled: { label: "无进展终止", variant: "destructive" },
  timeout: { label: "超时", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
  error: { label: "出错", variant: "destructive" },
};

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString("zh-CN");
}

export function formatCost(value: number) {
  return value > 0 ? `¥${value.toFixed(value >= 1 ? 2 : 4)}` : "-";
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

/** 用量合计的指标卡片；没有服务商用量上报时给出配置提示。 */
export function AgentUsageTotals({ totals }: { totals: PptAgentRunTotals }) {
  const items: [string, string][] = [
    ["Agent 调用", `${totals.runs} 次`],
    ["模型回复", `${totals.llmCalls} 次`],
    ["输入 token", formatTokens(totals.inputTokens)],
    ["缓存命中 token", `${formatTokens(totals.cacheReadTokens)}（${formatPercent(totals.cacheHitRatio)}）`],
    ["输出 token", formatTokens(totals.outputTokens)],
    ["费用", formatCost(totals.cost)],
    ["累计耗时", formatDuration(totals.durationMs)],
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {items.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-medium">{value}</div>
          </div>
        ))}
      </div>
      {totals.runs > 0 && totals.usageReportedRatio === 0 && (
        <p className="text-xs text-muted-foreground">
          模型服务商没有在流式响应中返回 token 用量。如服务商支持 stream_options（DeepSeek、OpenAI、硅基流动等），
          可设置 PPT_PI_SUPPORTS_USAGE_IN_STREAMING=true；费用需同时配置 PPT_PI_MODEL_PRICING。
        </p>
      )}
    </div>
  );
}

/** 按阶段的耗时与费用分布。 */
export function AgentPhaseTable({ summary }: { summary: PptAgentRunSummary }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>阶段</TableHead>
          <TableHead className="text-right">调用次数</TableHead>
          <TableHead className="text-right">耗时占比</TableHead>
          <TableHead className="text-right">费用占比</TableHead>
          <TableHead className="text-right">输入 / 输出 token</TableHead>
          <TableHead className="text-right">缓存命中率</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summary.byPhase.map((phase) => (
          <TableRow key={phase.phase}>
            <TableCell>{pptAgentPhaseLabel(phase.phase)}</TableCell>
            <TableCell className="text-right">{phase.runs}</TableCell>
            <TableCell className="text-right">{formatPercent(phase.durationShare)}</TableCell>
            <TableCell className="text-right">{summary.totals.cost > 0 ? formatPercent(phase.costShare) : "-"}</TableCell>
            <TableCell className="text-right">
              {formatTokens(phase.inputTokens)} / {formatTokens(phase.outputTokens)}
            </TableCell>
            <TableCell className="text-right">{formatPercent(phase.cacheHitRatio)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface AgentRunListItem {
  id: string;
  createdAt: Date;
  phase: string;
  turn: number;
  status: string;
  stopReason: string | null;
  numTurns: number;
  toolCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  error: string | null;
}

/** 单个项目的逐次调用明细。 */
export function AgentRunList({ runs }: { runs: AgentRunListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>结束时间</TableHead>
          <TableHead>阶段</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">回合</TableHead>
          <TableHead className="text-right">工具调用</TableHead>
          <TableHead className="text-right">输入</TableHead>
          <TableHead className="text-right">缓存命中</TableHead>
          <TableHead className="text-right">输出</TableHead>
          <TableHead className="text-right">费用</TableHead>
          <TableHead className="text-right">耗时</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const meta = RUN_STATUS_META[run.status] ?? { label: run.status, variant: "outline" as const };
          return (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap text-xs">{formatChinaDateTime(run.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {pptAgentPhaseLabel(run.phase)}
                {run.turn > 1 && <span className="text-xs text-muted-foreground"> · 第 {run.turn} 次</span>}
              </TableCell>
              <TableCell>
                <Badge variant={meta.variant} title={run.error ?? run.stopReason ?? undefined}>
                  {meta.label}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{run.numTurns}</TableCell>
              <TableCell className="text-right">{run.toolCalls}</TableCell>
              <TableCell className="text-right">{formatTokens(run.inputTokens)}</TableCell>
              <TableCell className="text-right">{formatTokens(run.cacheReadTokens)}</TableCell>
              <TableCell className="text-right">{formatTokens(run.outputTokens)}</TableCell>
              <TableCell className="text-right">{formatCost(run.cost)}</TableCell>
              <TableCell className="text-right">{formatDuration(run.durationMs)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
