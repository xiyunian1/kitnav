import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { checkSvgQuality, convertSvgToPptx, finalizeSvg, splitNotes } from "./python-tools";
import { publicProjectUrl } from "./paths";
import { getPptMasterSkillDir } from "./runtime-paths";
import { resolvePptTextProvider } from "./resolve-claude";
import { buildPptStyleInstruction } from "./styles";
import { PptToolRuntime, PPT_AGENT_TOOLS } from "./tool-runtime";
import { throwIfPptCancelled } from "./cancellation";
import { collectPptArtifactPaths, normalizePptSvgArtifacts } from "./artifacts";
import type { TextMessage, ToolCall } from "@/lib/providers/text-openai";
import type { EventEmitter, GenerationParams } from "./generator";

export interface HostedAgentRunResult {
  pptxPath: string;
  slideCount: number;
}

interface RunnerOptions {
  projectDir: string;
  sourceMd: string;
  slideCount: number;
  aspectRatio: "16:9" | "4:3";
  canvasFormat: "ppt169" | "ppt43";
  style: string;
  stylePrompt: string;
  styleLabel: string;
  signal?: AbortSignal;
  emit: EventEmitter;
}

interface AgentStepResult {
  content: string;
  toolCalls: ToolCall[];
}

const MAX_TOOL_RESULT_CHARS = 12_000;

export async function runHostedPptAgent(
  params: GenerationParams,
  options: RunnerOptions
): Promise<HostedAgentRunResult> {
  const resolved = await resolvePptTextProvider(params.userId);
  const runtime = new PptToolRuntime(options.projectDir, options.signal);
  const maxTurns = Number(process.env.PPT_HOSTED_AGENT_MAX_TURNS || Math.max(24, options.slideCount * 7 + 8));
  const maxTokens = Number(process.env.PPT_HOSTED_AGENT_MAX_TOKENS || 12_000);
  const timeoutMs = Number(process.env.PPT_HOSTED_AGENT_TURN_TIMEOUT_MS || 180_000);

  throwIfPptCancelled(options.signal);
  await log(
    params.projectId,
    options.emit,
    `使用站内 PPT Master agent：${resolved.source === "user" ? "用户自带 Key" : "平台上游"} / ${resolved.model}`
  );
  await log(params.projectId, options.emit, `画布格式：${options.canvasFormat}，目标页数：${options.slideCount}`);
  await log(params.projectId, options.emit, `生成风格：${options.styleLabel}`);

  writeHostedAgentTask(params, options);

  options.emit({ type: "phase", data: { phase: "STRATEGIZING", progress: 12 } });
  await updateProject(params.projectId, {
    status: "STRATEGIZING",
    currentPhase: "站内 agent 正在规划设计规格",
    progress: 12,
  });

  const messages: TextMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(options),
    },
    {
      role: "user",
      content: buildInitialTaskPrompt(params, options),
    },
  ];

  let lastSvgCount = 0;
  for (let turn = 1; turn <= maxTurns; turn++) {
    throwIfPptCancelled(options.signal);
    await log(params.projectId, options.emit, `agent 第 ${turn}/${maxTurns} 轮执行`);

    const result = await runAgentTurn(
      () =>
        resolved.provider.generateWithTools({
          messages,
          tools: PPT_AGENT_TOOLS,
          toolChoice: "auto",
          temperature: 0.25,
          maxTokens,
          timeoutMs,
          signal: options.signal,
        }),
      options.signal
    );

    messages.push(buildAssistantMessage(result));

    if (result.content) {
      await appendAgentOutput(options.projectDir, `\n\n## Turn ${turn}\n\n${result.content}\n`);
    }

    if (result.toolCalls.length === 0) {
      await log(params.projectId, options.emit, "agent 本轮没有请求工具，检查输出文件");
    }

    for (const call of result.toolCalls) {
      throwIfPptCancelled(options.signal);
      const toolResult = await executeToolCall(runtime, call);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: trimToolResult(toolResult),
      });
      await log(params.projectId, options.emit, `工具 ${call.function.name} 完成`);
    }

    const svgCount = countSvgSlides(options.projectDir);
    if (svgCount !== lastSvgCount) {
      emitNewPreviews(options, lastSvgCount, svgCount);
      lastSvgCount = svgCount;
      await updateExecutionProgress(params.projectId, options, svgCount);
    }

    if (findLatestPptx(options.projectDir)) break;

    if (svgCount >= options.slideCount && result.toolCalls.length === 0) {
      break;
    }
    if (result.toolCalls.length === 0) {
      messages.push({
        role: "user",
        content:
          svgCount < options.slideCount
            ? `还没有完成全部页面。当前只生成了 ${svgCount}/${options.slideCount} 个 SVG。请继续使用工具读写文件，下一步必须生成缺失页面。`
            : "SVG 已齐，请继续使用工具运行质量检查、拆分讲稿、finalize_svg.py 和 svg_to_pptx.py 导出 PPTX。",
      });
    }
  }

  throwIfPptCancelled(options.signal);
  if (countSvgSlides(options.projectDir) < options.slideCount) {
    throw new Error(
      `站内 agent 未完成全部页面：已生成 ${countSvgSlides(options.projectDir)}/${options.slideCount} 个 SVG。请换用更强的 PPT 文本模型或减少页数后重试。`
    );
  }

  const repaired = await repairQualityIssuesIfNeeded(params, options, resolved.provider, messages, runtime);
  if (repaired > lastSvgCount) {
    emitNewPreviews(options, lastSvgCount, repaired);
  }

  options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 86 } });
  await updateProject(params.projectId, {
    status: "EXPORTING",
    currentPhase: "质量检查与导出 PPTX",
    ...collectPptArtifactPaths(options.projectDir),
    progress: 86,
  });

  await runServerSideExport(params.projectId, options);
  const pptxPath = findLatestPptx(options.projectDir);
  if (!pptxPath) {
    throw new Error("PPTX 导出失败：exports/ 下未找到 PPTX 文件。");
  }

  await log(params.projectId, options.emit, `PPTX 已生成：${publicProjectUrl(params.projectId, pptxPath)}`);
  return { pptxPath, slideCount: countSvgSlides(options.projectDir) || options.slideCount };
}

