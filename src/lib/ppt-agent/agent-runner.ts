import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { checkSvgQuality, convertSvgToPptx, finalizeSvg, splitNotes } from "./python-tools";
import { getPptMasterSkillDir } from "./runtime-paths";
import { PPT_PROJECTS_ROOT } from "./paths";
import { getPptStyleLabel } from "./styles";
import { throwIfPptCancelled } from "./cancellation";
import type { EventEmitter, GenerationParams } from "./generator";

export interface AgentRunResult {
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

interface AgentCommand {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  display: string;
  kind: "claude" | "custom";
}

interface CommandResult {
  output: string;
  sessionId: string;
  stopReason: string;
  numTurns: number;
  resultText: string;
}

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 60 * 2;
const loadChildProcess = () =>
  // Hide dynamic process spawning from Next/Turbopack file tracing. This route
  // intentionally shells out to a server-installed CLI agent at runtime.
  (eval("require")("child_process") as typeof import("child_process"));

export async function runPptMasterAgent(
  params: GenerationParams,
  options: RunnerOptions
): Promise<AgentRunResult> {
  const livePreviewLockBefore = readLivePreviewLock(options.projectDir);
  try {
    return await runPptMasterAgentInner(params, options);
  } finally {
    stopProjectLivePreview(options.projectDir, livePreviewLockBefore);
  }
}

async function runPptMasterAgentInner(
  params: GenerationParams,
  options: RunnerOptions
): Promise<AgentRunResult> {
  const skillDir = getPptMasterSkillDir();
  throwIfPptCancelled(options.signal);
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(`PPT Master skill 缺少 SKILL.md：${skillFile}`);
  }

  const promptPath = writeAgentPrompt(params, options, skillDir);
  const prompt = readFileSync(promptPath, "utf-8");
  const command = resolveAgentCommand(options.projectDir, skillDir, promptPath, prompt);

  await log(params.projectId, options.emit, `启动 PPT Master CLI agent：${command.display}`);
  options.emit({ type: "phase", data: { phase: "STRATEGIZING", progress: 12 } });
  await updateProject(params.projectId, {
    status: "STRATEGIZING",
    currentPhase: "PPT Master agent 正在规划与生成",
    progress: 12,
  });

  const maxTurns = resolveMaxTurns(options);
  await log(params.projectId, options.emit, `PPT Master agent 最大续跑轮次：${maxTurns}`);

  let result = await runCommand(params.projectId, command, options, 1);
  for (let turn = 2; turn <= maxTurns && !hasPptx(options.projectDir); turn++) {
    throwIfPptCancelled(options.signal);
    const needsContinue = shouldContinueAgent(options.projectDir, result, options);
    if (!needsContinue) break;
    if (command.kind !== "claude" || !result.sessionId) {
      await log(params.projectId, options.emit, "agent 停在中间状态，但当前自定义 runner 不支持自动续跑。");
      break;
    }
    const continuePrompt = buildContinuePrompt(options.projectDir, turn, options, result);
    const continueCommand = resolveAgentCommand(
      options.projectDir,
      skillDir,
      promptPath,
      continuePrompt,
      result.sessionId
    );
    await log(params.projectId, options.emit, `agent 第 ${turn} 轮继续执行：${describeContinueState(options.projectDir, options)}`);
    result = await runCommand(params.projectId, continueCommand, options, turn);
  }

  if (!hasPptx(options.projectDir) && shouldContinueAgent(options.projectDir, result, options)) {
    const svgCount = countSvgSlides(options.projectDir);
    await log(
      params.projectId,
      options.emit,
      `agent 达到最大续跑轮次 ${maxTurns} 后仍未完成，当前 SVG ${svgCount}/${options.slideCount}。`
    );
    if (svgCount < options.slideCount) {
      throw new Error(
        `PPT Master agent 未完成全部页面：已生成 ${svgCount}/${options.slideCount} 个 SVG。最后一轮 stop_reason=${
          result.stopReason || "unknown"
        }。请提高 PPT_AGENT_MAX_TURNS 或减少页数后重试。`
      );
    }
  }

