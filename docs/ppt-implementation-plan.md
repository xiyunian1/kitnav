# PPT 生成模块实现计划

## 项目背景

**目标**：将 ppt-master（Python + Claude multi-agent harness）完整迁移到聚合站平台，提供从任意文档到原生可编辑 PPTX 的生成能力。

**ppt-master 核心架构**：
- **技术栈**：Python 3.10+、python-pptx、lxml、Claude API（通过 Claude Code 的 multi-agent harness 执行）
- **生成流程**：Source → Markdown → Strategist (设计规格) → Image Generator → Executor (SVG 页面) → SVG-to-PPTX → 后处理 → 导出
- **输出格式**：原生 PPTX（非截图，每个形状/文本框都可编辑），SVG 实时预览
- **多角色协作**：Strategist（设计师）、Image Generator（图片采集）、Executor（执行者，渲染 SVG 页面）
- **项目结构**：每个项目一个目录（`projects/<name>/`），包含 design_spec.md、spec_lock.md、SVG 输出、images/、templates/

**聚合站现状**：
- Next.js 15 + Prisma + PostgreSQL + Auth.js，已有图片/视频/文案等模块
- 统一积分体系、用户自带 key、模块开关、流式生成 API
- 已删除旧 PPT 模块（原实现未知）

---

## 架构设计

### 1. 技术选型

**方案 A：完全迁移到 Node.js**
- ❌ python-pptx 无等价 Node 库，需从零实现 PPTX 生成（数月工作量）
- ❌ ppt-master 的 SVG→PPTX 转换器（2000+ 行 Python）无法复用

**方案 B：保留 Python 后端，Node.js 作为编排层（推荐）**
- ✅ 复用 ppt-master 全部核心代码（SVG 渲染、PPTX 导出、模板系统）
- ✅ Next.js 负责前端工作台、API 路由、数据库持久化、积分扣费
- ✅ Python 进程作为"生成引擎"，通过子进程或 HTTP 调用
- ⚠️ 需部署 Python 环境和依赖（Dockerfile 需双语言栈）

**最终选择**：**方案 B**，Python 作为独立微服务或子进程，Node.js 编排。

---

### 2. 系统分层

```
┌─────────────────────────────────────────────┐
│  前端（Next.js SSR + Client Components）    │
│  - PPT 工作台（输入主题/上传文档）           │
│  - 实时预览（SVG 流式渲染）                  │
│  - 项目列表/历史管理                         │
└──────────────┬──────────────────────────────┘
               │ HTTP (Server Actions / API Routes)
┌──────────────▼──────────────────────────────┐
│  Node.js 编排层（Next.js API）               │
│  - /api/ppt/generate (创建项目、流式返回)    │
│  - /api/ppt/projects/[id]/export (导出PPTX) │
│  - /api/ppt/projects/[id]/preview (SVG)     │
│  - 积分扣费、用户鉴权、DB 持久化              │
└──────────────┬──────────────────────────────┘
               │ 子进程 / HTTP
┌──────────────▼──────────────────────────────┐
│  Python 生成引擎（ppt-master core）          │
│  - project_manager.py (项目初始化)          │
│  - 多角色执行（Strategist/Executor）          │
│  - svg_to_pptx.py (SVG→PPTX 转换)           │
│  - source_to_md/ (文档解析)                  │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  存储层                                      │
│  - PostgreSQL (项目元数据、用户、积分)       │
│  - 文件系统 (projects/<id>/, uploads/)       │
└─────────────────────────────────────────────┘
```

---

### 3. 数据模型设计（Prisma Schema）