async function repairQualityIssuesIfNeeded(
  params: GenerationParams,
  options: RunnerOptions,
  provider: Awaited<ReturnType<typeof resolvePptTextProvider>>["provider"],
  messages: TextMessage[],
  runtime: PptToolRuntime
) {
  const maxRepairs = Number(process.env.PPT_HOSTED_AGENT_REPAIR_TURNS || 2);
  for (let repairTurn = 1; repairTurn <= maxRepairs; repairTurn++) {
    throwIfPptCancelled(options.signal);
    const quality = await checkSvgQuality(options.projectDir);
    if (quality.errors.length === 0) {
      await log(params.projectId, options.emit, "SVG 质量检查通过");
      return countSvgSlides(options.projectDir);
    }

    await log(
      params.projectId,
      options.emit,
      `SVG 质量检查发现 ${quality.errors.length} 个问题，agent 第 ${repairTurn}/${maxRepairs} 轮修复`
    );
    messages.push({
      role: "user",
      content: [
        "质量检查未通过。请使用 read_file 读取相关 SVG，使用 write_file 修复问题，然后不要解释，继续调用工具完成修复。",
        "",
        "错误列表：",
        ...quality.errors.slice(0, 12).map((item) => `- ${item}`),
      ].join("\n"),
    });

    const result = await runAgentTurn(
      () =>
        provider.generateWithTools({
          messages,
          tools: PPT_AGENT_TOOLS,
          toolChoice: "auto",
          temperature: 0.2,
          maxTokens: Number(process.env.PPT_HOSTED_AGENT_MAX_TOKENS || 12_000),
          timeoutMs: Number(process.env.PPT_HOSTED_AGENT_TURN_TIMEOUT_MS || 180_000),
          signal: options.signal,
        }),
      options.signal
    );
    messages.push(buildAssistantMessage(result));
    for (const call of result.toolCalls) {
      const toolResult = await executeToolCall(runtime, call);
      messages.push({ role: "tool", tool_call_id: call.id, content: trimToolResult(toolResult) });
      await log(params.projectId, options.emit, `工具 ${call.function.name} 完成`);
    }
  }

  const quality = await checkSvgQuality(options.projectDir);
  if (quality.errors.length > 0) {
    throw new Error(`SVG 质量检查失败：${quality.errors.slice(0, 8).join("; ")}`);
  }
  return countSvgSlides(options.projectDir);
}

function buildSystemPrompt(options: RunnerOptions) {
  return [
    "你是服务器内置的 PPT Master agent。你必须通过工具读写项目文件并执行完整 PPT Master 主流程。",
    "",
    "硬性要求：",
    "- 全程使用简体中文生成可见幻灯片文字；只有 AI、API、LLM、SaaS、PPTX、URL、HTTP 等必要技术缩写可以保留英文。",
    "- 必须先阅读 SKILL.md、references/strategist.md、references/executor-base.md、references/shared-standards.md。",
    "- 必须写入 design_spec.md 和 spec_lock.md。",
    "- 必须逐页顺序生成 svg_output/01_slide.svg 等文件；每页生成前必须重新 read_file spec_lock.md。",
    "- 每页 SVG 必须是手写 SVG，不要用脚本批量生成页面，不要使用 foreignObject。",
    "- 所有 SVG 必须包含 xmlns 和 viewBox，并保持文字在画布内。",
    "- 完成所有页面后生成 notes/total.md，然后运行 quality_check；通过后运行 total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
    "- 如果质量检查报错，先修复 SVG 再继续导出。",
    "- 不要请求用户确认；前端表单已经代表用户确认连续执行。",
    "- 不要修改当前 PPT 项目目录和 ppt-master skill 目录以外的文件。",
    "",
    `目标页数：${options.slideCount}`,
    `画布：${options.aspectRatio} (${options.canvasFormat})`,
  ].join("\n");
}

