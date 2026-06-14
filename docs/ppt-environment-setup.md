# PPT 模块环境配置指南

## 1. Python 环境配置

### 1.1 Python 依赖安装

```bash
cd scripts/ppt-master
python -m pip install -r requirements.txt
```

**主要依赖**：
- `anthropic` - Claude API SDK（不需要，Node.js 已装）
- `python-pptx` - PPTX 生成库
- `lxml` - XML 处理
- `Pillow` - 图片处理
- `pypdf` - PDF 解析
- `python-docx` - Word 文档解析
- `openpyxl` - Excel 解析

### 1.2 验证安装

```bash
python -c "import pptx; print('python-pptx OK')"
python -c "import lxml; print('lxml OK')"
python -c "from PIL import Image; print('Pillow OK')"
```

---

## 2. API 配置

### 方式一：在用户设置中配置（推荐）

1. 启动服务：`npm run dev`
2. 访问：http://localhost:3000/settings
3. 找到 **API 配置** 区域
4. 添加 **PPT 生成** 配置：
   - Base URL: `https://api.anthropic.com`
   - API Key: 你的 Claude API Key（`sk-ant-api03-...`）
   - 模型: `claude-opus-4-20250514`（或其他 Claude 模型）
   - 启用配置

### 方式二：在管理后台配置（平台级）

1. 访问：http://localhost:3000/admin/api-config
2. 添加平台配置（所有用户共享）

### 方式三：环境变量（开发测试）

在 `.env.local` 中添加：

```bash
CLAUDE_API_KEY=replace-with-your-claude-api-key
```

**优先级**：用户配置 > 平台配置 > 环境变量

---

## 3. 数据库迁移

```bash
# 开发环境（会清空数据）
npx prisma migrate reset

# 生产环境
npx prisma migrate deploy

# 生成 Prisma Client
npx prisma generate
```

---

## 4. 启动测试

### 4.1 启动开发服务器

```bash
npm run dev
```

### 4.2 访问 PPT 模块

http://localhost:3000/ppt

### 4.3 创建测试项目

1. 选择 **输入主题**
2. 输入：`人工智能简介`
3. 设置参数：
   - 目标页数：10
   - 画布比例：16:9
   - 模板：不使用模板
4. 点击 **开始生成**

### 4.4 观察生成过程

浏览器控制台会显示 SSE 事件：
- `phase: STRATEGIZING` - Strategist 规划中（~30-60 秒）
- `phase: EXECUTING` - Executor 生成 SVG（10 页 × ~15-20 秒）
- `phase: EXPORTING` - 导出 PPTX（~20 秒）
- `complete` - 完成

**总耗时**：约 3-5 分钟（取决于页数和 API 响应速度）

### 4.5 下载 PPTX

生成完成后，点击 **下载** 按钮，在 PowerPoint 中验证：
- ✅ 每个元素可单独选中
- ✅ 文本可编辑
- ✅ 颜色可修改
- ✅ 非截图/图片

---

## 5. 常见问题

### Q1: `ModuleNotFoundError: No module named 'xxx'`

**原因**：Python 依赖未安装

**解决**：
```bash
cd scripts/ppt-master
python -m pip install -r requirements.txt
```

### Q2: `未配置 Claude API Key`

**原因**：三种方式都未配置 API Key

**解决**：
1. 在 http://localhost:3000/settings 配置用户 API
2. 或在 `.env.local` 添加 `CLAUDE_API_KEY=...`

### Q3: 生成失败，提示 `429 rate limit`

**原因**：Claude API 请求过快

**解决**：
- 当前最多 3 个并发
- 每用户限制 1 个进行中项目
- 如需更高并发，需升级到 BullMQ 队列

### Q4: 积分被扣但生成失败

**原因**：生成过程中断或错误

**解决**：积分会自动退款（见数据库 `CreditTransaction`，type=REFUND）

### Q5: 生成的 PPTX 打不开

**原因**：SVG 转换失败或文件损坏

**解决**：
1. 检查 Python 依赖是否完整
2. 查看项目日志：`PptProject.logs` 字段
3. 手动运行：
   ```bash
   cd public/projects/<project-id>
   python ../../scripts/ppt-master/scripts/svg_to_pptx.py .
   ```

### Q6: 生成很慢（>10 分钟）

**原因**：页数过多或 Claude API 响应慢

**解决**：
- 减少页数（建议 5-15 页）
- 检查 API Key 是否被限流
- 查看 Claude API 状态：https://status.anthropic.com/

---

## 6. 监控与调试

### 6.1 查看项目状态

数据库表：`PptProject`

```sql
SELECT id, title, status, progress, error, logs
FROM "PptProject"
WHERE "userId" = 'your-user-id'
ORDER BY "createdAt" DESC
LIMIT 10;
```

### 6.2 查看积分流水

```sql
SELECT * FROM "CreditTransaction"
WHERE "userId" = 'your-user-id'
  AND description LIKE '%PPT%'
ORDER BY "createdAt" DESC;
```

### 6.3 调试 Python 脚本

```bash
# 测试 PDF 转 Markdown
cd scripts/ppt-master/scripts
python source_to_md/pdf_to_md.py /path/to/test.pdf

# 测试 SVG → PPTX
cd public/projects/<project-id>
python ../../scripts/ppt-master/scripts/svg_to_pptx.py .
```

### 6.4 查看 Claude API 调用日志

在 `orchestrator.ts` 中添加 console.log：

```typescript
const response = await client.messages.create({
  model,
  max_tokens: MAX_TOKENS,
  // ...
});
console.log(`[Claude API] ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
```

---

## 7. 成本估算

### 单个项目（10 页 PPT）

| 阶段 | 调用次数 | Tokens/次 | 成本 |
|------|---------|----------|------|
| Strategist | 1 | ~10k | $0.10 |
| Executor | 10 | ~5k | $0.50 |
| **总计** | 11 | ~60k | **$0.60** |

### 积分消耗

- **预设**：10 积分/页
- **10 页**：100 积分
- **实际成本**：$0.60

**利润率**：假设 1 积分 = $0.01，则 100 积分 = $1.00，毛利 $0.40（40%）

### 并发限制下成本

- **3 个并发**：$1.80/分钟 = **$108/小时**
- **每天生成 100 个项目**：$60

---

## 8. 生产部署清单

- [ ] Python 依赖已安装
- [ ] 数据库已迁移
- [ ] 平台 Claude API Key 已配置
- [ ] `public/projects/` 目录已创建且可写
- [ ] 并发限制已启用（信号量）
- [ ] 监控已配置（积分消耗、错误率）
- [ ] 成本告警已设置（如 $100/天）
- [ ] 备份策略已制定（数据库 + 项目文件）
- [ ] 用户文档已发布

---

## 9. 后续优化方向

### 短期（1-2 周）
- [ ] 升级到 BullMQ + Redis（队列持久化）
- [ ] 实时 SVG 预览（WebSocket 流式）
- [ ] 精确计费（按实际生成页数）
- [ ] 模板市场（动态读取 templates/）

### 中期（1 个月）
- [ ] 批量生成（多文档 → 多 PPT）
- [ ] 协作编辑（多人共享项目）
- [ ] 动画支持（ppt-master 已有 animations.json）
- [ ] 语音旁白（TTS 集成）

### 长期（3 个月）
- [ ] 在线演示（WebRTC + SVG）
- [ ] AI 图片生成集成（DALL-E 3 / Midjourney）
- [ ] 自定义模板编辑器
- [ ] PPT 质量评分系统

---

**配置完成后，请重启服务并访问 http://localhost:3000/ppt 开始测试！**