  options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 90 } });
  throwIfPptCancelled(options.signal);
  await updateProject(params.projectId, {
    status: "EXPORTING",
    currentPhase: "校验并收集 PPTX 输出",
    progress: 90,
  });

  await verifyAgentOutput(params.projectId, options);

  let pptxPath = findLatestPptx(options.projectDir);
  if (!pptxPath && countSvgSlides(options.projectDir) > 0) {
    await log(params.projectId, options.emit, "agent 已生成 SVG，服务器接管 Step 7 导出 PPTX");
    await runServerSideExport(options.projectDir);
    pptxPath = findLatestPptx(options.projectDir);
  }
  if (!pptxPath) {
    throw new Error("PPT Master agent 已结束，但没有在 exports/ 下生成 PPTX。请查看项目日志和 agent-output.log。");
  }

  return {
    pptxPath,
    slideCount: countSvgSlides(options.projectDir) || options.slideCount,
  };
}

function writeAgentPrompt(params: GenerationParams, options: RunnerOptions, skillDir: string) {
  const promptPath = join(options.projectDir, "agent-task.md");
  const sourcePath = join(options.projectDir, "sources", "source.md");
  const output = [
    "# PPT Master Server Task",
    "",
    "你是服务器内置的 PPT Master 执行 agent。必须按本地 `scripts/ppt-master/SKILL.md` 的完整流程执行，不能退回为普通一次性 prompt 生成。",
    "",
    "## Hard Requirements",
    "",
    "- 先完整阅读 PPT Master skill 文件，再执行工作流。",
    "- 本任务的用户输入已经在站内表单确认过。下面的 `USER CONFIRMS` 行就是 Step 4 Blocking Gate 的显式用户确认；不要再向用户请求确认。",
    "- 如果 workflow 文档要求输出 Eight Confirmations，请把它们写入 `design_spec.md` 的 planning context 或日志，然后继续执行。不要把“请确认”作为最终回答。",
    "- 所有可见幻灯片文字必须使用简体中文。只有 AI、API、LLM、SaaS、PPTX 等无法自然翻译的产品名或技术缩写可以保留英文。",
    "- 使用真实项目文件作为上下文，逐页顺序生成 SVG。不要写脚本批量生成 SVG，不要只生成占位页。",
    "- 每页 SVG 生成前必须重新读取 `spec_lock.md`。",
    "- 质量检查必须通过；如果 `svg_quality_checker.py` 报 error，修复后重跑。",
    "- 最后必须按 Step 7 依次运行 `total_md_split.py`、`finalize_svg.py`、`svg_to_pptx.py`，并在 `exports/` 下生成可编辑 PPTX。",
    "- 不要修改项目目录以外的业务代码。只允许写入当前 PPT 项目目录。",
    "- Hosted-mode override: 本站前端会直接预览 `svg_output/`，不要启动长期运行的 `svg_editor/server.py` live preview 服务；这一步视为由站内 SSE 预览替代。",
    "- 如果缺少 API key、依赖或 agent 权限，明确写入失败原因，不要生成假文件。",
    "",
    "## Paths",
    "",
    `- PPT Master skill: ${skillDir}`,
    `- Project path: ${options.projectDir}`,
    `- Source markdown: ${sourcePath}`,
    "",
    "## Confirmed Parameters",
    "",
    "USER CONFIRMS: I approve the eight confirmations and continuous mode. Continue all remaining steps now without asking another question.",
    `- Canvas: ${options.aspectRatio} (${options.canvasFormat})`,
    `- Target slide count: ${options.slideCount}`,
    `- Style: ${options.styleLabel || styleLabel(options.style)}`,
    `- Template hint/path: ${params.template || "(none, free design)"}`,
    "- Output language: Simplified Chinese for all visible slide text",
    "- Image usage: use placeholders or generated/web images only when the skill workflow and available environment support them; never block final PPTX solely because an optional image is unavailable.",
    "",
    "## Style Requirements",
    "",
    options.stylePrompt,
    "",
    "## Source Content",
    "",
    "Read `sources/source.md` for the concrete content. It currently contains:",
    "",
    "```markdown",
    options.sourceMd,
    "```",
    "",
    "## Completion Signal",
    "",
    "When finished, print a concise final line containing the generated PPTX path.",
    "",
  ].join("\n");

  writeFileSync(promptPath, output, "utf-8");
  return promptPath;
}

