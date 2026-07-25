# 片策项目蓝图

最后审计日期：2026-07-09

本文档记录当前仓库的真实架构、功能状态、数据流、配置方式和后续计划。它用于后续开发接手，不作为营销说明。

## 1. 项目定位

片策是一个本地化短视频前期策划工作台，面向短视频创作者。用户输入一个选题和内容画像后，系统调用大模型生成完整前期策划包，并把 Markdown 文档保存到本机。

当前项目同时包含：

- Next.js Web 工作台：主要使用入口。
- Node.js CLI：保留 `generate`、`refine`、`scan` 三个命令。
- 本地文件系统存储：项目、配置、创作者资料、回收站都保存在本机。

项目不包含登录、数据库、云同步或远程团队协作能力。

## 2. 当前核心能力

已实现：

- 创建内容项目。
- 默认生成 10 份 Markdown 文档。
- 首页文档预览。
- 项目详情页文档预览。
- 单文档修改 `refine`，修改版另存，不覆盖原文。
- 当前 Markdown 导出、复制，以及项目详情页整包 Markdown 合并导出。
- 历史项目列表。
- 历史项目删除：移动到本机 `.piance/trash/`，不是永久删除。
- 素材扫描：递归读取本地文件元数据，写入 `00_素材索引.md`。
- 本地工作区配置：可调整输出目录。
- 创作者资料配置：昵称和头像保存在本机。
- 大模型 API 配置：支持 UI 配置模型服务。
- 生成进度弹窗：按 10 份文档展示状态、计时器和等待提示。
- 撤销生成：前端 abort + 服务端 job cancel。
- 临时目录清理：失败、撤销或未发布时清理 `output/.tmp/<jobId>/`。
- 生成耗时 metadata：新项目可写入 `generationStartedAt`、`generationFinishedAt`、`generationDurationMs`、`generationDurationLabel`。

部分实现或保留状态：

- 封面图片生成：项目详情页在视觉提示词文档下可调用图片 API，图片 API 仍走 `.env`，不走新的模型配置面板。
- 模板系统：左侧有「我的模板」占位，但未接入真实模板能力。
- 使用指南：左侧有占位，但未整理成正式页面。
- 素材扫描入口：左侧显示「素材扫描」但禁用，实际在项目详情页工具面板内使用。

## 3. 默认 10 份文档

默认文档定义位于 `src/utils/documentDefinitions.ts`。

生成目标文件：

1. `01_项目概览.md`
2. `02_选题拆解.md`
3. `03_口播脚本.md`
4. `04_分镜与剪辑节奏.md`
5. `05_拍摄清单.md`
6. `06_封面标题与发布文案.md`
7. `07_视觉参考提示词.md`
8. `08_内容质检报告.md`
9. `09_成片执行稿.md`
10. `10_发布承接话术.md`

当前生成策略：

- 第一阶段生成 01-08 核心文档。
- 第二阶段基于核心文档生成 09-10 增强执行包。
- UI 对用户展示为 10 份文档进度，不展示内部的“核心/增强”技术分段。

兼容状态：

- 代码仍保留旧版 6 文档文件名兼容逻辑。
- 当前 `output/` 中存在旧项目或不完整项目，部分只有 8 份文档，没有 09/10。

## 4. 本地目录与配置

默认目录：

- `output/`：默认项目输出目录。
- `output/<项目名>/`：正式项目目录。
- `output/.tmp/<jobId>/`：生成临时目录。完成后移动为正式项目目录；失败或撤销时清理。
- `.piance/workspace.json`：本地工作区配置，主要记录输出目录。
- `.piance/profile.json`：创作者资料。
- `.piance/profile/avatar.*`：创作者头像。
- `.piance/model-config.json`：大模型配置。
- `.piance/trash/`：删除项目回收目录。

安全规则：

- API Key 只允许本地保存。
- API Key 不写入 Markdown。
- API Key 不写入 `project.json`。
- API Key 不应打印到日志。
- `.piance/model-config.json` 已加入 `.gitignore`。
- `/api/model-config` 的 GET 响应只返回 `maskedApiKey`，不返回明文。

工作区输出目录读取顺序：

1. `.piance/workspace.json`
2. `PIANCE_OUTPUT_DIR`
3. 默认 `output/`

## 5. 大模型配置逻辑

统一模型客户端位于 `src/services/modelClient.ts`。所有文本模型调用应走：

- `loadModelConfig()`
- `createModelClient()`
- `callChatModel()`
- `callModel()`
- `testModelConnection()`