function buildInitialTaskPrompt(params: GenerationParams, options: RunnerOptions) {
  const skillDir = getPptMasterSkillDir();
  return [
    "# PPT Master Hosted Agent Task",
    "",
    `PPT Master skill 目录：${skillDir}`,
    `项目目录：${options.projectDir}`,
    "源内容文件：sources/source.md",
    "",
    "你可以使用工具：",
    "- read_file：读取项目或 skill 文件",
    "- write_file：写入项目文件",
    "- list_dir：查看项目或 skill 文件列表",
    "- quality_check：运行 SVG 质量检查",
    "- run_ppt_script：运行白名单 PPT Python 脚本",
    "",
    "请按以下阶段连续执行：",
    "1. 阅读 SKILL.md 和必要 reference。",
    "2. 阅读 sources/source.md。",
    "3. 根据用户内容、风格和素材上下文写 design_spec.md 和 spec_lock.md。",
    "4. 逐页生成 svg_output/*.svg，每页都重新读取 spec_lock.md。",
    "5. 写 notes/total.md。",
    "6. 运行 quality_check；如有 error，修复后重跑。",
    "7. 运行 total_md_split.py、finalize_svg.py、svg_to_pptx.py 导出 PPTX。",
    "",
    "用户参数：",
    `- 目标页数：${options.slideCount}`,
    `- 画布：${options.aspectRatio} (${options.canvasFormat})`,
    `- 风格名称：${options.styleLabel}`,
    `- 模板/素材提示：${params.template || "无，按自由设计"}`,
    "",
    "风格要求：",
    buildPptStyleInstruction(options),
    "",
    "源内容预览：",
    "```markdown",
    trimForPrompt(options.sourceMd, Number(process.env.PPT_HOSTED_AGENT_SOURCE_PREVIEW_CHARS || 8000)),
    "```",
  ].join("\n");
}

function writeHostedAgentTask(params: GenerationParams, options: RunnerOptions) {
  const task = buildInitialTaskPrompt(params, options);
  writeFileSync(join(options.projectDir, "agent-task.md"), task, "utf-8");
  writeFileSync(
    join(options.projectDir, "style_context.md"),
    [`# PPT 风格上下文`, "", `- 风格：${options.styleLabel}`, "", options.stylePrompt].join("\n"),
    "utf-8"
  );
}

async function runAgentTurn(run: () => Promise<AgentStepResult>, signal?: AbortSignal) {
  let lastError: unknown;
  const attempts = Number(process.env.PPT_HOSTED_AGENT_TURN_ATTEMPTS || 3);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      throwIfPptCancelled(signal);
      return await run();
    } catch (error) {
      lastError = error;
      throwIfPptCancelled(signal);
      if (attempt >= attempts || !isTransientError(error)) throw error;
      await sleep(1000 * attempt * attempt, signal);
    }
  }
  throw lastError;
}