function resolveAgentCommand(
  projectDir: string,
  skillDir: string,
  promptPath: string,
  prompt: string,
  resumeSessionId?: string
): AgentCommand {
  const customCommand = process.env.PPT_AGENT_COMMAND?.trim();
  const customArgs = fillArgPlaceholders(parseArgs(process.env.PPT_AGENT_ARGS || ""), {
    projectDir,
    skillDir,
    promptPath,
    prompt,
  });

  if (customCommand) {
    const args = customArgs.some((arg) => arg.includes(prompt) || arg === prompt) ? customArgs : customArgs;
    return {
      command: customCommand,
      args,
      cwd: projectDir,
      stdin: customArgs.includes("{stdin}") ? prompt : customArgs.includes(prompt) ? "" : prompt,
      display: [customCommand, ...customArgs.filter((arg) => arg !== prompt)].join(" "),
      kind: "custom",
    };
  }

  const model = process.env.PPT_AGENT_MODEL?.trim() || "opus";
  const timeoutBudget = process.env.PPT_AGENT_MAX_BUDGET_USD?.trim();
  const args = [
    "-p",
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
    "--model",
    model,
    "--permission-mode",
    process.env.PPT_AGENT_PERMISSION_MODE?.trim() || "bypassPermissions",
    "--tools",
    process.env.PPT_AGENT_TOOLS?.trim() || "Read,Write,Edit,MultiEdit,LS,Grep,Glob,Bash",
    "--add-dir",
    skillDir,
    "--add-dir",
    getPptProjectDirBase(),
    "--output-format",
    process.env.PPT_AGENT_OUTPUT_FORMAT?.trim() || "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--input-format",
    "text",
  ];

  if (timeoutBudget) {
    args.push("--max-budget-usd", timeoutBudget);
  }

  return {
    command: process.env.PPT_AGENT_BINARY?.trim() || "claude",
    args,
    cwd: projectDir,
    stdin: prompt,
    display: `claude -p ${resumeSessionId ? "--resume <session> " : ""}--model ${model} <agent-task.md>`,
    kind: "claude",
  };
}

