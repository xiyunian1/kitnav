# 🚀 PPT 模块快速启动指�?
## 当前状�?
�?**核心代码已完�?*�?00%�?- Agent 调用封装
- API 路由
- 前端工作�?- 数据库模�?- API 配置集成

🔄 **Python 依赖安装�?*（后台进行）

---

## 3 步启动流�?
### Step 1: 等待 Python 依赖安装完成

检查安装状态：
```bash
python -c "import pptx; print('OK')"
```

如果报错，手动安装：
```bash
cd scripts/ppt-master
python -m pip install -r requirements.txt
```

### Step 2: 配置 Claude API Key

**选项 A**：环境变量（最快）
```bash
# 编辑 .env.local
CLAUDE_API_KEY=replace-with-your-claude-api-key
```

**选项 B**：用户设置（推荐�?1. 启动：`npm run dev`
2. 访问：http://localhost:3000/settings
3. 添加 PPT 生成 API 配置

### Step 3: 数据库迁�?
```bash
npx prisma migrate reset  # 会清空数据，开发环境可�?npx prisma generate
```

---

## 验证环境

运行环境检查脚本：
```bash
node scripts/check-ppt-env.mjs
```

应该看到�?```
�?Python 3.12.10
�?python-pptx
�?lxml
�?Pillow
...
�?环境检查通过�?```

---

## 首次测试

### 1. 启动服务
```bash
npm run dev
```

### 2. 访问 PPT 模块
http://localhost:3000/ppt

### 3. 创建测试项目
- 输入主题：`人工智能简介`
- 目标页数�?（首次测试建议少一点）
- 点击"开始生�?

### 4. 观察进度
浏览器会显示 toast 通知�?- `初始化项目目�?..`
- `Strategist 正在分析内容...`（~30 秒）
- `渲染页面 1/5...`（每�?~15 秒）
- `生成 PPTX 文件...`（~20 秒）
- `PPT 生成完成！`（总计 ~2 分钟�?
### 5. 下载验证
点击下载，在 PowerPoint 中打开，验证：
- �?每个形状可单独选中
- �?文本可编�?- �?颜色可修�?
---

## 常见问题速查

### Q1: Python 依赖安装失败
```bash
# Windows 可能需要管理员权限
python -m pip install --user -r requirements.txt
```

### Q2: 数据库连接失�?```bash
# 检�?PostgreSQL 是否运行
docker ps | grep postgres

# 重启数据�?docker-compose restart postgres
```

### Q3: Claude API 429 错误
- 原因：请求过�?- 解决：等�?1 分钟后重�?- 或：检�?API Key �?tier 限制

### Q4: 生成卡住不动
- 检查浏览器控制台是否有错误
- 查看项目状态：数据�?`PptProject` �?- 查看日志：`PptProject.logs` 字段

---

## 文档索引

- **环境配置详细指南**：`docs/ppt-environment-setup.md`
- **完整实现报告**：`docs/ppt-final-report.md`
- **实施总结**：`docs/ppt-implementation-summary.md`
- **并发分析**：`docs/ppt-concurrency-analysis.md`

---

## 后续工作

### 必须完成
- [ ] 实现 `/api/upload` 接口（文件上传）
- [ ] 调整积分定价（避免亏损）
- [ ] 添加用户文档

### 建议优化
- [ ] 升级�?BullMQ + Redis（生产环境）
- [ ] 实时 SVG 预览
- [ ] 动态模板加�?- [ ] 精确积分计费

---

**准备好后，运�?`node scripts/check-ppt-env.mjs` 开始测试！** 🚀
