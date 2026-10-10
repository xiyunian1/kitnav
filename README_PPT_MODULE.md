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

## 运行观测

每次调用 Pi（规划、确认后规划、图片规划、逐页生成、图表校准、视觉复核）结束时，Worker 写入一条 `PptAgentRun`：
阶段、续跑次数、结束状态（完成 / 退出后恢复 / 超时 / 无进展终止 / 取消 / 出错）、模型回合数、工具调用数、
输入 / 输出 / 缓存命中 token、费用和耗时。用量取自 Pi `--mode json` 事件流中已完成回复（`message_end` / `turn_end`）的 `usage`，
按回复去重，流式中间事件和 `agent_end` 不重复计入。

- 管理后台「PPT 记录详情」展示单个项目的分阶段汇总和逐次调用明细。
- 「数据看板」展示近 30 天的成功率、成功项目平均生成时长、单个项目平均 token 与费用、超时或无进展终止次数，以及各阶段的耗时和费用占比。
- 费用单价通过 `PPT_PI_MODEL_PRICING` 配置（元/百万 token），写入临时 `models.json` 后由 Pi 按实际用量计算。
- 服务商未在流式响应中返回用量时，记录会标记为"未上报"并在后台提示；需要 `stream_options.include_usage` 的服务商设置 `PPT_PI_SUPPORTS_USAGE_IN_STREAMING=true`。
- 写入运行记录失败只记日志，不影响生成流程。

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
