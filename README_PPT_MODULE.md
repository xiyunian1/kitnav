# PPT 模块

## 当前架构

1. Web API 校验来源、模型、积分和用户并发限制，将项目写入 PostgreSQL 队列。
2. 独立 `ppt-worker` 使用 `FOR UPDATE SKIP LOCKED` 抢占任务。
3. Worker 调用受限 Pi Agent 和固定版本 PPT Master 工具链。
4. 生成阶段持续写入数据库心跳、当前步骤和受限长度日志。
5. 浏览器轮询项目状态；浏览器断开不影响后台任务。
6. 成功后通过鉴权文件接口预览 SVG、下载可编辑 PPTX。

Worker 重启会重新排队活跃项目。心跳超时任务会自动失败并幂等退款。Agent API Key 只通过子进程环境传递，不写入项目文件。

## 工作流

- 未上传模板：使用官方 `svg` 主流程，由 Strategist 确定叙事、视觉风格和页面计划，再生成 SVG 并转换为 PPTX。
- 上传原生 PPTX 模板：使用 `template-fill` 流程，直接选择和填充模板页面，不应用站内风格覆盖模板。
- 可选图片模型：启用后由图片模型生成或补充视觉素材；未选择时不调用图片模型。
- 视觉复核：启用后渲染每页 PNG，Agent 必须实际读取后才能完成复核。

下载的 PPTX 是最终编辑入口。站内在线元素编辑器及相关重新导出 API 已移除。

## 用户参数

- 页数、比例
- 文字量、面向对象、语气
- 文本模型与来源
- 推理强度：`low`、`medium`、`high`、`xhigh`
- 图片模型与来源、图片数量上限
- 是否视觉复核
- 上传来源文档和可选 PPTX 模板

## 本地运行

```bash
npm run dev
npm run ppt-worker:dev
```

Python 3.10+ 环境应使用 `pip install --require-hashes -r scripts/ppt-requirements.lock`。生产镜像按同一锁文件安装；修改上游 `requirements.txt` 版本后运行 `npm run ppt-requirements:lock` 更新外部锁文件。

## 验证

```bash
npm run ppt-master:verify
npm run ppt-agent:check-tools
npm run ppt-worker:build
PPT_PYTHON_CMD=python3 npm run ppt-quality:check
```

`ppt-master:verify` 校验供应方仓库、提交和完整目录树哈希。托管定制必须放在 `src/lib/ppt-agent` 或独立扩展脚本，不得直接修改固定上游目录。