function buildContinuePrompt(
  projectDir: string,
  turn: number,
  options: RunnerOptions,
  previous: CommandResult
) {
  const svgCount = countSvgSlides(projectDir);
  const nextSlide = Math.min(svgCount + 1, options.slideCount);
  const interruptedByToolUse = previous.stopReason === "tool_use";

  if (svgCount >= options.slideCount) {
    return [
      "确认继续。当前目标页数的 SVG 页面已经生成，请不要重新开始，也不要重写已有 SVG。",
      "继续执行 PPT Master Step 7：质量检查、notes/total.md、total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
      "必须在 exports/ 下生成可编辑 PPTX。完成前不要停止或请求确认。",
    ].join("\n");
  }

  if (svgCount > 0) {
    return [
      "确认继续。不要重新开始，不要重写已有 SVG。",
      `当前 svg_output/ 已有 ${svgCount}/${options.slideCount} 页。请从第 ${nextSlide} 页继续逐页生成，直到第 ${options.slideCount} 页全部完成。`,
      "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
      interruptedByToolUse
        ? "上一轮因为 Claude Code print 模式的 tool_use 边界中断；如果上一条工具写入没有落盘，请重新发起对应 Write/Bash 工具调用。"
        : "",
      "完成前不要停止，不要请求确认。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const hasSpecLock = existsSync(join(projectDir, "spec_lock.md"));
  if (hasSpecLock) {
    return [
      "确认继续。design_spec.md 和 spec_lock.md 已经存在，请不要重新规划，不要重写这两个文件。",
      `当前还没有 SVG 落盘。请从第 1 页开始，逐页生成 svg_output/*.svg，目标页数 ${options.slideCount}。`,
      "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
      interruptedByToolUse
        ? "上一轮停在未完成的工具调用边界；请先完成或重做上一条 SVG Write 工具调用。"
        : "",
      "完成前不要停止，不要请求确认。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "我确认并批准上一轮 Eight Confirmations。",
    `这是服务器自动续跑第 ${turn} 轮，等价于用户明确回复“确认，继续”。`,
    "请立刻继续执行完整 PPT Master 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md，运行质量检查并修复，然后执行 total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
    "不要再输出确认问题。不要只输出计划。完成前不要停止。",
  ].join("\n");
}

function getPptProjectDirBase() {
  return PPT_PROJECTS_ROOT;
}

function parseArgs(value: string) {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to a small quoted-argument parser below.
  }

  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map((item) => item.replace(/^"|"$/g, ""));
}

function fillArgPlaceholders(
  args: string[],
  values: { projectDir: string; skillDir: string; promptPath: string; prompt: string }
) {
  return args
    .map((arg) =>
      arg
        .replaceAll("{projectDir}", values.projectDir)
        .replaceAll("{skillDir}", values.skillDir)
        .replaceAll("{promptPath}", values.promptPath)
        .replaceAll("{prompt}", values.prompt)
    )
    .filter((arg) => arg !== "{stdin}");
}

async function runCommand(
  projectId: string,
  command: AgentCommand,
  options: RunnerOptions,
  turn: number
): Promise<CommandResult> {
  mkdirSync(options.projectDir, { recursive: true });
  throwIfPptCancelled(options.signal);
  const logPath = join(options.projectDir, "agent-output.log");
  const timeoutMs = Number(process.env.PPT_AGENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return new Promise<CommandResult>((resolvePromise, reject) => {
    const spawnTarget = resolveExecutable(command.command);
    const spawnArgs = buildSpawnArgs(spawnTarget, command.args);
    const proc: ChildProcessWithoutNullStreams = loadChildProcess().spawn(spawnArgs.command, spawnArgs.args, {
      cwd: command.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PPT_MASTER_SKILL_DIR: getPptMasterSkillDir(),
        PYTHONIOENCODING: "utf-8",
      },
    } satisfies SpawnOptionsWithoutStdio);

    let output = "";
    let settled = false;
    const startedAt = Date.now();
    appendFileSync(
      logPath,
      [
        "",
        `\n===== PPT Master agent turn ${turn} started ${new Date().toISOString()} =====`,
        `cwd: ${command.cwd}`,
        `command: ${command.display}`,
        "",
      ].join("\n"),
      "utf-8"
    );

    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(88, 12 + Math.floor((elapsed / timeoutMs) * 72));
      options.emit({ type: "progress", data: { progress } });
      updateProject(projectId, { progress }).catch(console.error);
      emitPreviews(projectId, options);
    }, 15_000);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      proc.kill();
      reject(new Error(`PPT Master agent 执行超时（${Math.round(timeoutMs / 60000)} 分钟）。`));
    }, timeoutMs);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      proc.kill();
      reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error("用户已停止生成"));
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      output += text;
      appendFileSync(logPath, text, "utf-8");
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        const message = normalizeAgentLine(line);
        if (message) {
          log(projectId, options.emit, message).catch(console.error);
          updatePhaseFromLine(projectId, options, message).catch(console.error);
        }
      }
    };

    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", onChunk);

    if (command.stdin) {
      proc.stdin.write(command.stdin);
    }
    proc.stdin.end();

    proc.on("error", (error) => {
      options.signal?.removeEventListener("abort", abort);
      clearInterval(timer);
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(new Error(`无法启动 PPT Master agent：${error.message}`));
    });

    proc.on("close", async (code) => {
      options.signal?.removeEventListener("abort", abort);
      clearInterval(timer);
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      emitPreviews(projectId, options);
      if (code === 0) {
        const metadata = extractResultMetadata(output);
        await log(
          projectId,
          options.emit,
          `agent 第 ${turn} 轮结束：stop_reason=${metadata.stopReason || "unknown"}，num_turns=${metadata.numTurns || 0}`
        ).catch(console.error);
        resolvePromise({ output, ...metadata });
        return;
      }
      if (canRecoverFromAgentExit(output, options.projectDir)) {
        await log(projectId, options.emit, "agent 在最后阶段退出，检测到可恢复输出，继续由服务器完成导出。").catch(
          console.error
        );
        const metadata = extractResultMetadata(output);
        resolvePromise({ output, ...metadata });
        return;
      }
      const tail = output.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
      reject(new Error(`PPT Master agent 退出码 ${code}。\n${tail}`));
    });
  });
}

