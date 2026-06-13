# PPT 生成模块实现方案（Multi-Agent 架构）

## 核心认知修正

**ppt-master 不是传统 Python 应用**，而是：
- **Claude Code Skill**：通过 Claude Agent harness 的多角色协作系统
- **Strategist / Executor 是 Claude 的不同 persona**：读取 role definition，切换上下文执行
- **Python 脚本仅辅助**：文档转换、图片生成、SVG→PPTX 导出等工具，不负责核心生成逻辑
- **必须在 Claude 对话中执行**：无法独立运行，需 Claude API + Agent harness

---

## 方案对比

### ❌ 方案 A：独立 Python 服务（不可行）
- ppt-master 的核心是 **Claude Agent 执行 references/*.md 中的 role prompts**
- Strategist/Executor 是 **10000+ token 的系统提示词**，不是代码
- 无法打包成独立服务

### ✅ 方案 B：聚合站集成 Claude Agent SDK（推荐）
通过 Anthropic 的 Agent SDK 在 Node.js 中复现 multi-agent 流程

### ✅ 方案 C：外部 Claude Code 执行 + API 桥接（最快上线）
用户在本地 Claude Code 中执行 ppt-master skill，聚合站只提供项目管理界面

---

## 推荐方案：方案 B（Claude Agent SDK 集成）

### 架构设计

```
用户输入（聚合站前端）
  ↓
Node.js API 创建项目
  ↓
调用 Claude Agent SDK
  ↓
┌─────────────────────────────────────┐
│  Multi-Agent 协作（Node.js 内）     │
├─────────────────────────────────────┤
│ 1. Strategist Agent                 │
│    - 读取 references/strategist.md  │
│    - 分析源文档 → design_spec.md    │
│    - 输出：Eight Confirmations      │
├─────────────────────────────────────┤
│ 2. Image Generator Agent (可选)     │
│    - 根据 spec 生成/搜索图片        │
│    - 调用 DALL-E / Stable Diffusion │
├─────────────────────────────────────┤
│ 3. Executor Agent (多轮)            │
│    - 读取 references/executor-*.md  │
│    - 逐页生成 SVG（context-aware）  │
│    - 实时写入 svg_output/           │
└─────────────────────────────────────┘
  ↓
Python 工具调用（Node.js child_process）
  - svg_to_pptx.py（SVG → PPTX）
  - latex_render.py（公式渲染）
  ↓
返回 PPTX 文件
```

---

## 技术实现细节

### 1. Agent SDK 使用

```typescript
// src/lib/ppt-agent/orchestrator.ts

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// 角色切换：加载对应的 system prompt
async function switchRole(role: "strategist" | "executor", context: string) {
  const systemPrompt = readFileSync(
    `scripts/ppt-master/references/${role}-base.md`,
    "utf-8"
  );
  
  return anthropic.messages.create({
    model: "claude-opus-4",
    max_tokens: 8000,
    system: systemPrompt, // role definition
    messages: [{ role: "user", content: context }],
  });
}

// Step 4: Strategist 阶段
export async function runStrategist(projectPath: string, sourceMd: string) {
  const designSpecTemplate = readFileSync(
    "scripts/ppt-master/templates/design_spec_reference.md",
    "utf-8"
  );
  
  const context = `
项目路径: ${projectPath}
源文档内容:
${sourceMd}

请按照 design_spec_reference.md 的结构输出设计规格，包含 Eight Confirmations。
  `;
  
  const response = await switchRole("strategist", context);
  const designSpec = response.content[0].text;
  
  // 写入 design_spec.md
  writeFileSync(`${projectPath}/design_spec.md`, designSpec);
  
  return designSpec;
}

// Step 6: Executor 阶段（逐页生成）
export async function runExecutor(
  projectPath: string,
  pageIndex: number,
  totalPages: number
) {
  const specLock = readFileSync(`${projectPath}/spec_lock.md`, "utf-8");
  const currentPageSpec = extractPageSpec(specLock, pageIndex);
  
  const context = `
项目路径: ${projectPath}
当前页码: ${pageIndex + 1} / ${totalPages}
页面规格:
${currentPageSpec}

请生成此页的 SVG 代码，遵循 executor-base.md 和 shared-standards.md。
  `;
  
  const response = await switchRole("executor", context);
  const svg = extractSVGFromResponse(response.content[0].text);
  
  writeFileSync(`${projectPath}/svg_output/slide_${pageIndex}.svg`, svg);
  
  return svg;
}
```

### 2. 完整生成流程

```typescript
// src/app/api/ppt/generate/route.ts

export async function POST(req: Request) {
  const { sourceType, sourceTopic, template } = await req.json();
  const session = await auth();
  
  // 1. 创建项目
  const project = await prisma.pptProject.create({
    data: {
      userId: session!.user.id,
      title: sourceTopic,
      sourceType,
      sourceTopic,
      template,
      projectPath: `projects/${cuid()}`,
      status: "PENDING",
    },
  });
  
  const projectPath = `public/${project.projectPath}`;
  
  // SSE 流式返回
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, data: any) => {
        controller.enqueue(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      
      try {
        // Step 1: 初始化项目
        emit("phase", { phase: "INITIALIZING", progress: 0 });
        execSync(`python scripts/ppt-master/scripts/project_manager.py init ${projectPath}`);
        
        // Step 2: 文档转 Markdown（如需要）
        let sourceMd = sourceTopic;
        if (sourceType === "document") {
          emit("phase", { phase: "CONVERTING", progress: 10 });
          sourceMd = execSync(
            `python scripts/ppt-master/scripts/source_to_md/pdf_to_md.py ${sourceFile}`
          ).toString();
          writeFileSync(`${projectPath}/source.md`, sourceMd);
        }
        
        // Step 3: 模板选择（如指定）
        if (template) {
          emit("log", { message: `应用模板: ${template}` });
          // 复制模板文件...
        }
        
        // Step 4: Strategist 阶段
        emit("phase", { phase: "STRATEGIZING", progress: 20 });
        emit("log", { message: "Strategist 正在分析内容..." });
        
        const designSpec = await runStrategist(projectPath, sourceMd);
        
        // 解析 Eight Confirmations（可选：用户确认）
        const confirmations = parseEightConfirmations(designSpec);
        emit("confirmations", confirmations);
        
        // 这里可以暂停等用户确认，或自动继续
        
        // 生成 spec_lock.md
        const specLock = await finalizeSpec(projectPath, designSpec);
        const pageCount = extractPageCount(specLock);
        
        // Step 5: Image Generator（如需要）
        const imageRows = extractImageRequirements(specLock);
        if (imageRows.length > 0) {
          emit("phase", { phase: "ACQUIRING_IMAGES", progress: 40 });
          for (const row of imageRows) {
            emit("log", { message: `生成图片: ${row.description}` });
            // 调用图片生成 API...
          }
        }
        
        // Step 6: Executor 阶段（逐页生成）
        emit("phase", { phase: "EXECUTING", progress: 50 });
        
        for (let i = 0; i < pageCount; i++) {
          emit("log", { message: `渲染页面 ${i + 1}/${pageCount}` });
          
          const svg = await runExecutor(projectPath, i, pageCount);
          
          emit("preview", {
            pageIndex: i,
            svgUrl: `/${project.projectPath}/svg_output/slide_${i}.svg`,
          });
          
          emit("progress", {
            progress: 50 + (40 * (i + 1)) / pageCount,
          });
        }
        
        // Step 7: SVG → PPTX
        emit("phase", { phase: "EXPORTING", progress: 90 });
        const pptxPath = execSync(
          `python scripts/ppt-master/scripts/svg_to_pptx.py ${projectPath}`
        ).toString().trim();
        
        await prisma.pptProject.update({
          where: { id: project.id },
          data: {
            status: "COMPLETED",
            pptxPath,
            progress: 100,
          },
        });
        
        emit("complete", {
          pptxUrl: `/${pptxPath}`,
        });
        
      } catch (error) {
        emit("error", { message: error.message });
        await prisma.pptProject.update({
          where: { id: project.id },
          data: { status: "FAILED", error: error.message },
        });
      } finally {
        controller.close();
      }
    },
  });
  
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

---

## 关键技术点

### 1. Role Definition 加载

ppt-master 的 `references/` 目录包含完整的角色定义：
- `strategist.md`：设计师角色（~5000 tokens）
- `executor-base.md` + `executor-general.md`：执行者角色（~8000 tokens）
- `shared-standards.md`：SVG/PPTX 技术约束

**实现方式**：
```typescript
const rolePrompts = {
  strategist: readFileSync("scripts/ppt-master/references/strategist.md", "utf-8"),
  executorBase: readFileSync("scripts/ppt-master/references/executor-base.md", "utf-8"),
  executorGeneral: readFileSync("scripts/ppt-master/references/executor-general.md", "utf-8"),
  sharedStandards: readFileSync("scripts/ppt-master/references/shared-standards.md", "utf-8"),
};

const executorSystemPrompt = [
  rolePrompts.executorBase,
  rolePrompts.sharedStandards,
  rolePrompts.executorGeneral,
].join("\n\n");
```

### 2. Context 传递

每个 Agent 调用需要完整的上下文：
- **Strategist**：源文档、模板（如有）、design_spec_reference.md
- **Executor**：spec_lock.md、当前页规格、已生成的前序页面（保持一致性）

**实现方式**：
```typescript
// Executor 逐页生成时，携带全局上下文
const globalContext = {
  specLock: readFileSync(`${projectPath}/spec_lock.md`, "utf-8"),
  previousPages: [], // 前 N 页的 SVG（context-aware）
};

for (let i = 0; i < pageCount; i++) {
  const pageSpec = extractPageSpec(globalContext.specLock, i);
  const svg = await runExecutor({
    ...globalContext,
    currentPage: i,
    pageSpec,
  });
  
  globalContext.previousPages.push(svg); // 累积上下文
}
```

### 3. 工具调用（Tool Use）

Claude Agent 可以调用工具函数：
```typescript
const tools = [
  {
    name: "write_svg_file",
    description: "将生成的 SVG 写入文件",
    input_schema: {
      type: "object",
      properties: {
        pageIndex: { type: "number" },
        svgContent: { type: "string" },
      },
    },
  },
  {
    name: "generate_image",
    description: "调用图片生成 API",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        style: { type: "string" },
      },
    },
  },
];

const response = await anthropic.messages.create({
  model: "claude-opus-4",
  system: executorSystemPrompt,
  messages: [{ role: "user", content: context }],
  tools, // 提供工具
});

// 处理工具调用
if (response.stop_reason === "tool_use") {
  const toolCall = response.content.find((c) => c.type === "tool_use");
  if (toolCall.name === "write_svg_file") {
    writeFileSync(
      `${projectPath}/svg_output/slide_${toolCall.input.pageIndex}.svg`,
      toolCall.input.svgContent
    );
  }
}
```

---

## 与原 ppt-master 的差异

| 维度 | ppt-master（Claude Code） | 聚合站实现（Agent SDK） |
|------|--------------------------|-------------------------|
| 执行环境 | Claude Code CLI/Desktop | Node.js + Anthropic SDK |
| 角色切换 | 手动切换（读取 references/*.md） | 程序化切换（API 调用） |
| 用户交互 | 对话式确认（Eight Confirmations） | 可选：自动继续或前端确认 |
| 实时预览 | 本地 HTTP 服务器 | 前端 SSE 流式接收 SVG |
| 工具调用 | 直接执行 Python 脚本 | child_process 或 Tool Use |
| 项目管理 | 文件系统 | PostgreSQL + 文件系统 |

---

## 实施步骤（修正版）

### Phase 1: ppt-master 核心迁移（3-4天）
1. **复制 ppt-master 核心文件**
   ```bash
   mkdir -p scripts/ppt-master
   cp -r <ppt-master-repo>/skills/ppt-master/* scripts/ppt-master/
   ```
2. **封装 Agent 调用层**
   - `src/lib/ppt-agent/orchestrator.ts`（Strategist/Executor 调用）
   - `src/lib/ppt-agent/tools.ts`（Python 工具桥接）
3. **测试独立生成**
   ```typescript
   // test.ts
   const result = await runStrategist(projectPath, "AI 的未来");
   console.log(result); // 验证 design_spec.md 输出
   ```

### Phase 2: API 层与数据库（2-3天）
4. **Prisma Schema 扩展**（同原方案）
5. **API 路由实现**
   - `/api/ppt/generate`（SSE 流式生成）
   - `/api/ppt/projects/[id]/export`（PPTX 下载）
6. **积分扣费逻辑**

### Phase 3: 前端工作台（2-3天）
7. **项目列表与创建表单**（同原方案）
8. **实时预览组件**
   - SSE 接收 SVG URL
   - 网格展示 + 逐页更新

### Phase 4: 高级功能（2-3天）
9. **Eight Confirmations 交互**
   - Strategist 输出后暂停
   - 前端展示选项（画布格式、页数、配色等）
   - 用户确认后继续
10. **模板系统**
    - 复制 `templates/` 目录
    - 前端模板选择器

---

## 成本与限制

### API 成本
- **Strategist 调用**：1 次 × ~$0.10（长 system prompt + 文档内容）
- **Executor 调用**：10 页 × ~$0.05/页 = $0.50（每页需读取 spec_lock.md）
- **总计**：~$0.60/项目（10 页 PPT）

### 技术限制
1. **Context 长度**：长文档可能超过 200k context（需分块）
2. **一致性问题**：多次 API 调用可能导致风格不一致（需传递前序页面）
3. **无法完全复现**：Claude Code 的 Agent harness 有内部优化（如 context caching），SDK 需自行实现

---

## 方案 C：快速上线方案（折中）

如果 Agent SDK 实现复杂度高，可以先做**混合方案**：

1. **用户在本地 Claude Code 执行 ppt-master skill**
2. **生成完成后上传到聚合站**
3. **聚合站提供**：
   - 项目管理界面（列表、预览、下载）
   - 模板市场
   - 积分计费（按上传次数）

**优势**：
- 快速上线（1周）
- 完全复用 ppt-master（无需移植）
- 用户获得完整 Claude Code 体验

**劣势**：
- 需用户安装 Claude Code
- 无法在线生成

---

## 我的建议

**推荐 Phase 1 优先实现方案 B（Agent SDK）**：
1. 先实现 Strategist + Executor 的最小流程（单页 PPT）
2. 验证 Agent SDK 能否稳定输出符合规格的 SVG
3. 如果效果不理想，再考虑方案 C（外部 Claude Code）

**关键验证点**：
- Strategist 能否输出完整的 design_spec.md？
- Executor 能否逐页生成符合 shared-standards.md 的 SVG？
- 多页 PPT 的视觉一致性如何？

**你觉得这个方案可行吗？我现在开始实现 Phase 1（Agent 封装层）？**