```prisma
enum PptProjectStatus {
  PENDING        // 等待生成
  STRATEGIZING   // Strategist 阶段
  ACQUIRING_IMAGES // 图片采集
  EXECUTING      // Executor 渲染 SVG
  EXPORTING      // 生成 PPTX
  COMPLETED      // 完成
  FAILED         // 失败
}

enum PptSourceType {
  TOPIC          // 纯主题输入
  DOCUMENT       // 上传文档（PDF/DOCX/PPTX）
  URL            // 网页链接
  MARKDOWN       // Markdown 输入
}

model PptProject {
  id            String            @id @default(cuid())
  userId        String
  title         String            // 项目标题（用户输入或自动提取）
  sourceType    PptSourceType
  sourceTopic   String?           // 主题描述（sourceType=TOPIC）
  sourceFileUrl String?           // 上传文档路径（sourceType=DOCUMENT）
  sourceUrl     String?           // 网页 URL（sourceType=URL）
  sourceMarkdown String?          // Markdown 内容（sourceType=MARKDOWN）
  
  status        PptProjectStatus  @default(PENDING)
  currentPhase  String?           // Strategist/ImageGen/Executor
  progress      Int               @default(0) // 0-100
  
  // 生成参数
  template      String?           // 模板 ID（ppt169_*）
  slideCount    Int?              // 目标页数
  aspectRatio   String            @default("16:9") // 16:9 或 4:3
  
  // 输出路径（相对 projects/ 目录）
  projectPath   String            // projects/<cuid>/
  specPath      String?           // design_spec.md
  svgPath       String?           // svg_final/
  pptxPath      String?           // output.pptx
  
  // 执行日志
  logs          String?           // 流式日志累积
  error         String?
  
  // 积分与计费
  creditsCost   Int               @default(0)
  usedOwnKey    Boolean           @default(false)
  
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  completedAt   DateTime?
  
  user          User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId, createdAt])
  @@index([status])
}

// User 模型需添加
model User {
  // ... 现有字段
  pptProjects   PptProject[]
}

enum ModuleType {
  // ... 现有
  PPT
}
```

---

### 4. Python 服务接口设计

#### 4.1 启动模式

**开发环境**：Next.js 通过 `child_process.spawn` 调用 Python 脚本
**生产环境**：独立 Python HTTP 服务（FastAPI/Flask），或打包为二进制（PyInstaller）

#### 4.2 API 端点

```python
# scripts/ppt_service.py (FastAPI)

POST /generate
  Body: {
    projectId: string,
    sourceType: "topic" | "document" | "url" | "markdown",
    sourceTopic?: string,
    sourceFileUrl?: string,
    sourceUrl?: string,
    sourceMarkdown?: string,
    template?: string,
    slideCount?: number,
    aspectRatio?: "16:9" | "4:3",
    apiKey?: string,  // 用户自带 key
  }
  Response: SSE 流
    event: progress | log | phase | error | complete
    data: { phase, progress, message, svgUrl?, pptxUrl? }

POST /export
  Body: { projectId: string }
  Response: { pptxUrl: string }

GET /preview/:projectId/:page
  Response: SVG 文件内容
```

#### 4.3 Python 执行流程（伪代码）

```python
# scripts/ppt_service.py

async def generate_ppt(params):
    project_dir = f"projects/{params.projectId}"
    
    # 1. 项目初始化
    emit_event("phase", "STRATEGIZING", 0)
    project_manager.create_project(project_dir, params)
    
    # 2. 文档转 Markdown（如需要）
    if params.sourceType == "document":
        md = source_to_md.convert(params.sourceFileUrl)
        write(f"{project_dir}/source.md", md)
    
    # 3. Strategist 阶段（调用 Claude API）
    emit_event("log", "Strategist 正在分析内容...")
    strategist_prompt = load_template("references/strategist.md")
    design_spec = await claude_api.call(strategist_prompt, context)
    write(f"{project_dir}/design_spec.md", design_spec)
    emit_event("progress", 30)
    
    # 4. 图片采集（可选）
    emit_event("phase", "ACQUIRING_IMAGES", 30)
    images = await image_generator.acquire(design_spec)
    emit_event("progress", 50)
    
    # 5. Executor 阶段
    emit_event("phase", "EXECUTING", 50)
    for i, slide in enumerate(slides):
        svg = await executor.render_slide(slide, template)
        write(f"{project_dir}/svg_final/slide_{i}.svg", svg)
        emit_event("log", f"渲染页面 {i+1}/{total}")
        emit_event("progress", 50 + 40 * (i+1) / total)
    
    # 6. SVG → PPTX
    emit_event("phase", "EXPORTING", 90)
    pptx_path = svg_to_pptx.convert(project_dir)
    emit_event("progress", 100)
    emit_event("complete", pptxUrl=pptx_path)
```