function resolveExecutable(command: string) {
  if (process.platform !== "win32" || /[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) {
    return command;
  }

  const candidates = (process.env.PATH || "")
    .split(";")
    .flatMap((dir) => [`${dir}\\${command}.cmd`, `${dir}\\${command}.exe`, `${dir}\\${command}.bat`]);
  return candidates.find((candidate) => existsSync(candidate)) || command;
}

function buildSpawnArgs(command: string, args: string[]) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

function normalizeAgentLine(line: string) {
  if (!line) return "";
  try {
    const event = JSON.parse(line);
    if (event?.type === "stream_event" || event?.type === "system" || event?.type === "user") return "";
    if (event?.type === "assistant" && Array.isArray(event?.message?.content)) {
      const texts = event.message.content
        .filter((item: { type?: string; text?: string }) => item.type === "text" && typeof item.text === "string")
        .map((item: { text: string }) => item.text);
      return texts.length ? compactLine(texts.join(" ")) : "";
    }
    const text =
      event?.message?.content?.[0]?.text ||
      event?.content?.[0]?.text ||
      event?.delta?.text ||
      event?.text ||
      event?.result;
    if (typeof text === "string") return compactLine(text);
    if (event?.type === "result") return compactLine(event?.result || "");
  } catch {
    // Plain text output.
  }
  return compactLine(line);
}

function extractResultMetadata(output: string): Omit<CommandResult, "output"> {
  let sessionId = "";
  let stopReason = "";
  let resultText = "";
  let numTurns = 0;
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (typeof event?.session_id === "string") sessionId = event.session_id;
      if (event?.type === "result") {
        if (typeof event.stop_reason === "string") stopReason = event.stop_reason;
        if (typeof event.result === "string") resultText = event.result;
        if (typeof event.num_turns === "number") numTurns = event.num_turns;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return {
    sessionId,
    stopReason,
    numTurns,
    resultText,
  };
}

function shouldContinueAgent(projectDir: string, result: CommandResult, options: RunnerOptions) {
  if (hasPptx(projectDir)) return false;
  const text = result.output.slice(-30_000);
  const svgCount = countSvgSlides(projectDir);
  const needsMoreSlides = svgCount < options.slideCount;
  return (
    result.stopReason === "tool_use" ||
    (svgCount > 0 && needsMoreSlides) ||
    (existsSync(join(projectDir, "spec_lock.md")) && needsMoreSlides) ||
    /请确认|确认后|wait for|explicit user confirmation|Eight Confirmations|继续执行|Step 7|svg_to_pptx/i.test(text)
  );
}

function resolveMaxTurns(options: RunnerOptions) {
  const configured = Number(process.env.PPT_AGENT_MAX_TURNS);
  const recommended = Math.max(18, options.slideCount * 4 + 8);
  const minimumUseful = Math.max(12, options.slideCount + 8);
  const raw = Number.isFinite(configured) && configured > 0 ? configured : recommended;
  return Math.max(minimumUseful, Math.min(80, Math.round(raw)));
}

function describeContinueState(projectDir: string, options: RunnerOptions) {
  const svgCount = countSvgSlides(projectDir);
  if (svgCount >= options.slideCount) return "SVG 已齐，推进质量检查和 PPTX 导出";
  if (svgCount > 0) return `继续生成剩余 SVG（${svgCount}/${options.slideCount} 已完成）`;
  if (existsSync(join(projectDir, "spec_lock.md"))) return "规划已完成，继续逐页写入 SVG";
  return "确认门控并推进到规划与生成";
}

function hasPptx(projectDir: string) {
  return Boolean(findLatestPptx(projectDir));
}

function canRecoverFromAgentExit(output: string, projectDir: string) {
  return (
    countSvgSlides(projectDir) > 0 &&
    /error_max_budget_usd|Reached maximum budget|"stop_reason"\s*:\s*"tool_use"/i.test(output)
  );
}

function compactLine(line: string) {
  return line.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function updatePhaseFromLine(projectId: string, options: RunnerOptions, line: string) {
  const lower = line.toLowerCase();
  if (lower.includes("image") || line.includes("图像") || line.includes("素材")) {
    await updateProject(projectId, { status: "ACQUIRING_IMAGES", currentPhase: "采集或生成素材" });
    options.emit({ type: "phase", data: { phase: "ACQUIRING_IMAGES", progress: 35 } });
    return;
  }
  if (lower.includes("svg") || line.includes("executor") || line.includes("生成第")) {
    await updateProject(projectId, { status: "EXECUTING", currentPhase: "逐页生成 SVG" });
    options.emit({ type: "phase", data: { phase: "EXECUTING", progress: 45 } });
    return;
  }
  if (lower.includes("pptx") || lower.includes("export") || line.includes("导出")) {
    await updateProject(projectId, { status: "EXPORTING", currentPhase: "导出 PPTX" });
    options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 88 } });
  }
}