支持的服务商：

- DeepSeek
- OpenAI
- Anthropic Claude
- Google Gemini
- Moonshot / Kimi
- Qwen / 通义千问
- OpenRouter
- 自定义 OpenAI Compatible

配置字段：

- `provider`
- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `maxTokens`

读取优先级：

1. `.piance/model-config.json`
2. `.env`
3. 默认配置

`.env` 兼容：

- 通用变量：`MODEL_PROVIDER`、`MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_MODEL`、`MODEL_TEMPERATURE`、`MODEL_MAX_TOKENS`
- DeepSeek 旧变量：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`

调用适配：

- DeepSeek、OpenAI、Kimi、Qwen、OpenRouter、自定义 OpenAI Compatible 使用 OpenAI Chat Completions 格式：`POST {baseURL}/chat/completions`。
- Anthropic 使用 `/messages`。
- Gemini 使用 `models/{model}:generateContent`。

Web API：

- `GET /api/model-config`：返回公开配置、provider 列表，不返回明文 API Key。
- `POST /api/model-config`：保存或恢复配置。
- `POST /api/model-config/test`：发送极短请求测试连接。
- `GET /api/config`：首页读取当前模型展示名，内部也走统一模型配置。

错误策略：

- 模型接口返回非 JSON 时，模型客户端会先读 text、检查 `content-type`，再转换成 `ModelClientError`。
- 面向用户的模型配置错误统一收敛为“模型连接失败，请检查 API Key、Base URL 或模型名称。”。
- 不应把 endpoint 查询里的 Gemini key 或 Authorization header 打印到日志。

## 6. 生成流程

入口：

- Web：首页 `GenerateWorkspace` 调用 `POST /api/generate`。
- CLI：`npm run generate` 调用 `src/commands/generate.ts`。

用户填写字段：

- 项目名称
- 选题主题
- 内容主体
- 内容领域
- 发布平台
- 内容风格
- 目标用户
- 补充要求

Web 生成流程：

1. 用户点击「创建内容项目」。
2. 前端创建 `jobId`，记录 `startTime`，打开生成进度弹窗。
3. 前端 `POST /api/generate`，同时每 900ms 轮询 `GET /api/generate?jobId=...`。
4. API route 创建服务端 job，并把 `AbortController`、进度、耗时、临时目录记录在内存 Map。
5. `generateProject()` 创建 `output/.tmp/<jobId>/`。
6. 构造核心 prompt，调用模型生成 01-08。
7. 解析模型 JSON；失败时构造 repair prompt 再试一次。
8. 基于核心文档生成 09/10。
9. 09/10 生成或解析失败时使用 fallback 模板，状态显示「使用备用模板」，整体仍可完成。
10. 写入 10 份 Markdown 和 `project.json` 到临时目录。
11. 完成后把临时目录 rename 到正式项目目录。
12. 前端校准最终文件列表，展示生成完成和耗时。

撤销流程：

1. 前端调用 `DELETE /api/generate?jobId=...`。
2. 前端 abort 当前 POST 请求。
3. 服务端 job 标记 `cancelled`，abort 模型请求。
4. 如果已有临时目录，调用 `removeTempProjectDirectory()` 清理。
5. 前端回到表单，并保留用户已填写内容。

失败流程：

- `/api/generate` 已统一 JSON 返回，包含 `ok: false`、`success: false`、`error`、`stage`、`job`。
- stage 类型为 `generate`、`model`、`parse`、`write`。
- 如果失败发生在正式发布前，临时目录会在 `finally` 中尝试清理。

## 7. UI 信息架构

左侧 Sidebar：

- 品牌区：片策。
- 创建内容项目。
- 项目工作台。
- 历史项目。
- 素材扫描：显示但禁用，项目内使用。
- 我的模板：显示但禁用，待接入。
- 使用指南：显示但禁用，待整理。
- 设置中心：打开模型配置弹窗。
- Agent 助手说明卡片。
- 本地工作区：当前项目、项目数、占用空间、输出目录、刷新、修改目录。

中间 Workspace：

- 项目标题区：当前页面/项目标题和操作按钮。
- 流程条：选题输入、策划拆解、策划包生成、修改优化、导出。
- 内容模块区：紧凑文档导航，支持画布视图和列表视图。
- 文档预览区：当前文档 Markdown 阅读区域，是主阅读区。
- 空状态：未生成时显示 10 个待生成模块。

右侧 Agent 控制台：

- 模型状态：显示当前模型，点击打开模型配置。
- 当前任务：显示生成中或当前项目可打开。
- 可用功能：只展示真实能力，如生成、refine、素材扫描、导出。
- 本次会话记录：展示当前会话真实状态。
- 本地文档计数。

顶部：

- 当前内容项目状态。
- 创作者资料入口：昵称、头像，本地保存。
- 移动端菜单入口。

项目详情页：

- 左侧 `ProjectSidebar`：文档列表和 metadata。
- 中间 `DocumentWorkspace`：Markdown 预览、复制、导出。
- 右侧 `AgentToolsPanel`：refine、素材扫描、封面生成和导出能力。

## 8. 设计原则

- 不做假功能。
- 不展示虚假算力、虚假队列、虚假容量。
- 功能文案必须对应真实能力。
- 卡片只做导航，文档预览才是主角。
- 暗色、简洁、可读、克制。
- 移动端不能只是桌面压缩版，应优先保证表单、导航和文档阅读可用。
- 错误提示给用户看可执行信息；调试信息不能暴露 API Key。
- 生成进度条必须跟随真实 `completedCount / totalCount`，不要假进度。
- 输出文件和本地配置优先可恢复、可检查、可人工编辑。

## 9. 已知问题 / 待修复

根据 2026-07-09 代码审计记录：

1. README 已滞后。
   - README 仍写“8 份文档”和“DeepSeek API”，与当前 10 文档、多 provider 模型配置不一致。

2. 10 文档默认生成已实现，但历史项目不全。
   - `src/utils/documentDefinitions.ts` 默认定义为 10 份。
   - 当前 `output/` 中仍存在只有 8 份文档的旧项目或不完整项目，例如缺少 09/10 的历史目录。

3. 09/10 有 fallback，质量需要继续观察。
   - 09/10 模型生成或解析失败时会用 `buildFallbackExecutionPackage()`。
   - fallback 可以保证项目完成，但内容质量低于模型正常输出。

4. 生成速度慢的主要原因是顺序模型请求。
   - 当前至少包含 01-08 核心生成、可能的 JSON repair、09/10 增强生成。
   - 模型响应、解析校验和二次修复都会增加耗时。

5. 进度是轮询，不是实时推送。
   - 前端每 900ms 轮询 `GET /api/generate?jobId=...`。
   - 当前没有 SSE/WebSocket；长时间生成时会有较多短轮询请求。

6. API JSON 返回尚未全局统一。
   - `/api/generate` 已有 `ok/success/error/stage/job` 结构。
   - `/api/model-config` 也有 `ok/success`。
   - `/api/refine`、`/api/scan`、`/api/cover`、`/api/projects`、`/api/workspace`、`/api/profile` 返回 JSON，但结构不完全统一，缺少统一 `stage`。

7. 前端 JSON 解析安全不一致。
   - 首页生成链路使用 `readJsonResponse()`，会先读 text 并检查 content-type。
   - 部分组件仍直接 `response.json()`，例如项目详情、项目列表、侧栏工作区等。

8. 文档预览区已经优化，但仍需真实设备复核。
   - 首页卡片已改为紧凑文档导航。
   - CSS 多轮叠加后存在大量覆盖规则，后续维护成本较高。

9. 移动端适配有规则，但不是完整产品级验收。
   - Sidebar、模块导航、弹窗有移动端样式。
   - 仍需在真实手机宽度下检查生成弹窗、模型配置、文档预览和项目详情三栏布局。

10. 模型配置测试覆盖不足。
    - DeepSeek/env 路径已验证过。
    - OpenAI Compatible、Anthropic、Gemini、Qwen、Kimi、OpenRouter 需要用真实服务分别验证。

11. Job 状态只在进程内存中。
    - `/api/generate` 的 jobs Map 不持久化。
    - 服务重启后无法恢复进行中的生成任务。

12. 删除项目是移动到 `.piance/trash/`，但缺少回收站 UI。
    - 已有删除确认和移动逻辑。
    - 暂无恢复、清空回收站或查看回收站页面。

13. 素材扫描只读取文件元数据。
    - 不识别视频画面、图片内容、音频内容。
    - 不做素材与文档内容的智能匹配。

14. 图片生成配置仍独立。
    - 封面图片 API 使用 `IMAGE_*` 环境变量。
    - 未纳入模型配置 UI。

## 10. 下一步优先级

P0：稳定性与安全

- 继续验证生成稳定性，尤其是模型非 JSON、HTML 错误页、网络超时、Abort 竞态。
- 全链路确认 API Key 不进入日志、Markdown、`project.json`、前端明文。
- 统一 API 错误 JSON 结构，至少补齐核心 route 的 `ok/error/stage`。
- 强化临时目录清理和异常情况下的残留扫描。

P1：生成质量与进度体验

- 提升 09/10 正常生成成功率，减少 fallback 触发。
- 继续校准 10 文档默认生成后的最终文件数量和状态显示。
- 将轮询进度升级为 SSE，减少无效请求并更及时显示状态。
- 优化撤销生成的竞态处理和用户提示。
- 为核心解析、repair、fallback 增加自动化测试样例。

P2：产品界面与项目管理

- 清理全局 CSS 多轮覆盖，降低布局回归风险。
- 做移动端真实设备验收：生成弹窗、模型配置、文档预览、项目详情。
- 完善历史项目删除后的回收站 UI：恢复、清空、查看位置。
- 扩展模型配置测试状态：记录最近测试时间、失败原因、当前来源。
- 更新 README，使其与 10 文档和模型配置现状一致。

P3：扩展能力

- 模板系统：允许用户配置文档结构、平台风格和固定语气。
- 账号记忆：保存创作者偏好、内容领域、平台策略，但仍保持本地优先。
- 素材智能匹配：从素材元数据进一步发展到图片/视频内容理解。
- 版本对比：对 refine 生成的修改版提供差异比较和版本树。
- 更多导出格式：PDF、DOCX、压缩包等。

## 11. 关键文件索引

核心服务：

- `src/services/contentWorkflow.ts`：生成、增强、refine、素材扫描、封面生成编排。
- `src/services/modelClient.ts`：统一文本模型配置和调用。
- `src/services/projectManager.ts`：项目目录、临时目录、回收站。
- `src/services/projectReader.ts`：历史项目和项目详情读取。
- `src/services/workspaceConfig.ts`：本地工作区配置。
- `src/services/profileConfig.ts`：创作者资料。
- `src/services/assetScanner.ts`：素材扫描。
- `src/services/imageClient.ts`：封面图片生成。

Prompt 与解析：

- `src/prompts/generatePrompt.ts`：01-08 核心文档 prompt、解析、校验、repair prompt。
- `src/prompts/enhancePrompt.ts`：09/10 增强执行包 prompt、fallback。
- `src/prompts/refinePrompt.ts`：单文档修改 prompt、repair。
- `src/utils/modelJson.ts`：模型 JSON 清理、HTML 检测、首个合法 JSON object 提取。
- `src/utils/documentDefinitions.ts`：默认文档定义和旧文件名兼容。

Web 页面与组件：

- `web/app/page.tsx`：首页。
- `web/app/projects/page.tsx`：历史项目。
- `web/app/projects/[slug]/page.tsx`：项目详情。
- `web/components/GenerateWorkspace.tsx`：首页生成状态和请求。
- `web/components/NewTaskDrawer.tsx`：创建项目表单。
- `web/components/GenerationProgressModal.tsx`：生成进度弹窗。
- `web/components/ResultTabs.tsx`：首页模块导航和预览。
- `web/components/ContentModuleCard.tsx`：紧凑模块卡片。
- `web/components/MarkdownPreview.tsx`：Markdown 渲染。
- `web/components/ProjectDetailView.tsx`：项目详情业务交互。
- `web/components/AgentToolsPanel.tsx`：refine、scan、cover、export 工具。
- `web/components/AppSidebar.tsx`：侧栏和工作区配置入口。
- `web/components/TopBar.tsx`：当前项目状态和创作者资料。
- `web/components/HomeAgentConsole.tsx`：右侧控制台和模型配置入口。
- `web/components/ModelConfigModal.tsx`：模型配置 UI。

API Routes：

- `web/app/api/generate/route.ts`
- `web/app/api/refine/route.ts`
- `web/app/api/scan/route.ts`
- `web/app/api/cover/route.ts`
- `web/app/api/projects/route.ts`
- `web/app/api/projects/[slug]/route.ts`
- `web/app/api/projects/[slug]/covers/[filename]/route.ts`
- `web/app/api/workspace/route.ts`
- `web/app/api/profile/route.ts`
- `web/app/api/profile/avatar/route.ts`
- `web/app/api/model-config/route.ts`
- `web/app/api/model-config/test/route.ts`
- `web/app/api/config/route.ts`

CLI：

- `src/index.ts`
- `src/commands/generate.ts`
- `src/commands/refine.ts`
- `src/commands/scan.ts`