---

### 5. Next.js API 层实现

#### 5.1 生成接口

```typescript
// src/app/api/ppt/generate/route.ts

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deductCredits } from "@/lib/credits";
import { spawn } from "child_process";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await req.json();
  const { sourceType, sourceTopic, template, slideCount } = body;
  
  // 创建项目记录
  const project = await prisma.pptProject.create({
    data: {
      userId: session.user.id,
      title: sourceTopic || "未命名项目",
      sourceType,
      sourceTopic,
      template,
      slideCount,
      projectPath: `projects/${cuid()}`,
      status: "PENDING",
    },
  });
  
  // 积分预扣（按页数估算，如 10 积分/页）
  const estimatedCost = (slideCount || 10) * 10;
  await deductCredits(session.user.id, estimatedCost, {
    module: "PPT",
    projectId: project.id,
  });
  
  // 启动 Python 生成进程（SSE 流式返回）
  const stream = new ReadableStream({
    async start(controller) {
      const python = spawn("python", [
        "scripts/ppt_service.py",
        "--generate",
        "--project-id", project.id,
        "--source-type", sourceType,
        "--source-topic", sourceTopic,
        // ... 其他参数
      ]);
      
      python.stdout.on("data", (chunk) => {
        const event = JSON.parse(chunk.toString());
        controller.enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        
        // 同步更新 DB
        prisma.pptProject.update({
          where: { id: project.id },
          data: {
            status: event.phase,
            progress: event.progress,
            logs: { append: event.message },
          },
        });
      });
      
      python.on("close", () => controller.close());
    },
  });
  
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

#### 5.2 导出接口

```typescript
// src/app/api/ppt/projects/[id]/export/route.ts

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const project = await prisma.pptProject.findFirst({
    where: { id: params.id, userId: session!.user.id },
  });
  
  if (!project || !project.pptxPath) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  
  const file = await fs.readFile(project.pptxPath);
  return new Response(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${project.title}.pptx"`,
    },
  });
}
```

---

### 6. 前端工作台设计

```
src/app/(app)/ppt/
├── page.tsx                    // 项目列表 + 新建入口
├── [id]/
│   ├── page.tsx               // 项目详情（实时预览 + 日志）
│   └── present/
│       └── page.tsx           // 演示模式（全屏 SVG）
├── components/
│   ├── project-list.tsx       // 历史项目卡片
│   ├── generation-form.tsx    // 创建表单（主题/上传文档/模板选择）
│   ├── project-viewer.tsx     // 项目查看器（SVG 预览 + 侧边栏日志）
│   └── slide-preview.tsx      // 单页 SVG 预览
└── api.ts                      // 客户端 API 调用
```

#### 6.1 创建表单

```tsx
// components/generation-form.tsx