function emitPreviews(projectId: string, options: RunnerOptions) {
  const svgDir = join(options.projectDir, "svg_output");
  if (!existsSync(svgDir)) return;
  const files = readdirSync(svgDir)
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  files.forEach((file, index) => {
    options.emit({
      type: "preview",
      data: {
        pageIndex: index,
        svgUrl: `/api/ppt/projects/${projectId}/files/svg_output/${encodeURIComponent(file)}`,
      },
    });
  });
}

async function verifyAgentOutput(projectId: string, options: RunnerOptions) {
  const svgCount = countSvgSlides(options.projectDir);
  if (svgCount < 1) {
    throw new Error("PPT Master agent 没有生成任何 SVG 页面。");
  }

  await updateProject(projectId, {
    svgOutputPath: join(options.projectDir, "svg_output"),
    specPath: existsSync(join(options.projectDir, "design_spec.md")) ? join(options.projectDir, "design_spec.md") : undefined,
    specLockPath: existsSync(join(options.projectDir, "spec_lock.md")) ? join(options.projectDir, "spec_lock.md") : undefined,
    slideCount: svgCount,
  });

  const quality = await checkSvgQuality(options.projectDir);
  if (quality.errors.length > 0) {
    throw new Error(`SVG 质量检查失败：${quality.errors.join("; ")}`);
  }
}

async function runServerSideExport(projectDir: string) {
  await splitNotes(projectDir).catch(() => undefined);
  await finalizeSvg(projectDir);
  await convertSvgToPptx(projectDir);
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

function countSvgSlides(projectDir: string) {
  const svgDir = join(projectDir, "svg_output");
  if (!existsSync(svgDir)) return 0;
  return readdirSync(svgDir).filter((file) => file.toLowerCase().endsWith(".svg")).length;
}

function readLivePreviewLock(projectDir: string) {
  const lockPath = join(projectDir, ".live_preview.lock");
  if (!existsSync(lockPath)) return "";
  try {
    return readFileSync(lockPath, "utf-8");
  } catch {
    return "";
  }
}

function stopProjectLivePreview(projectDir: string, previousLock: string) {
  if (process.env.PPT_AGENT_KEEP_LIVE_PREVIEW === "true") return;

  const lockPath = join(projectDir, ".live_preview.lock");
  if (!existsSync(lockPath)) return;

  try {
    const currentLock = readFileSync(lockPath, "utf-8");
    if (previousLock && currentLock === previousLock) return;

    const lock = JSON.parse(currentLock) as { pid?: unknown };
    const pid = typeof lock.pid === "number" ? lock.pid : Number(lock.pid);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid);
      } catch {
        // The process may already be gone; removing a stale lock is enough.
      }
    }
    unlinkSync(lockPath);
  } catch {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function styleLabel(style?: string) {
  return getPptStyleLabel(style);
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
