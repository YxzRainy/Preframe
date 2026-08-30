# Preframe / 片策 — 完整产品与架构审计报告

> 历史说明：本文记录当时的产品状态。发布中心及其账号、任务、会话、自动上传代码已于 2026-08-29 永久移除；当前实现以 `PROJECT_CONTEXT.md` 和 `docs/PROJECT_BLUEPRINT.md` 为准。


> **审计日期**：2026-08-04
> **审计范围**：`/Users/YxzRainy/Documents/Vibecoding/Preframe` 全量代码（前端页面、组件、API 路由、服务层、Prompt/模型调用、数据模型、存储、CLI、配置）
> **审计方式**：只读分析，未修改任何业务代码、样式或配置
> **版本**：piance@0.1.0（git 最新提交 `20d8e1e feat(P2-Phase2): shot execution workspace MVP`）

---

## 目录

1. [执行摘要](#一执行摘要)
2. [产品定位](#二产品定位)
3. [功能清单与可用性矩阵](#三功能清单与可用性矩阵)
4. [页面导航地图](#四页面导航地图)
5. [系统架构](#五系统架构分层)
6. [核心数据流](#六核心数据流)
7. [数据模型与存储](#七数据模型与存储)
8. [Prompt 与模型调用](#八prompt-与模型调用)
9. [CLI 层](#九cli-层)
10. [测试覆盖](#十测试覆盖)
11. [风险与问题定级](#十一风险与问题定级)
12. [商业化基础评估](#十二商业化基础评估)
13. [下一步开发方向建议](#十三下一步开发方向建议)

---

## 一、执行摘要

Preframe（片策）是一个面向短视频创作者的 **AI 前期策划工作台**，核心能力是从一个选题出发，自动生成包含 10 份结构化文档的完整策划包（项目概览 → 选题拆解 → 口播脚本 → 分镜 → 拍摄清单 → 封面文案 → 视觉提示词 → 质检报告 → 成片执行稿 → 发布承接话术），并提供灵感收集、项目库管理、镜头任务追踪、文档修改、工作台仪表盘等配套功能。

### 整体评价

| 维度 | 评级 | 说明 |
|---|---|---|
| 核心业务闭环 | ✅ 可用 | 「灵感 → 创建项目 → 生成 10 文档 → 修改 → 镜头任务 → 发布」主链路完整且可运行 |
| 架构分层 | ⚠️ 良好但有遗留 | CLI/服务/Prompt/API/前端五层职责清晰，但存在约 500+ 行双轨生成路径死代码 |
| 数据层 | ⚠️ 基本可用 | 文件系统存储设计合理，但存在字段演进残留、缓存不同步、workspace.json 静默失效 |
| 测试覆盖 | ❌ 严重不足 | 仅 1 个正式测试文件（8 用例），核心生成/解析/CLI 流程零覆盖 |
| 安全 | ⚠️ 本地可用 | .gitignore 正确忽略敏感文件，但 API Key 本地明文存储，无加密 |
| 商业化基础 | ⚠️ 早期 | 核心功能可跑通，但缺少多用户隔离、配额管控、监控告警等生产级基础设施 |

### 关键问题 Top 5

1. **[高] `Idea.convertedProjectSlug` 字段读取但从不写入** — `markIdeaConverted()` 是死代码，"已转项目"徽章永远不出现
2. **[高] 09/10 文档 `requiredSections` 字段名不一致** — `documentDefinitions.ts` 与 `generatePrompt.ts` 校验规则冲突，可能导致文档校验误判
3. **[高] workspace.json 字段名与接口不匹配** — 用户配置的外部输出目录被静默忽略
4. **[高] 约 500+ 行死代码** — 旧版"一次性 8 字段"生成路径已被取代但未删除，严重干扰维护
5. **[中] ShotTask 缓存与文档重新生成不同步** — `regenerate` 后镜头任务不自动刷新，阶段推断基于过时数据

---

## 二、产品定位

### 一句话定位
> 帮短视频创作者用 AI 把「灵感」变成「可直接拍摄的完整策划包」的本地工作台。

### 目标用户
- 个人短视频创作者 / 自媒体博主
- 需要系统化策划流程但缺乏专业编导能力的内容生产者
- 希望降低前期策划门槛、提升内容质量的创作者

### 核心价值主张
1. **从选题到拍摄一站完成**：10 份文档覆盖从选题分析到发布承接的全流程
2. **本地优先，数据自主**：所有项目数据存储在本地文件系统，不依赖云端
3. **多模型兼容**：支持 DeepSeek/OpenAI/Anthropic/Gemini/Moonshot/Qwen/OpenRouter 等 8 种模型提供商
4. **结构化输出**：每份文档有明确的二级标题规范和质检规则，非自由文本

### 技术定位
- **非**：SaaS 多租户平台（当前无用户隔离）
- **非**：内容发布工具（不直接发布到平台）
- **非**：视频剪辑工具（只做前期策划）
- **是**：创作者本地生产力工具 + AI 增强工作台

---

## 三、功能清单与可用性矩阵

### 3.1 核心功能

| 功能模块 | 可用性 | 涉及页面/API | 说明 |
|---|---|---|---|
| 项目生成（10 文档） | ✅ 可用 | `/create` → `POST /api/generate` | 并发生成 8 核心 + 串行 2 执行文档，含 3 阶段修复 |
| 项目库管理 | ✅ 可用 | `/projects` → `GET /api/projects` | 列表/详情/删除/回收站 |
| 文档修改（refine） | ✅ 可用 | 项目详情 → `POST /api/refine` | 生成 `_修改版.md`，不覆盖原文件 |
| 文档重新生成 | ✅ 可用 | 项目详情 → `POST /api/projects/[slug]/regenerate` | 支持指定文档重生成 |
| 灵感收件箱 | ⚠️ 部分可用 | `/ideas` → `/api/ideas` | 可创建/编辑/删除，但"转项目"徽章失效（字段不写入） |
| 今日待办 | ✅ 可用 | `/tasks` → `/api/tasks` | CRUD 完整，支持优先级/截止日/项目关联 |
| 镜头任务追踪 | ⚠️ 部分可用 | 项目详情 → `/api/projects/[slug]/shots` | 可构建/更新，但文档重生成后不自动刷新 |
| 项目阶段管理 | ✅ 可用 | `POST /api/projects/[slug]/stage` | 6 阶段流转：drafting→planning→shooting→editing→published→archived |
| 发布数据记录 | ✅ 可用 | `POST /api/projects/[slug]/publish` | 录入 publishedAt 自动推进到 published 阶段 |
| 工作台仪表盘 | ✅ 可用 | `/` → `GET /api/dashboard` | 今日推进/内容管线/项目概览/待办 |
| 封面生成 | ✅ 可用 | `POST /api/cover` | 基于视觉提示词生成封面图 |

### 3.2 配置功能

| 功能模块 | 可用性 | 涉及页面/API | 说明 |
|---|---|---|---|
| 模型配置 | ✅ 可用 | 设置中心 → `/api/model-config` | 8 种 provider，含连接测试 |
| 工作区目录配置 | ⚠️ 有 Bug | 设置中心 → `/api/workspace` | workspace.json 字段名不匹配，外部目录静默失效 |
| 创作者资料 | ✅ 可用 | 设置中心 → `/api/profile` | 昵称 + 头像（10MB 限制，防路径穿越） |
| 账号记忆 | ⚠️ 未启用 | 设置中心 → `/api/account-memory` | 服务实现完整，但配置文件从未创建 |
| 主题切换 | ✅ 可用 | 顶栏/侧栏 | localStorage 持久化，防闪烁 |
| 天气/时钟 | ✅ 可用 | 顶栏 MoodCompact → `/api/weather` | 点击展开详情 |

### 3.3 CLI 功能

| 命令 | 可用性 | 说明 |
|---|---|---|
| `piance generate` | ✅ 可用 | inquirer 交互式生成，共用 `generateProject` 核心 |
| `piance refine` | ⚠️ 退化版 | 重复实现，无 repair 重试、无防覆盖序号 |
| `piance scan` | ⚠️ 重复实现 | 重复实现 `scanProjectAssets` 逻辑 |
| `piance --version` | ✅ 可用 | 0.1.0 |

### 3.4 死代码/无价值模块

| 模块 | 位置 | 状态 | 建议 |
|---|---|---|---|
| `parseCoreContent` + `generateExecutionPackage` + `writeCompleteProject` | [contentWorkflow.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/contentWorkflow.ts) ~299-461 | 死代码，约 200 行 | 删除 |
| `enhancePrompt.ts` 主体 | [enhancePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/enhancePrompt.ts) | 死代码，除 2 个辅助函数外无调用 | 删除主体，保留辅助函数 |
| `buildGeneratePrompt` + `parseGeneratedContent` 等 | [generatePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/generatePrompt.ts) ~81-161, 444-486 | 死代码，旧版 8 字段路径 | 删除 |
| `markIdeaConverted` | [ideaManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/ideaManager.ts) ~96 | 死代码，从未被调用 | 修复调用链或删除 |
| 前端 8 个死代码组件 | 见前端审计 | 未被任何页面引用 | 删除 |

---

## 四、页面导航地图

### 4.1 页面路由（6 个）

```
/                        → 工作台首页（仪表盘）
/create                  → 创建项目
/ideas                   → 灵感收件箱
/projects                → 项目库
/projects/[slug]         → 项目详情（文档浏览/修改/镜头任务/阶段管理）
/tasks                   → 今日待办
```

### 4.2 导航结构

```
AppSidebar（左侧常驻）
├── 工作台          → /
├── 项目库          → /projects
├── 灵感            → /ideas
├── 待办            → /tasks
├── 本地工作区卡片   → 显示项目数/占用空间/输出目录
└── 设置中心入口     → 弹出设置面板

TopBar（顶部）
├── MoodCompact（时钟/天气，点击展开）
└── 主题切换

设置中心（宽面板）
├── 模型配置
├── 工作区
├── 创作者资料
├── 账号记忆
└── 主题
```

### 4.3 API 路由（27 个）

| 分组 | 路由 | 方法 | 功能 |
|---|---|---|---|
| **项目生成** | `/api/generate` | POST/GET/DELETE | 生成项目/查询进度/取消 |
| | `/api/refine` | POST | 修改文档 |
| | `/api/scan` | POST | 扫描素材 |
| | `/api/cover` | POST | 生成封面 |
| **项目管理** | `/api/projects` | GET | 项目列表 |
| | `/api/projects/[slug]` | GET/DELETE | 项目详情/删除 |
| | `/api/projects/[slug]/regenerate` | POST | 重新生成文档 |
| | `/api/projects/[slug]/shots` | GET/POST/PATCH | 镜头任务 |
| | `/api/projects/[slug]/stage` | GET/PATCH | 阶段管理 |
| | `/api/projects/[slug]/publish` | POST | 发布数据 |
| | `/api/projects/[slug]/covers/[filename]` | GET | 封面文件 |
| **仪表盘** | `/api/dashboard` | GET | 工作台汇总 |
| **灵感** | `/api/ideas` | GET/POST | 列表/创建 |
| | `/api/ideas/[id]` | PATCH/DELETE | 编辑/删除 |
| **待办** | `/api/tasks` | GET/POST | 列表/创建 |
| | `/api/tasks/[id]` | PATCH/DELETE | 编辑/删除 |
| **配置** | `/api/model-config` | GET/POST/DELETE | 模型配置 |
| | `/api/model-config/test` | POST | 连接测试 |
| | `/api/workspace` | GET/POST | 工作区配置 |
| | `/api/workspace/pick` | POST | 选择目录 |
| | `/api/profile` | GET/POST | 创作者资料 |
| | `/api/profile/avatar` | GET | 头像 |
| | `/api/account-memory` | GET/POST | 账号记忆 |
| | `/api/config` | GET | 前端配置 |
| | `/api/weather` | GET | 天气查询 |

---

## 五、系统架构（分层）

### 5.1 分层架构图

```
┌─────────────────────────────────────────────────────────┐
│                    UI 页面层（web/app）                    │
│   6 个页面路由 + layout.tsx + globals.css                │
├─────────────────────────────────────────────────────────┤
│                  React 组件层（web/components）            │
│   AppSidebar / TopBar / GenerateWorkspace / Dashboard*   │
│   ProjectList / IdeaInbox / TaskList / Settings*         │
├─────────────────────────────────────────────────────────┤
│              前端状态与请求层（web/lib, web/hooks）         │
│   fetch 封装 / 主题管理 / Supabase 客户端                  │
├─────────────────────────────────────────────────────────┤
│                Next.js API 层（web/app/api）              │
│   27 个路由，统一响应格式 { ok, success, data/error }     │
├─────────────────────────────────────────────────────────┤
│                  业务服务层（src/services）                │
│   contentWorkflow(编排) / documentGeneration(单文档)      │
│   projectManager / projectReader / projectStage          │
│   modelClient / imageClient / shotTaskBuilder            │
│   ideaManager / taskManager / accountMemory              │
│   profileConfig / workspaceConfig                        │
├─────────────────────────────────────────────────────────┤
│            Prompt 与模型调用层（src/prompts, src/utils）   │
│   generatePrompt / refinePrompt / enhancePrompt(死代码)  │
│   modelJson(四阶段解析) / documentDefinitions(10份定义)   │
├─────────────────────────────────────────────────────────┤
│              文件系统与配置层（.piance/, output/）          │
│   .piance/: model-config / workspace / ideas / tasks     │
│             profile / account-memory / trash             │
│   output/<slug>/: 10份md + project.json + covers/        │
└─────────────────────────────────────────────────────────┘
```

### 5.2 各层职责

| 层 | 职责 | 关键文件 |
|---|---|---|
| UI 页面层 | 路由、页面级布局、SSR 数据获取 | [page.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/page.tsx) 等 6 个 |
| React 组件层 | 交互逻辑、表单、列表渲染 | [GenerateWorkspace.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/GenerateWorkspace.tsx) 等 |
| API 层 | 请求校验、限流、鉴权、调用服务层 | [generate/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/generate/route.ts) 等 |
| 业务服务层 | 核心业务逻辑、文件读写、状态管理 | [contentWorkflow.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/contentWorkflow.ts) |
| Prompt 层 | Prompt 构建、输出解析、文档校验 | [generatePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/generatePrompt.ts) |
| 存储层 | 文件系统 CRUD、JSON 序列化 | [localStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/localStore.ts) |

### 5.3 CLI vs Web 架构关系

```
CLI（src/commands/*）          Web（web/app/api/*）
      │                              │
      ├─ generate ──┐    ┌── generate ──→ contentWorkflow.generateProject（共用）
      │             ↓    ↓
      ├─ refine ──→ 直接调 callModel（重复实现，退化版）
      │                    ↓
      │              refine ──→ contentWorkflow.refineProjectFile（含 repair + 防覆盖）
      │
      └─ scan ──→ 直接调 scanAssets（重复实现）
                         ↓
                 scan ──→ contentWorkflow.scanProjectAssets
```

---

## 六、核心数据流

### 6.1 创建项目数据流（主链路）

```
用户在 /create 填写表单
  ↓
GenerateWorkspace.tsx → POST /api/generate
  ↓
generate/route.ts
  ├─ 创建 jobId + AbortController + 内存 jobs Map
  ├─ IP 限流检查（每分钟 6 次/每日 30 次）
  ├─ 用户配额检查（Supabase free_trial）
  └─ 调用 contentWorkflow.generateProject(input, options)
       │
       ├─ 1. createTempProjectDirectory(jobId) → output/.tmp/{jobId}/
       │
       ├─ 2. createProjectBrief(input)
       │     └─ callModel(buildProjectBriefPrompt) → ProjectBrief JSON
       │        └─ modelJson.parseModelJsonObject 四阶段解析
       │
       ├─ 3. 并发 3 worker 生成 8 份核心文档（01-08）
       │     └─ generateValidatedDocument(definition)
       │          ├─ callModel(buildDocumentPrompt) → Markdown
       │          ├─ validateDocument（二级标题 + minLength + 占位语检测）
       │          ├─ 失败 → callModel(buildDocumentRepairPrompt) → 重新校验
       │          └─ 再失败 → callModel(buildDocumentPrompt, regenerate=true) → 重新校验
       │
       ├─ 4. 跨文档重复检测
       │
       ├─ 5. 串行生成 2 份执行文档（09-10）
       │     └─ 校验依赖文档存在 → generateDefinition
       │
       ├─ 6. 写入文件
       │     ├─ writeMarkdown × N（formatMarkdown 统一换行）
       │     └─ writeJson(project.json)
       │          字段: metadata + projectBrief + status + documentsStatus
       │                + generated/repaired/failed + validationErrors
       │
       └─ 7. finalizeTempProjectDirectory → rename .tmp/{jobId} → output/{projectName}/
           失败/取消 → finally removeTempProjectDirectory
  ↓
返回 { projectName, slug, files, timings }
用户跳转 → /projects/{slug}
```

### 6.2 文档修改数据流（refine）

```
用户在项目详情选择文档 + 输入修改意见
  ↓
POST /api/refine { projectSlug, filename, feedback }
  ↓
contentWorkflow.refineProjectFile
  ├─ resolveProjectDirectory(projectSlug)
  ├─ 读取原文件 → 组装 RefineDocument
  ├─ callModel(buildRefinePrompt([document], feedback))
  ├─ parseRefinedContent(raw, [filename])
  │    └─ 失败 → callModel(buildRefineRepairPrompt) 重试一次
  ├─ availableRevisedFilename → 生成 XX_修改版.md / XX_修改版_2.md
  └─ writeMarkdown（不覆盖原文件）
  ↓
返回 { revisedFilename }
```

### 6.3 镜头任务数据流

```
用户访问项目详情 → 镜头任务 Tab
  ↓
GET /api/projects/[slug]/shots
  ├─ 优先读 project.json 的 shotTasks 缓存
  ├─ 缓存不存在 → buildShotTasks()
  │    └─ 从 03/04/05/07/09 文档解析镜头清单
  │    └─ 写入 project.json 的 shotTasks 字段
  └─ 返回 ShotTask[]
  ↓
用户更新镜头状态（待拍/已拍/已备素材）
  ↓
PATCH /api/projects/[slug]/shots { taskId, status, ... }
  ├─ 更新 project.json 的 shotTasks 数组
  └─ 触发阶段推断 → inferStage()
       └─ 全部已拍 → shooting 阶段完成 → 推进到 editing
```

### 6.4 工作台数据流

```
GET /api/dashboard
  ├─ listProjects() → 项目列表
  │    └─ 扫描 output/ 目录（跳过 .tmp）
  ├─ 读每个项目的 project.json
  │    └─ 提取 documentsStatus / generated / failed / stage
  ├─ listTasks() → 今日待办（按优先级排序）
  ├─ listIdeas() → 灵感列表
  └─ 汇总返回: { projects, pipeline, tasks, ideas, workspace }
  ↓
DashboardWorkspace.tsx 渲染
  ├─ 今日推进（最近活跃项目）
  ├─ 内容管线（项目状态分布）
  ├─ 我的项目（最近 4 个）
  └─ 今日待办
```

### 6.5 设置数据流

```
设置中心
  ├─ 模型配置
  │    ├─ GET /api/model-config → PublicModelConfig（apiKey 掩码）
  │    ├─ POST /api/model-config → saveModelConfig → .piance/model-config.json
  │    └─ POST /api/model-config/test → 连接测试
  │
  ├─ 工作区
  │    ├─ GET /api/workspace → WorkspaceStats
  │    ├─ POST /api/workspace/pick → 选择目录（仅返回路径，不持久化）
  │    └─ POST /api/workspace → setOutputDir → .piance/workspace.json
  │
  ├─ 创作者资料
  │    ├─ GET /api/profile → CreatorProfile
  │    ├─ POST /api/profile → saveCreatorProfile → .piance/profile.json + avatar
  │    └─ GET /api/profile/avatar → 二进制图片
  │
  └─ 账号记忆
       ├─ GET /api/account-memory → AccountMemory
       └─ POST /api/account-memory → saveAccountMemory → .piance/account-memory.json
            └─ contentWorkflow.generateProject 读取此文件注入 Prompt
```

---

## 七、数据模型与存储

### 7.1 数据实体总览

| 实体 | 类型定义 | 存储位置 | 写入方 | 读取方 |
|---|---|---|---|---|
| `Idea` | [idea.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/idea.ts) | `.piance/ideas.json` | ideaManager | `/api/ideas` |
| `Task` | [task.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/task.ts) | `.piance/tasks.json` | taskManager | `/api/tasks` |
| `ShotTask` | [shotTask.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/shotTask.ts) | `output/<slug>/project.json` | shotTaskBuilder | `/api/projects/[slug]/shots` |
| `ProjectMetadata` | [projectReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectReader.ts) | `output/<slug>/project.json` | contentWorkflow | projectReader / dashboard |
| `DocumentStatusRecord` | [documentGeneration.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/documentGeneration.ts) | `project.json` 的 `documentsStatus` | contentWorkflow | projectReader / dashboard |
| `PublishData` | [projectStage.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectStage.ts) | `project.json` 的 `publishData` | projectStage.updatePublishData | projectStage.inferStage |
| `AccountMemory` | [accountMemory.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/accountMemory.ts) | `.piance/account-memory.json`（**不存在**） | accountMemory.save | contentWorkflow |
| `ModelConfig` | [modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts) | `.piance/model-config.json`（**含明文 Key**） | modelClient.save | modelClient.load |
| `CreatorProfile` | [profileConfig.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/profileConfig.ts) | `.piance/profile.json` + `avatar.png` | profileConfig.save | profileConfig.get |
| `WorkspaceConfig` | [workspaceConfig.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/workspaceConfig.ts) | `.piance/workspace.json` | workspaceConfig.setOutputDir | workspaceConfig.getOutputDir |
| `user_profiles` | [trial.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/lib/supabase/trial.ts) | Supabase Postgres | ensureProfile / RPC | getTrialStatus |

### 7.2 `.piance/` 目录结构

```
.piance/
├── model-config.json     ✅ 模型配置（含明文 apiKey）
├── workspace.json        ✅ 工作区配置（字段名与接口不匹配，见风险 R-07）
├── ideas.json            ✅ 灵感列表（当前为空）
├── tasks.json            ✅ 待办列表（当前为空）
├── profile.json          ✅ 创作者资料
├── profile/
│   └── avatar.png        ✅ 头像二进制（5.2 MB）
├── account-memory.json   ❌ 不存在（服务已实现但从未启用）
└── trash/                ✅ 回收站（8 个旧项目，含 3 个版本字段演进）
```

### 7.3 `output/<slug>/project.json` 结构

```json
{
  "projectName": "...",
  "topic": "...",
  "platform": "...",
  "contentSubject": "...",
  "contentDomain": "...",
  "style": "...",
  "targetAudience": "...",
  "extraRequirements": "...",
  "model": "...",
  "accountMemoryUsed": false,
  "accountMemorySnapshot": {},
  "generatedAt": "ISO-8601",
  "generationStartedAt": "ISO-8601",
  "generationFinishedAt": "ISO-8601",
  "generationDurationMs": 0,
  "generationDurationLabel": "...",
  "projectBrief": { /* ProjectBrief */ },
  "status": "complete | partial | failed",
  "documentsStatus": { "01": { "documentStatus": "generated", "chars": 0 }, ... },
  "generated": ["01", "02", ...],
  "repaired": ["03"],
  "failed": [],
  "validationErrors": {},
  "fallbackUsed": false,
  "fallbackDocuments": [],
  "shotTasks": [ /* ShotTask[]，缓存 */ ],
  "stage": "drafting | planning | shooting | editing | published | archived",
  "stageUpdatedAt": "ISO-8601",
  "nextAction": "...",
  "publishData": { /* PublishData */ }
}
```

### 7.4 旧字段兼容

| 旧字段 | 新字段 | 兼容逻辑 | 影响范围 |
|---|---|---|---|
| `accountType` | `contentSubject` + `contentDomain` | [contentProfile.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/contentProfile.ts) `LEGACY_ACCOUNT_MAP` | 3 个回收站项目 |
| 6 文件命名（01_选题拆解…） | 10 文件命名（01_项目概览…） | [documentDefinitions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts) `LEGACY_DOCUMENT_DEFINITIONS` | 回收站旧项目 |
| `projectName` 缺失 | `projectName` 必填 | [projectReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectReader.ts) fallback 到 topic → slug | v1/v2 旧项目 |
| `stage` 缺失 | `stage` 持久化 | [projectStage.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectStage.ts) `readStage` 缺失时 inferStage 并写回 | 旧项目首次访问自动迁移 |
| `outputDir`（workspace.json） | `mode` + `absolutePath` | **无兼容逻辑** | 静默失效（见风险 R-07） |

### 7.5 localStorage 使用（仅 2 个 key）

| Key | 用途 | 写入 | 读取 |
|---|---|---|---|
| `preframe:theme` | 主题（light/dark） | TopBar / AppSidebar | layout.tsx（防闪烁） |
| `piance:create-project-draft:v1` | 创建项目表单草稿 | GenerateWorkspace | GenerateWorkspace |

### 7.6 内存 Map

| Map | 位置 | 用途 | 清理机制 |
|---|---|---|---|
| `jobs` | [generate/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/generate/route.ts) | 生成任务快照 | **无清理**（内存泄漏） |
| `ipWindows` | 同上 | IP 限流窗口 | 条目永不删除 |
| `userWindows` | 同上 | 用户限流窗口 | 条目永不删除 |

### 7.7 Supabase 集成

`web/lib/supabase/` 是**真实实现**（非 stub），表结构见 [SUPABASE_SCHEMA.sql](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/SUPABASE_SCHEMA.sql)：

- **`user_profiles` 表**：`id` / `email` / `free_trial_used` / `free_trial_limit`(默认3) / 时间戳，RLS 已启用
- **RPC**：`increment_trial`（原子自增，超限抛错）、`handle_new_user`（注册触发器）、`set_updated_at`
- **三个客户端**：`client.ts`（浏览器）/ `server.ts`（SSR）/ `admin.ts`（服务端，用 service_role_key bypass RLS）

---

## 八、Prompt 与模型调用

### 8.1 模型调用层

| 特性 | 实现 | 位置 |
|---|---|---|
| 多 provider 路由 | anthropic → callAnthropic；gemini → callGemini；其余 6 种 → callOpenAICompatible | [modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts) `createModelClient` |
| 配置优先级 | `.piance/model-config.json` > 环境变量 > 默认 deepseek | `loadModelConfig` |
| API Key 传递 | OpenAI: Bearer header；Anthropic: x-api-key header；Gemini: x-goog-api-key header（不写入 URL） | 各 call* 函数 |
| 错误脱敏 | 401/403/key 等统一为"模型连接失败，请检查 API Key、Base URL 或模型名称" | `sanitizeModelError` |
| HTTP 超时 | **无**（依赖调用方传 signal，CLI 不传 → 无超时） | — |
| 自动重试 | **无** | — |
| response_format | **未启用** json_object（完全靠 modelJson.ts 容错） | — |

### 8.2 JSON 解析容错（四阶段）

[modelJson.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/modelJson.ts) `parseModelJsonObject`：

1. 直接 `JSON.parse`
2. 清洗后 `JSON.parse`（去 BOM、全角引号→半角、去 `<think>` 标签、去 ` ``` ` 围栏）
3. 提取所有 `{...}` 平衡对象候选，逐个 `JSON.parse`
4. 对候选 + 清洗后字符串依次 `jsonrepair` 再 `JSON.parse`

> ⚠️ 此模块零测试覆盖，是高风险解析逻辑。

### 8.3 文档定义（10 份）

| 编号 | 文件名 | minLength | 必含二级标题数 |
|---|---|---|---|
| 01 | 01_项目概览.md | 500 | 5 |
| 02 | 02_选题拆解.md | 600 | 5 |
| 03 | 03_口播脚本.md | 900 | 5 |
| 04 | 04_分镜与剪辑节奏.md | 700 | 4 |
| 05 | 05_拍摄清单.md | 500 | 5 |
| 06 | 06_封面标题与发布文案.md | 800 | 6 |
| 07 | 07_视觉参考提示词.md | 500 | 5 |
| 08 | 08_内容质检报告.md | 600 | 0（用质检表格校验） |
| 09 | 09_成片执行稿.md | 1000 | 7 |
| 10 | 10_发布承接话术.md | 700 | 5 |

定义见 [documentDefinitions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts)。

### 8.4 双轨生成路径（关键遗留问题）

```
旧路径（死代码）：
  buildGeneratePrompt → parseGeneratedContent → parseCoreContent
  → generateExecutionPackage → writeCompleteProject
  （整条链路约 500 行，generateProject 不再调用）

新路径（生效）：
  buildDocumentPrompt → generateValidatedDocument（3阶段修复）
  → contentWorkflow.generateProject 内部 generateDefinition
  （当前唯一生效的生成路径）
```

### 8.5 修复/重试机制

| 机制 | 实现 |
|---|---|
| 单文档修复 | 3 阶段：生成 → repair prompt 修复 → 重新生成，每阶段过 validateDocument |
| refine 修复 | 1 次 buildRefineRepairPrompt 重试，失败抛错 |
| 09/10 fallback | 旧路径已死代码；新路径走标准 generateValidatedDocument |
| 临时目录清理 | finally 块在 `!finalized` 时 rm -rf，进程崩溃时残留 |

---

## 九、CLI 层

### 9.1 命令清单

| 命令 | Handler | 核心依赖 | 与 Web 关系 |
|---|---|---|---|
| `piance generate` | [generate.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/generate.ts) | `contentWorkflow.generateProject` | **共用核心**，无重复 |
| `piance refine` | [refine.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/refine.ts) | 直接调 `callModel` + `buildRefinePrompt` | **重复实现**，退化版（无 repair、无防覆盖） |
| `piance scan` | [scan.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/scan.ts) | 直接调 `scanAssets` + `writeMarkdown` | **重复实现** |
| `piance --version` | [index.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/index.ts) | — | — |

### 9.2 CLI vs Web 重复分析

- **generate**：✅ 设计正确，CLI 与 Web 完全共用 `generateProject`，Web 仅增加运行时控制层（jobId/限流/鉴权/AbortController/SSE）
- **refine**：❌ CLI 完全绕过 `refineProjectFile`，重复实现且功能弱化（无 repair 重试、无 `_2/_3` 防覆盖序号、不校验 `assertMarkdownFilename`）
- **scan**：❌ CLI 完全绕过 `scanProjectAssets`，重复实现写文件逻辑

---

## 十、测试覆盖

### 10.1 测试文件清单

| 文件 | 形式 | 覆盖模块 | 用例数 |
|---|---|---|---|
| [qualityStatus.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/qualityStatus.test.ts) | `node:test` + `node:assert` | validateDocument / statusRecord / PLACEHOLDER_PHRASES / Gemini URL | 8 |
| [shotTaskApi.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/shotTaskApi.test.ts) | 裸脚本（console.assert） | shotTaskBuilder | 失败不退出非零 |
| [shotTaskBuilder.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/shotTaskBuilder.test.ts) | 裸脚本（console.log） | shotTaskBuilder | 无断言 |

### 10.2 覆盖矩阵

| 模块 | 单元测试 | 集成测试 |
|---|---|---|
| prompts/generatePrompt | ❌ | ❌ |
| prompts/refinePrompt | ❌ | ❌ |
| services/modelClient | ❌ | ❌ |
| services/documentGeneration | 部分 | ❌ |
| services/contentWorkflow | ❌ | ❌ |
| utils/modelJson | ❌ | ❌ |
| services/shotTaskBuilder | 裸脚本（脆弱） | ❌ |
| commands/* | ❌ | ❌ |

### 10.3 测试缺口

1. Prompt 构建与解析零覆盖（`parseGeneratedContent`、`parseRefinedContent`、`parseModelJsonObject`）
2. `generateProject` 全流程无集成测试
3. `modelJson.ts` 四阶段容错零覆盖（高风险）
4. `shotTaskBuilder` 测试硬编码 `output/ai/` 路径，CI 必失败
5. CLI 命令层零测试

---

## 十一、风险与问题定级

### 11.1 高风险（需优先处理）

| ID | 风险 | 位置 | 影响 |
|---|---|---|---|
| R-01 | `Idea.convertedProjectSlug` 字段读取但从不写入 | [ideaManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/ideaManager.ts) `markIdeaConverted` 死代码 + [IdeaInbox.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/ideas/IdeaInbox.tsx) `convertToProject` 未回填 | "已转项目"徽章永远不出现 |
| R-02 | 09 文档 requiredSections 字段名不一致 | [documentDefinitions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts) vs [generatePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/generatePrompt.ts) | `每5-10秒画面安排`(无空格) vs `每 5-10 秒画面安排`(有空格)；条目数 7 vs 6，校验结果冲突 |
| R-03 | workspace.json 字段名与接口不匹配 | [.piance/workspace.json](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/.piance/workspace.json) 用 `outputDir`，[workspaceConfig.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/workspaceConfig.ts) 只读 `mode`/`absolutePath` | 用户配置的外部目录被静默忽略，始终落到默认 output/ |
| R-04 | 约 500+ 行死代码（双轨生成路径） | contentWorkflow.ts ~299-461 + enhancePrompt.ts + generatePrompt.ts 旧函数 | 维护时极易误判生效路径 |
| R-05 | modelClient 无 HTTP 超时 | [modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts) | CLI 路径不传 signal，慢响应无限挂起 |
| R-06 | model-config.json 明文存储 API Key | [.piance/model-config.json](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/.piance/model-config.json) + .env | 本地明文存储（.gitignore 已正确忽略，不会泄露到 git，但本地文件可被读取） |

### 11.2 中风险

| ID | 风险 | 位置 | 影响 |
|---|---|---|---|
| R-07 | ShotTask 缓存与文档重新生成不同步 | [shots/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/projects/[slug]/shots/route.ts) + contentWorkflow.ts `regenerateProjectDocuments` | regenerate 后镜头任务不自动刷新，inferStage 基于过时数据 |
| R-08 | dashboard 直接读磁盘 documentsStatus 不实时校验 | [dashboard/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/dashboard/route.ts) vs [projectReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectReader.ts) | 仪表盘文档进度可能滞后 |
| R-09 | jobs/ipWindows/userWindows Map 内存泄漏 | [generate/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/generate/route.ts) | 生产环境长期运行内存只增不减 |
| R-10 | CLI refine 重复实现且功能弱化 | [refine.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/refine.ts) | 无 repair 重试、无防覆盖序号 |
| R-11 | CLI scan 重复实现 | [scan.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/scan.ts) | 写文件逻辑重复 |
| R-12 | publishData.publishedAt 与 stage 双数据源 | [projectStage.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectStage.ts) | 手动改 stage 为 archived 后 inferStage 仍可能返回 published |
| R-13 | 3 个版本 project.json 字段并存无自动迁移 | 回收站 8 个项目 | accountType / contentSubject only / 完整三件套三种格式 |
| R-14 | callOpenAICompatible 未启用 response_format: json_object | [modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts) | 完全依赖 modelJson.ts 容错，该模块零测试 |
| R-15 | 核心生成/解析流程零测试覆盖 | src/tests/ | 重构风险极高 |

### 11.3 低风险

| ID | 风险 | 位置 | 影响 |
|---|---|---|---|
| R-16 | output/.tmp 孤儿目录无 GC | [projectManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectManager.ts) | 进程崩溃后残留，占磁盘（不污染列表） |
| R-17 | uniqueProjectRoots 双根扫描 | projectManager.ts | 旧根项目持续出现在列表 |
| R-18 | Task/Idea/ProjectStage 类型重复定义 | src/types vs web/components/dashboard/types | 字段演进时容易遗漏 |
| R-19 | AccountMemory 服务实现但未启用 | [accountMemory.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/accountMemory.ts) | 功能从未被用户使用 |
| R-20 | shotTaskBuilder 测试硬编码 output/ai/ 路径 | [shotTaskApi.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/shotTaskApi.test.ts) | CI 必失败 |

### 11.4 安全检查结论

| 检查项 | 结果 | 说明 |
|---|---|---|
| `.gitignore` 包含 `.piance/` | ✅ 是 | 第 10 行 `.piance/` |
| `.gitignore` 包含 `.env` | ✅ 是 | 第 11 行 `.env` + `.env.*` + `!.env.example` |
| `git check-ignore .piance/model-config.json` | ✅ 被忽略 | 匹配 `.gitignore:10:.piance/` |
| git 历史是否提交过 model-config.json | ✅ 从未提交 | `git log -- .piance/model-config.json` 无结果 |
| git 历史是否提交过 .env | ✅ 从未提交 | `git log -- .env` 无结果 |
| API Key 本地存储方式 | ⚠️ 明文 | `.piance/model-config.json` 和 `.env` 均明文 |
| Gemini API Key 传递方式 | ✅ 安全 | 通过 `x-goog-api-key` header，不写入 URL |
| 头像路径穿越防护 | ✅ 有 | `absoluteAvatarPath` 限制必须落在 PROFILE_DIR 下 |
| 输入验证（路径） | ✅ 有 | `assertMarkdownFilename`、`resolveProjectDirectory` |

---

## 十二、商业化基础评估

### 12.1 已具备的基础

| 能力 | 状态 | 说明 |
|---|---|---|
| 核心业务闭环 | ✅ | 灵感→创建→生成→修改→镜头任务→发布 全链路可用 |
| 多模型兼容 | ✅ | 8 种 provider，含连接测试 |
| 用户配额管控 | ✅ 基础 | Supabase free_trial（3 次限额），IP 限流 |
| 项目数据隔离 | ⚠️ 部分 | 文件系统按 slug 隔离，但无用户级隔离（所有用户共享 output/） |
| 数据持久化 | ✅ | 文件系统 JSON + Markdown，结构清晰 |
| 响应式 UI | ✅ | 桌面/平板/移动端适配 |
| 主题切换 | ✅ | light/dark，防闪烁 |

### 12.2 缺失的生产级能力

| 能力 | 缺失程度 | 说明 |
|---|---|---|
| 多用户数据隔离 | ❌ 严重 | 所有项目存储在同一 output/ 目录，无用户分区 |
| 监控告警 | ❌ 严重 | 无日志收集、无错误监控、无性能指标 |
| 数据备份 | ❌ 严重 | 文件系统存储，无自动备份机制 |
| API 请求安全 | ⚠️ 基础 | 应用无需通用登录；模型写操作执行同源校验，发布平台账号单独授权 |
| 配额精细化 | ⚠️ 基础 | 仅 free_trial 次数限制，无 token 级配额 |
| 并发控制 | ⚠️ 基础 | 生成任务用内存 Map，无分布式锁 |
| 错误恢复 | ❌ 严重 | 进程崩溃后 .tmp 残留、jobs Map 丢失，无法恢复 |
| 测试保障 | ❌ 严重 | 核心流程零覆盖，重构风险极高 |

### 12.3 商业化结论

> **当前状态适合作为个人/小团队本地工具使用，距离 SaaS 级商业化仍有显著差距。**

**可商业化路径**：
1. **本地工具付费**（近期可行）：当前形态 + License 激活码，作为桌面应用分发
2. **SaaS 化**（中期）：需要补充用户隔离、对象存储、监控、测试等基础设施
3. **API 服务化**（远期）：将生成能力封装为 API 对外提供

**最紧迫的商业化阻碍**：
1. 测试覆盖不足 — 无法保证迭代质量
2. 无用户数据隔离 — 无法多租户
3. 死代码与字段不一致 — 维护成本高
4. 无错误恢复机制 — 用户体验不可控

---

## 十三、下一步开发方向建议

### 13.1 优先级 P0（立即修复）

| 序号 | 任务 | 预估工作量 | 关联风险 |
|---|---|---|---|
| 1 | 修复 `Idea.convertedProjectSlug` 回填逻辑 | 0.5d | R-01 |
| 2 | 统一 09/10 文档 requiredSections 字段名 | 0.5d | R-02 |
| 3 | 修复 workspace.json 字段名兼容 | 0.5d | R-03 |
| 4 | 删除双轨生成路径死代码（500+ 行） | 1d | R-04 |

### 13.2 优先级 P1（近期完成）

| 序号 | 任务 | 预估工作量 | 关联风险 |
|---|---|---|---|
| 5 | 为 modelClient 添加 HTTP 超时 + 自动重试 | 0.5d | R-05 |
| 6 | CLI refine/scan 改为调用 contentWorkflow 公共方法 | 0.5d | R-10, R-11 |
| 7 | regenerate 后自动刷新 shotTasks 缓存 | 0.5d | R-07 |
| 8 | jobs Map 添加 TTL 清理机制 | 0.5d | R-09 |
| 9 | 补充 modelJson.ts 单元测试 | 1d | R-14, R-15 |
| 10 | 补充 generateProject 集成测试 | 1d | R-15 |

### 13.3 优先级 P2（中期规划）

| 序号 | 任务 | 说明 |
|---|---|---|
| 11 | project.json 字段迁移工具 | 统一 3 个版本字段格式 |
| 12 | dashboard 实时校验文档状态 | 替代直接读磁盘 documentsStatus |
| 13 | API Key 加密存储 | 使用系统 keychain 或加密文件 |
| 14 | .tmp 孤儿目录定期 GC | 后台清理任务 |
| 15 | 统一前后端类型定义 | 消除 src/types 与 web/components/dashboard/types 重复 |

### 13.4 架构演进建议

1. **短期**：清理死代码 + 补测试 + 修复字段不一致，建立可维护基础
2. **中期**：引入对象存储（S3/OSS）替代文件系统，支持多用户隔离
3. **长期**：拆分为「生成服务 + Web 前端 + CLI」三独立部署单元，支持 API 服务化

---

## 附录：关键文件索引

### 前端
- 页面：[web/app/](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app) 下 6 个 page.tsx
- 组件：[web/components/](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/components)
- 布局：[layout.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/layout.tsx)
- 样式：[globals.css](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/globals.css)

### API
- 生成：[generate/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/generate/route.ts)
- 项目：[projects/](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/projects)
- 仪表盘：[dashboard/route.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/dashboard/route.ts)

### 服务层
- 编排：[contentWorkflow.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/contentWorkflow.ts)
- 单文档：[documentGeneration.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/documentGeneration.ts)
- 模型：[modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts)
- 项目管理：[projectManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectManager.ts)
- 项目读取：[projectReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectReader.ts)
- 阶段管理：[projectStage.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectStage.ts)

### Prompt 层
- 生成：[generatePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/generatePrompt.ts)
- 修改：[refinePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/refinePrompt.ts)
- 增强（死代码）：[enhancePrompt.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/enhancePrompt.ts)
- 文档定义：[documentDefinitions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts)
- JSON 解析：[modelJson.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/modelJson.ts)

### CLI
- 入口：[index.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/index.ts)
- 命令：[commands/](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands)

### 配置
- package.json
- [SUPABASE_SCHEMA.sql](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/SUPABASE_SCHEMA.sql)
- .gitignore

---

> **报告结束**。本报告基于 2026-08-04 磁盘代码状态生成，所有结论均通过只读审计得出，未修改任何业务代码、样式或配置。