export function GenerationForm() {
  const [sourceType, setSourceType] = useState<"topic" | "document">("topic");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [template, setTemplate] = useState("ppt169_general_dark_tech");
  const [slideCount, setSlideCount] = useState(10);
  
  const handleSubmit = async () => {
    const formData = new FormData();
    formData.append("sourceType", sourceType);
    if (sourceType === "topic") formData.append("sourceTopic", topic);
    if (sourceType === "document") formData.append("file", file!);
    formData.append("template", template);
    formData.append("slideCount", slideCount.toString());
    
    const res = await fetch("/api/ppt/generate", { method: "POST", body: formData });
    const reader = res.body!.getReader();
    // SSE 流式读取...
  };
  
  return (
    <form>
      <Tabs value={sourceType} onValueChange={setSourceType}>
        <Tab value="topic">输入主题</Tab>
        <Tab value="document">上传文档</Tab>
      </Tabs>
      
      {sourceType === "topic" && (
        <Textarea
          placeholder="例如：人工智能的发展史"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      )}
      
      {sourceType === "document" && (
        <FileUpload accept=".pdf,.docx,.pptx" onChange={setFile} />
      )}
      
      <Select value={template} onChange={setTemplate}>
        <option value="ppt169_general_dark_tech">深色科技风</option>
        <option value="ppt169_brutalist_ai">野兽派</option>
        {/* 更多模板... */}
      </Select>
      
      <Input
        type="number"
        label="目标页数"
        value={slideCount}
        onChange={(e) => setSlideCount(+e.target.value)}
      />
      
      <Button onClick={handleSubmit}>开始生成</Button>
    </form>
  );
}
```

#### 6.2 实时预览

```tsx
// components/project-viewer.tsx

export function ProjectViewer({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  useEffect(() => {
    const sse = new EventSource(`/api/ppt/projects/${projectId}/stream`);
    
    sse.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      setProject((p) => ({ ...p!, progress: data.progress, status: data.phase }));
    });
    
    sse.addEventListener("log", (e) => {
      setLogs((logs) => [...logs, JSON.parse(e.data).message]);
    });
    
    sse.addEventListener("complete", (e) => {
      setProject((p) => ({ ...p!, status: "COMPLETED", pptxUrl: JSON.parse(e.data).pptxUrl }));
    });
    
    return () => sse.close();
  }, [projectId]);
  
  return (
    <div className="grid grid-cols-[1fr_300px]">
      <div>
        <h2>{project?.title}</h2>
        <Progress value={project?.progress || 0} />
        <div className="grid grid-cols-2 gap-4">
          {project?.svgPages?.map((svg, i) => (
            <SlidePreview key={i} svg={svg} index={i} />
          ))}
        </div>
        {project?.status === "COMPLETED" && (
          <Button asChild>
            <a href={`/api/ppt/projects/${projectId}/export`} download>
              下载 PPTX
            </a>
          </Button>
        )}
      </div>
      
      <aside>
        <h3>生成日志</h3>
        <div className="space-y-1 font-mono text-xs">
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </aside>
    </div>
  );
}
```

---

### 7. 部署配置

#### 7.1 Dockerfile（双语言栈）

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app

# Python 运行时层
FROM python:3.11-alpine AS python-runtime
WORKDIR /app
RUN apk add --no-cache gcc musl-dev libxml2-dev libxslt-dev
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Node.js 构建层
FROM base AS builder
COPY --from=python-runtime /usr/local /usr/local
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Runner
FROM base AS runner
ENV NODE_ENV=production
RUN apk add --no-cache python3 py3-pip
COPY --from=python-runtime /usr/local /usr/local
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY scripts ./scripts
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 3001
CMD ["node", "server.js"]
```

#### 7.2 环境变量

```.env
# 现有变量
DATABASE_URL=...
NEXTAUTH_SECRET=...

# PPT 模块
CLAUDE_API_KEY=...                    # Claude API（Strategist/Executor）
PPT_PROJECTS_DIR=./projects           # 项目存储目录
PPT_CREDITS_PER_SLIDE=10              # 每页积分消耗
```

---

### 8. 实施步骤

#### Phase 1: 基础架构（2-3天）
1. **Prisma Schema 扩展**
   - 添加 `PptProject` 模型
   - 迁移数据库：`npx prisma migrate dev`
2. **Python 服务搭建**
   - 复制 ppt-master 核心代码到 `scripts/ppt/`
   - 编写 `scripts/ppt_service.py`（FastAPI HTTP 服务或 CLI 封装）
   - 测试独立运行：`python scripts/ppt_service.py --generate --source-topic "测试"`
3. **Node.js 桥接层**
   - 实现 `/api/ppt/generate`（子进程调用 Python，SSE 流式返回）
   - 实现 `/api/ppt/projects/[id]/export`（PPTX 文件下载）