async function executeToolCall(runtime: PptToolRuntime, call: ToolCall) {
  try {
    return await runtime.execute(call.function.name, call.function.arguments);
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function buildAssistantMessage(result: AgentStepResult): TextMessage {
  if (result.toolCalls.length > 0) {
    return { role: "assistant", content: result.content || "", tool_calls: result.toolCalls };
  }
  return { role: "assistant", content: result.content || "" };
}

async function runServerSideExport(projectId: string, options: RunnerOptions) {
  await ensureFallbackSpeakerNotes(options.projectDir, options.slideCount);
  throwIfPptCancelled(options.signal);
  const normalized = normalizePptSvgArtifacts(options.projectDir);
  if (normalized.namedGroups > 0 || normalized.addedColors > 0 || normalized.addedFonts > 0) {
    await log(
      projectId,
      options.emit,
      `已规范化 SVG 产物：补充 ${normalized.namedGroups} 个页面的分组 id，写入 ${normalized.addedColors} 个 spec_lock 颜色和 ${normalized.addedFonts} 个字体栈`
    );
  }
  const quality = await checkSvgQuality(options.projectDir);
  if (quality.errors.length > 0) {
    throw new Error(`SVG 质量检查失败：${quality.errors.slice(0, 8).join("; ")}`);
  }
  await log(projectId, options.emit, "SVG 质量检查通过，开始导出 PPTX");
  throwIfPptCancelled(options.signal);
  await splitNotes(options.projectDir).catch(() => undefined);
  await finalizeSvg(options.projectDir);
  await convertSvgToPptx(options.projectDir);
}

async function updateExecutionProgress(projectId: string, options: RunnerOptions, svgCount: number) {
  const progress = Math.min(82, 28 + Math.floor((svgCount / Math.max(options.slideCount, 1)) * 52));
  options.emit({ type: "phase", data: { phase: "EXECUTING", progress } });
  options.emit({ type: "progress", data: { progress } });
  await updateProject(projectId, {
    status: "EXECUTING",
    currentPhase: `逐页生成 SVG（${svgCount}/${options.slideCount}）`,
    svgOutputPath: join(options.projectDir, "svg_output"),
    progress,
  });
}

function emitNewPreviews(options: RunnerOptions, fromCount: number, toCount: number) {
  for (let index = fromCount; index < toCount; index++) {
    options.emit({
      type: "preview",
      data: {
        pageIndex: index,
        svgUrl: `/api/ppt/projects/${projectIdFromDir(options.projectDir)}/files/svg_output/${String(index + 1).padStart(2, "0")}_slide.svg`,
      },
    });
  }
}

function projectIdFromDir(projectDir: string) {
  return projectDir.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "";
}

async function ensureFallbackSpeakerNotes(projectDir: string, slideCount: number) {
  const notesDir = join(projectDir, "notes");
  mkdirSync(notesDir, { recursive: true });
  const totalPath = join(notesDir, "total.md");
  if (existsSync(totalPath) && statSync(totalPath).size > 20) return;
  const designSpec = existsSync(join(projectDir, "design_spec.md"))
    ? readFileSync(join(projectDir, "design_spec.md"), "utf-8")
    : "";
  const total = Array.from({ length: slideCount }, (_, index) => {
    const stem = `${String(index + 1).padStart(2, "0")}_slide`;
    const note = extractNote(designSpec, index + 1);
    return [`# ${stem}`, "", note, ""].join("\n");
  }).join("\n");
  writeFileSync(totalPath, total, "utf-8");
}

function extractNote(designSpec: string, slideNo: number) {
  const match = designSpec.match(
    new RegExp(`(?:第\\s*${slideNo}\\s*页|Slide\\s*${slideNo}|Page\\s*${slideNo})[\\s\\S]{0,500}`, "i")
  );
  const source = match?.[0]?.replace(/\s+/g, " ").trim();
  if (source) return `这一页围绕第 ${slideNo} 部分展开。讲解时先点明本页结论，再结合页面结构说明：${source.slice(0, 260)}`;
  return `这一页围绕第 ${slideNo} 部分展开。讲解时先点明本页结论，再按页面结构解释关键概念、关系和行动建议。`;
}

function countSvgSlides(projectDir: string) {
  const svgDir = join(projectDir, "svg_output");
  if (!existsSync(svgDir)) return 0;
  return readdirSync(svgDir).filter((file) => /^\d+_.*\.svg$/i.test(file)).length;
}

function findLatestPptx(projectDir: string) {
  const exportsDir = join(projectDir, "exports");
  if (!existsSync(exportsDir)) return "";
  const files = readdirSync(exportsDir)
    .filter((file) => file.toLowerCase().endsWith(".pptx") && !file.toLowerCase().endsWith("_svg.pptx"))
    .map((file) => join(exportsDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || "";
}

function trimToolResult(text: string) {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[tool output truncated]`;
}

function trimForPrompt(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

async function appendAgentOutput(projectDir: string, content: string) {
  const path = join(projectDir, "agent-output.md");
  const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeFileSync(path, `${current}${content}`, "utf-8");
}

function isTransientError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    /TimeoutError|AbortError/i.test(name) ||
    /timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message) ||
    /\b(408|409|425|429|500|502|503|504|520|522|524)\b/i.test(message)
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("用户已停止生成"));
    };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function log(projectId: string, emit: EventEmitter, message: string) {
  emit({ type: "log", data: { message } });
  const line = `[${new Date().toISOString()}] ${message}`;
  const current = await prisma.pptProject.findUnique({
    where: { id: projectId },
    select: { logs: true },
  });
  await prisma.pptProject.update({
    where: { id: projectId },
    data: { logs: [current?.logs, line].filter(Boolean).join("\n") },
  });
}

async function updateProject(projectId: string, data: Parameters<typeof prisma.pptProject.update>[0]["data"]) {
  await prisma.pptProject.update({ where: { id: projectId }, data });
}