#### Phase 2: 前端工作台（2-3天）
4. **项目列表页**（`src/app/(app)/ppt/page.tsx`）
   - 展示历史项目（卡片 + 缩略图）
   - "新建项目"按钮
5. **创建表单**（`components/generation-form.tsx`）
   - 主题输入 / 文档上传切换
   - 模板选择（从 ppt-master 的 examples/ 提取）
   - 页数滑块
6. **项目详情页**（`src/app/(app)/ppt/[id]/page.tsx`）
   - 左侧：SVG 预览网格（实时更新）
   - 右侧：进度条 + 日志流
   - 完成后：下载按钮

#### Phase 3: 高级功能（2-3天）
7. **文档解析**
   - 集成 `source_to_md/`（PDF/DOCX → Markdown）
   - 文件上传接口（`/api/ppt/upload`）
8. **模板系统**
   - 复制 ppt-master 的 `templates/` 目录
   - 前端模板选择器（预览图 + 描述）
9. **积分计费**
   - 生成前预扣费（按页数）
   - 失败退款逻辑

#### Phase 4: 优化与测试（1-2天）
10. **性能优化**
    - Python 进程池（避免重复启动）
    - SVG 缓存（CDN 或本地静态）
11. **错误处理**
    - Python 异常捕获 → Node.js 日志
    - 超时保护（单项目最多 30 分钟）
12. **端到端测试**
    - 主题输入 → PPTX 导出全流程
    - 上传 PDF → 多页 PPT 生成

---

### 9. 技术风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| Python 依赖安装失败（Windows） | 阻塞部署 | 提供 Docker 镜像；文档明确依赖版本 |
| Claude API 限流/超时 | 生成中断 | 实现重试机制；支持暂停/恢复 |
| SVG → PPTX 转换失败 | 用户无法导出 | 降级方案：提供 SVG 打包下载 |
| 大文件（100 页 PPT）内存溢出 | 进程崩溃 | 分批处理；设置页数上限（如 50 页） |
| 多用户并发生成 | 服务器过载 | 队列机制；限制同时生成数（如 3 个） |

---

### 10. 成本估算

#### 开发时间
- **Phase 1-2（核心功能）**：4-6 天
- **Phase 3-4（完整功能）**：3-4 天
- **总计**：1-2 周（单人）

#### 运行成本
- **Claude API**：假设 10 页 PPT，每页需 2 次 API 调用（Strategist + Executor），单次 ~$0.05，总计 **$1/项目**
- **图片生成**（可选）：如使用 DALL-E 3，每图 $0.04，10 图 = $0.4
- **服务器**：Python 运行时额外 ~500MB 内存

---

### 11. 后续扩展方向

1. **批量生成**：上传多个文档 → 批量输出 PPT
2. **协作编辑**：多人共享项目，实时预览
3. **动画支持**：ppt-master 已支持动画配置，可启用
4. **语音旁白**：集成 TTS（ppt-master 文档已提及）
5. **在线演示**：WebRTC + SVG 实时演示（无需下载 PPTX）

---

## 总结

**核心决策**：
- ✅ 保留 Python（复用 ppt-master 全部核心代码）
- ✅ Next.js 作为编排层（前端 + API + DB）
- ✅ SSE 流式生成（用户体验优先）
- ✅ 积分体系统一（与现有模块一致）

**关键路径**：
1. 搭建 Python 服务（FastAPI 或 CLI）
2. Node.js 子进程调用 + SSE 流式
3. 前端实时预览 + 日志展示
4. PPTX 导出接口

**预期效果**：
用户输入主题或上传文档 → 2-5 分钟 → 下载原生可编辑 PPTX（每个形状都可修改，非截图）。

---

**下一步行动**：
1. 确认是否采纳此方案（Python 后端 + Node.js 编排）
2. 开始 Phase 1：Prisma Schema + Python 服务搭建
3. 我将逐步实现每个模块并实时验证
