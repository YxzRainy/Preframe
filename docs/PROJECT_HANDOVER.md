# Preframe 项目交接文档

> 生成日期：2026-08-10  
> 用途：供其他 agent / 工程师快速接手本项目。所有内容均基于当前代码库真实文件，未运行构建。  
> 项目根目录：`/Users/YxzRainy/Documents/Vibecoding/Preframe`

---

## 一、项目定位与边界

- **品牌名**：片策 / Preframe（package name `piance`）
- **副标题**：短视频前期策划与准备工作台
- **形态**：本地运行的单用户工具，同时提供 **CLI**（`src/index.ts`）与 **Next.js Web 工作台**（`web/`）。无登录、无数据库、无云端部署、非 SaaS。
- **核心价值**：把短视频创作前期「不需要创造力的机械劳动」自动化——选题策划、脚本/分镜生成、素材整理、Proxy 生成、剪辑项目准备、发布辅助。
- **产品边界（重要）**：
  - Preframe **不是剪辑软件**：不做自动粗剪、剪辑点选择、最佳 take 选择、转场、调色、节奏剪辑、时间线编辑。
  - **不复制/移动/重命名原始素材**，剪辑目录仅用 symlink 引用。
  - **不做真实自动化上传**到平台；发布模块是「人工辅助发布」工作流。
  - 不使用 localStorage 存核心数据，不暴露 Supabase service role key 到前端。
  - 禁用高风险词：合同、协议、法律效力、司法存证、不可篡改、担保、托管。

---

## 二、技术栈

| 维度 | 选型 |
| --- | --- |
| 运行时 | Node.js `>=18` |
| 语言 | TypeScript（严格模式） |
| Web 框架 | Next.js App Router（`next ^16.1.0`，webpack 模式） |
| UI | React 19 + 全局 CSS（`web/app/globals.css`），无 Tailwind / UI 库 |
| Markdown | `react-markdown` + `remark-gfm` |
| CLI | `commander` + `inquirer` + `tsx` |
| 模型 SDK | `openai`（OpenAI-compatible，默认指向 DeepSeek） |
| 数据存储 | 本地文件系统：`output/`（项目内容）+ `.piance/`（结构化状态 JSON） |
| 其他依赖 | `@supabase/ssr`、`@supabase/supabase-js`、`dotenv`、`jsonrepair` |

构建脚本见 [package.json](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/package.json)：

```text
npm run dev         # Next.js 开发（localhost:3000）
npm run build:web   # next build web --webpack
npm run web         # next start web
npm run dev:cli     # CLI 入口（tsx）
npm run generate / refine / scan   # 三个 CLI 子命令
npm run build       # tsc → dist/
npm run test        # 串联运行 qualityStatus / proxyManager / mediaRelinker 三个测试
```

**接手前必跑三件套**：`npx tsc --noEmit`、`npm run test`、`npm run build:web`（项目硬约束）。

---

## 三、顶层目录结构

```text
Preframe/
├── src/                    # CLI 与 Web 共用的核心业务层（TypeScript）
│   ├── commands/           # CLI 交互命令：generate / refine / scan
│   ├── prompts/            # 模型 Prompt 构造与 JSON 解析
│   ├── services/           # 50+ 服务模块（见下文分组）
│   ├── types/              # 类型定义
│   ├── utils/              # 文档定义、文件名清理、Markdown 工具
│   ├── tests/              # 测试（.test.ts + .mts 验收脚本）
│   └── index.ts            # CLI 入口
├── web/                    # Next.js App Router 前端
│   ├── app/                # 页面路由 + api/ Route Handler + globals.css
│   ├── components/         # React 组件（按业务域分组）
│   ├── public/             # favicon / PWA 图标
│   ├── next.config.ts
│   └── tsconfig.json
├── output/                 # 生成的项目内容（每个项目一个目录，.gitignore）
├── .piance/                # 结构化状态持久化（见第六节）
├── docs/                   # 文档（本文件 + 早期审计 + 蓝图 + 发布引擎 spike）
├── scripts/                # 辅助脚本
├── final-videos/           # 最终视频文件存放
├── package.json / tsconfig.json
├── PROJECT_CONTEXT.md      # 2026-06-23 的早期架构审计（部分已过时，仅供参考）
├── README.md
└── SUPABASE_SCHEMA.sql
```

关键架构原则：**`src/services/` 同时承担 CLI 和 Web 后端服务层**，没有独立 server 进程；Web 的 `api/route.ts` 直接调用 `src/services/` 中的函数。

---

## 四、核心模块划分（按业务域）

### 4.1 内容生成模块

负责从选题到 8 份策划文档的 AI 生成与修改。

| 文件 | 职责 |
| --- | --- |
| [src/commands/generate.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/generate.ts) | CLI 交互式创建项目 |
| [src/commands/refine.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/refine.ts) | CLI 修改已有文档（脚本/分镜/封面） |
| [src/commands/scan.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/commands/scan.ts) | CLI 素材扫描 |
| [src/services/contentWorkflow.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/contentWorkflow.ts) | **核心编排**：`generateProject` / `regenerateProjectDocuments` / `refineProjectFile` |
| [src/services/documentGeneration.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/documentGeneration.ts) | 文档状态机（waiting/generating/validating/repairing/completed/failed）+ `validateDocument` |
| [src/services/modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts) | OpenAI-compatible 调用入口，错误归类，`ModelClientError` |
| [src/services/imageClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/imageClient.ts) | 封面图片生成（fetch 兼容格式，非 openai SDK） |
| [src/utils/documentDefinitions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts) | **8 份策划文档的定义**（标题/文件名/章节要求），Prompt/解析/UI 共享 |
| [src/utils/modelJson.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/modelJson.ts) | 模型 JSON 解析与 `jsonrepair` 容错 |
| [src/utils/modelLabel.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/modelLabel.ts) | 模型显示名映射 |
| [src/utils/generationTiming.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/generationTiming.ts) | 生成耗时记录 |

8 份文档映射（生成结果 JSON key → 文件名）：

```text
projectOverview        → 01_项目概览.md
topicAnalysis          → 02_选题拆解.md
spokenScript           → 03_口播脚本.md
storyboardAndEditing   → 04_分镜与剪辑节奏.md
shootingChecklist      → 05_拍摄清单.md
coverTitlesAndPostCopy → 06_封面标题与发布文案.md
visualPrompts          → 07_视觉参考提示词.md
qualityCheckReport     → 08_内容质检报告.md
```

**修改文档定义时必须同步**：Prompt 构造、JSON 解析、contentWorkflow、projectReader、UI 卡片映射——不能只改一处。

### 4.2 项目与文件管理模块

| 文件 | 职责 |
| --- | --- |
| [src/services/projectManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectManager.ts) | 项目目录创建、slug 生成、`OUTPUT_DIR`（依赖 `process.cwd()`） |
| [src/services/projectReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectReader.ts) | 项目元数据读取、新旧字段兼容（`accountType` → `contentSubject/Domain`） |
| [src/services/projectStage.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectStage.ts) | **项目阶段管理**：状态变化与阶段迁移（被发布会话触发） |
| [src/services/projectMatch.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectMatch.ts) | 文件名/目录名匹配项目 |
| [src/services/fileWriter.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/fileWriter.ts) | Markdown / JSON 文件写入 |
| [src/services/atomicJson.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/atomicJson.ts) | **原子 JSON 读写**（临时文件 + rename），保证并发安全 |
| [src/services/localStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/localStore.ts) | `.piance/` 下通用本地数据缓存 |
| [src/utils/sanitizeFilename.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/sanitizeFilename.ts) | 文件名清理（保留中文，替换非法字符，≤80 字符） |
| [src/utils/contentProfile.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/contentProfile.ts) | 旧 `accountType` → 新内容主体/领域映射 |

### 4.3 素材管理模块

视频/图片素材的发现、扫描、元数据、匹配、偏好。

| 文件 | 职责 |
| --- | --- |
| [src/services/mediaAssetStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/mediaAssetStore.ts) | MediaAsset 持久化（`.piance/media-assets.json`） |
| [src/services/mediaAssetScanner.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/mediaAssetScanner.ts) | 素材扫描：多目录、稳定性判断（size+mtime 两次一致且 ≥10s）、轻量指纹 |
| [src/services/assetScanner.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/assetScanner.ts) | 旧版素材索引扫描（写 `00_素材索引.md`） |
| [src/services/projectAssetMatcher.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectAssetMatcher.ts) | 素材 → 项目匹配 |
| [src/services/shotAssetMatcher.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/shotAssetMatcher.ts) | 素材 → 镜头任务匹配 |
| [src/services/shotAssetLinkStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/shotAssetLinkStore.ts) | ShotAssetLink 持久化（`.piance/shot-asset-links.json`） |
| [src/services/mediaPreferences.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/mediaPreferences.ts) | 素材偏好（`.piance/media-preferences.json`） |
| [src/types/mediaAsset.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/mediaAsset.ts) | MediaAsset 接口与 ffprobe metadata 结构 |

### 4.4 镜头任务与剪辑准备模块（近期 MVP 重点）

这是 2026-08 新开发的核心模块。**产品边界**：只做素材整理 / Proxy / 文件管理 / 项目准备 / 路径管理 / 元数据 / 交付准备，**不做创意剪辑**。

| 文件 | 职责 |
| --- | --- |
| [src/services/shotTaskBuilder.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/shotTaskBuilder.ts) | 从 03-09 文档解析镜头任务（Markdown 表格 + 口播段落 + 画面描述） |
| [src/services/editPlanBuilder.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/editPlanBuilder.ts) | 从 04 文档构建剪辑准备计划，结合 ShotAssetLink |
| [src/services/editingPrepBuilder.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/editingPrepBuilder.ts) | **剪辑工作区核心**：创建标准 editing 目录、生成 symlink、写 `EDITING_MANIFEST.json`、缺失检测、重命名、工程文件检测。含进程内互斥锁 `withManifestLock` 与原子写入 |
| [src/services/proxyManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/proxyManager.ts) | Proxy 推荐（HEVC/4K/高码率）、预设（fast/high）、生成、进度、cache 复用、stale 判断 |
| [src/services/proxyJobStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/proxyJobStore.ts) | Proxy 任务队列持久化（`.piance/proxy-jobs.json`），含 `withLock` 互斥锁，限 2 并发 ffmpeg |
| [src/services/mediaRelinker.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/mediaRelinker.ts) | 素材路径重连：hash → size+filename → normalized name → size+duration 优先级 |
| [src/services/assetChecker.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/assetChecker.ts) | 素材健康检查（文件不存在/0字节/ffprobe 失败/无视频流/duration 异常等） |
| [src/services/systemActions.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/systemActions.ts) | 系统操作：Finder 定位、打开播放器、复制路径（**必须 spawn 数组，禁止 exec/shell 拼接**） |
| [src/types/shotTask.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/shotTask.ts) | ShotTask 结构 |
| [src/types/editingManifest.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/editingManifest.ts) | EditingManifest/Entry、ProxyJob/Preset/Status 类型 |

**标准剪辑目录结构**（`output/<项目>/editing/`）：

```text
editing/
├── media/           # symlink 指向原始素材（不复制）
├── proxy/           # 生成的 Proxy 文件
├── audio/ images/ subtitles/ exports/ project-files/
└── EDITING_MANIFEST.json   # 记录每个素材的 originalPath/editingPath/proxyStatus 等
```

**Proxy 状态机**：`not_needed → recommended → queued → generating → ready / failed`，stale 基于 sourcePath+size+mtime+preset 的 cache key。

### 4.5 发布模块（人工辅助发布）

注意：**不做真实自动化上传**，是「人工辅助发布」工作流。浏览器配置在 `.piance/browser-profiles/`。

| 文件 | 职责 |
| --- | --- |
| [src/services/publisherAccountStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publisherAccountStore.ts) | 发布账号管理 |
| [src/services/publishSessionStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishSessionStore.ts) | 发布会话（`.piance/publish-sessions.json`，原子写入） |
| [src/services/publishJobStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishJobStore.ts) | 发布任务持久化 |
| [src/services/publishPreparationStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishPreparationStore.ts) | 发布准备数据 |
| [src/services/publishPreparationCheck.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishPreparationCheck.ts) | 发布前检查 |
| [src/services/publishPreparationExport.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishPreparationExport.ts) | 发布准备导出 |
| [src/services/publishPrecheck.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishPrecheck.ts) | Preflight 检查（发布会话开始前自动跑） |
| [src/services/publishReadiness.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishReadiness.ts) | 发布就绪判断 |
| [src/services/publishContentReader.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishContentReader.ts) | 读取待发布内容 |
| [src/services/platformAdapter.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/platformAdapter.ts) | 平台适配（小红书/抖音等） |
| [src/services/platformVariantBuilder.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/platformVariantBuilder.ts) | 按平台生成内容变体 |
| [src/services/coverMatcher.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/coverMatcher.ts) | 封面匹配 |
| [src/services/publisherBridgeClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publisherBridgeClient.ts) | 与发布桥接进程通信 |
| [src/services/publisherWorkerClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publisherWorkerClient.ts) | 发布 worker 客户端 |
| [src/services/publisherProcessStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publisherProcessStore.ts) | 发布进程状态 |
| [src/services/publishBackendOpener.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publishBackendOpener.ts) | 打开发布后端 |
| [src/services/publisherPreferences.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/publisherPreferences.ts) | 发布偏好（`.piance/publisher-preferences.json`，原子写入） |
| [src/services/finalVideoStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/finalVideoStore.ts) | 最终视频记录（`.piance/final-videos.json`） |
| [src/services/finalVideoWatcher.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/finalVideoWatcher.ts) | 最终视频目录监听 |
| [src/types/publisher.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/publisher.ts) | Publisher / PublisherPlatform 类型 |
| [src/types/publishSession.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/publishSession.ts) | 发布会话类型 |

### 4.6 选题 / 任务 / 档案 / 工作区

| 文件 | 职责 |
| --- | --- |
| [src/services/ideaManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/ideaManager.ts) | 选题管理（`.piance/ideas.json`） |
| [src/services/taskManager.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/taskManager.ts) | 任务管理（`.piance/tasks.json`） |
| [src/services/profileConfig.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/profileConfig.ts) | 创作者档案（`.piance/profile.json`，含头像生成） |
| [src/services/workspaceConfig.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/workspaceConfig.ts) | 工作区配置（`.piance/workspace.json`） |
| [src/services/accountMemory.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/accountMemory.ts) | 账号记忆 / 用户偏好 |
| [src/types/idea.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/idea.ts) / [task.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/types/task.ts) | 选题/任务类型 |

---

## 五、Web 层结构

### 5.1 页面路由（`web/app/`）

| 路由 | 文件 | 用途 |
| --- | --- | --- |
| `/` | [page.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/page.tsx) | 首页生成工作台 |
| `/create` | create/page.tsx | 创建项目 |
| `/projects` | projects/page.tsx | 历史项目列表 |
| `/projects/[slug]` | projects/[slug]/page.tsx | 项目详情（含镜头执行 + 剪辑准备入口） |
| `/ideas` | ideas/page.tsx | 选题收件箱 |
| `/tasks` | tasks/page.tsx | 任务列表 |
| `/publish` | publish/page.tsx | 发布中心 |
| `/auth` | auth/ | 认证（Supabase，非核心） |

根布局 [web/app/layout.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/layout.tsx)：metadata、图标、PWA manifest、全局 TopBar。全站样式集中在 [web/app/globals.css](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/globals.css)（超千行，历史叠加较多）。

### 5.2 API 路由分组（`web/app/api/`）

| 分组 | 路径 | 主要功能 |
| --- | --- | --- |
| 配置 | `config`、`model-config`、`workspace`、`profile`、`account-memory`、`auth/status`、`weather` | 应用配置、模型配置、工作区、档案、记忆、认证状态、天气 |
| 生成 | `generate`、`refine`、`enhance`、`cover`、`scan` | 内容生成、修改、增强、封面、素材扫描 |
| 项目 | `projects`、`projects/[slug]`、`projects/[slug]/regenerate`、`projects/[slug]/stage`、`projects/[slug]/shots`、`projects/[slug]/publish`、`projects/[slug]/covers/[filename]` | 项目 CRUD、重新生成、阶段、镜头任务、发布、封面 |
| 仪表盘 | `dashboard` | 仪表盘统计 |
| 选题/任务 | `ideas`、`tasks` | 选题与任务 |
| 素材 | `media/assets`、`media/assets/[id]`、`media/preferences`、`media/match`、`media/pick-directory`、`media/projects/[slug]/links`、`media/projects/[slug]/edit-plan` | 素材 CRUD、偏好、匹配、目录选择、镜头链接、剪辑计划 |
| 剪辑准备 | `media/projects/[slug]/editing/prepare`、`.../manifest`、`.../proxy`、`.../proxy/[jobId]`、`.../relink`、`.../check`、`.../open` | 剪辑工作区全部能力（见 4.4） |
| 发布 | `publisher/accounts`、`.../sessions`、`.../jobs`、`.../preparations`、`.../final-videos`、`.../preferences`、`.../match-project`、`.../pick-video`、`.../pick-directory`、`.../browser-profile/douyin/*` | 账号、发布会话、任务、准备、最终视频、偏好、匹配、目录/视频选择、浏览器配置 |

API 共用工具：[web/app/api/_utils.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/app/api/_utils.ts)。**无认证、无速率限制**，仅适用于受信任本地环境。

### 5.3 组件分组（`web/components/`）

| 分组 | 组件 | 用途 |
| --- | --- | --- |
| 通用 | TopBar、Modal、StatusBadge、VisualSurface、MarkdownPreview、ModelStatusBadge、AuthButton、GenerationProgressModal、AccountMemoryModal、CreatorProfileModal、ModelConfigModal、AppSidebar | 基础 UI 与弹窗 |
| 首页生成 | GenerateWorkspace、NewTaskDrawer、ProjectSidebar、AutomationProgress、ResultTabs、ContentModuleCard、HomeAgentConsole、AgentToolsPanel、DocumentWorkspace | 选题 → 8 文档生成与展示 |
| 仪表盘 | dashboard/DashboardWorkspace、DashboardHeader、ContentPipeline、CurrentProjects、RecentProjects、TodayFocus、QuickActions、TaskList、MoodPanel、MoodCompact、types | 仪表盘整体 |
| 项目详情 | ProjectDetailView、ProjectList、project/StagePanel、project/PublishPanel | 项目详情与阶段/发布面板 |
| 镜头执行 | ShotExecutionWorkspace、ShotMediaAssets | 镜头任务执行 + 素材管理（**剪辑准备工作台入口在此**） |
| 剪辑准备 | EditingWorkbench | 剪辑工作区 UI（无阴影） |
| 选题 | ideas/IdeaInbox | 选题收件箱 |
| 发布 | publisher/PublishCenter、AccountsTab、JobList、CreateJobModal、PreparationsTab、PreparationEditor、CreatePreparationModal、PublishSessionPanel | 发布中心全套 |

**剪辑准备工作台入口**：[ShotExecutionWorkspace.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/ShotExecutionWorkspace.tsx) 内有 `view` 状态（`"shots" | "editing"`），通过「🎬 准备剪辑」按钮切换到 [EditingWorkbench.tsx](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/EditingWorkbench.tsx)。

---

## 六、数据持久化

### 6.1 `.piance/` 结构化状态（原子写入）

| 文件 | 内容 |
| --- | --- |
| `ideas.json` | 选题 |
| `tasks.json` | 任务 |
| `media-assets.json` | MediaAsset + ffprobe metadata |
| `shot-asset-links.json` | 镜头-素材关联 |
| `media-preferences.json` | 素材偏好 |
| `proxy-jobs.json` | Proxy 任务队列 |
| `publish-sessions.json` | 发布会话 |
| `publisher-preferences.json` | 发布偏好 |
| `final-videos.json` | 最终视频 |
| `profile.json` | 创作者档案 |
| `workspace.json` | 工作区配置 |
| `model-config.json` | 模型配置 |
| `browser-profiles/` | 浏览器配置（发布用） |
| `trash/` | 已删除项目备份 |

### 6.2 `output/` 项目内容

每个项目一个目录，包含：8 份 Markdown + `00_素材索引.md` + 修改版 + `project.json` + `covers/` + `editing/`（剪辑工作区）。

### 6.3 并发安全机制（重要）

- **原子 JSON 写入**：临时文件（`tmp-${pid}-${ts}-${rand}`）+ `rename`，见 [atomicJson.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/atomicJson.ts)、proxyJobStore、editingPrepBuilder。
- **进程内互斥锁**：Promise 锁链串行化读-改-写（`withLock` / `withManifestLock`），解决多 ffmpeg 进程同时完成时的丢失更新。
- **Proxy 并发**：最多 2 个 ffmpeg 进程并发。
- **Checkpoint**：仅内存 + 10 分钟 TTL，**不落盘/不入库**。

---

## 七、AI 模型调用

- 客户端：[modelClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/modelClient.ts)，使用 `openai` SDK。
- 环境变量（仅服务端读取，不进浏览器）：
  - `DEEPSEEK_API_KEY`（必填）
  - `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）
  - `DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）
- 生成 Prompt：`src/prompts/generatePrompt.ts`，要求模型返回严格 JSON（8 字段），首次解析失败用 `jsonrepair` + 一次模型修复。
- Refine Prompt：`src/prompts/refinePrompt.ts`，返回以原文件名为 key 的 JSON。
- 图片生成：[imageClient.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/imageClient.ts)，兼容 OpenAI Images API 格式，环境变量 `IMAGE_API_*`，当前可选。

---

## 八、测试

测试文件位于 `src/tests/`，`npm run test` 串联运行：

| 文件 | 覆盖 |
| --- | --- |
| [qualityStatus.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/qualityStatus.test.ts) | 质量状态逻辑 |
| [proxyManager.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/proxyManager.test.ts) | Proxy 推荐规则、cache key、stale 判断、symlink 命名 |
| [mediaRelinker.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/mediaRelinker.test.ts) | 素材缺失检测、hash 重连、size+filename 重连、模糊匹配 |
| [shotTaskBuilder.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/shotTaskBuilder.test.ts) / [shotTaskApi.test.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/shotTaskApi.test.ts) | 镜头任务构建与 API |
| [acceptEditing.mts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/tests/acceptEditing.mts) | 剪辑工作台 16 项功能真实验收（需真实项目 `ai_2`） |

---

## 九、关键约束与边界（接手必读）

完整约束见项目 memory，以下为高频踩坑点：

1. **UI 无阴影**：所有元素 `box-shadow: none`、`text-shadow: none`；层级用 border / background / spacing / typography 建立。focus 用 `outline: 2px solid var(--accent)`，不用 box-shadow。见 globals.css 中 `.editing-*` 规则。
2. **系统操作禁用 exec/shell 拼接**：clipboard / browser / file explorer 必须用 `spawn` + 参数数组。
3. **原子写入**：用户偏好、发布会话、proxy 任务、editing manifest 必须原子写（临时文件 + rename）。
4. **Proxy/manifest 并发**：必须走 `withLock` / `withManifestLock`，否则多 ffmpeg 完成时丢失更新。
5. **视频文件不复制/不上传云存储**：仅引用本地路径。
6. **不暴露凭证**：cookies/tokens 不进前端，Supabase service role key 不进前端。
7. **无 localStorage 存核心数据**。
8. **所有用户可见文字用中文**。
9. **构建三件套必须通过**：`npx tsc --noEmit` + `npm run test` + `npm run build:web`。
10. **不新增大型表单/非功能按钮/重复保存草稿步骤**；核心功能优先「人工辅助发布」而非自动上传。
11. **错误处理区分阻断与警告**，少弹错误框；剪贴板操作用 toast 不用确认弹窗。
12. **平台配置用紧凑 popover**，不单独设置页；自动发布 Beta 移到「实验功能」次级入口。

---

## 十、已知问题与历史包袱

1. **`web/app/globals.css` 超千行**，叠加多轮主题（浅色/暗色/Clean-Tech/无阴影），有重复 token 与选择器，维护风险高。改 UI 前建议先建立截图基线。
2. **`PROJECT_CONTEXT.md`（2026-06-23）部分过时**：它描述的是「片策」早期 MVP 阶段（仅 8 文档生成 + 基础扫描）。当前项目已扩展出素材管理、镜头任务、剪辑准备、发布中心等大量新模块。参考时以本文件和实际代码为准。
3. **`OUTPUT_DIR` 依赖 `process.cwd()`**：从不同目录启动可能读写到错误位置。
4. **`project.json` 无 schemaVersion / id / updatedAt / status**：未来迁移困难。
5. **API 无认证/限流**：仅限受信任本地环境，不可公网暴露。
6. **CLI refine 与 Web refine 版本命名不一致**：CLI 固定 `_修改版.md` 可能覆盖，Web 自动追加 `_2`。
7. **README 部分内容过时**：仍停留在「8 文档生成」阶段，未覆盖剪辑准备与发布模块。

---

## 十一、接手建议

1. **先跑三件套**：`npx tsc --noEmit && npm run test && npm run build:web`，确认基线绿。
2. **通读本文件 + 实际目录结构**，再读 [PROJECT_CONTEXT.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/PROJECT_CONTEXT.md) 补充早期背景（注意过时部分）。
3. **改 UI 前**：先截图建立 1440/1920/移动端基线；改 globals.css 前先确认选择器未被新主题层覆盖。
4. **改文档定义**：必须同步 Prompt / 解析 / contentWorkflow / projectReader / UI 卡片映射。
5. **改并发相关代码**（proxy/manifest/publish session）：必须走互斥锁 + 原子写入，参考 [proxyJobStore.ts](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/proxyJobStore.ts) 的 `withLock`。
6. **新增功能前**：确认是否符合产品边界（不做创意剪辑、不做真实上传、不复制素材）。
7. **提交前**：确认 `.env` 未被纳入；确认所有用户可见文字为中文；确认无阴影 UI。
8. **遇到行为异常**：先查 `.piance/` 下对应 JSON 是否损坏（并发写入遗留），再查 `output/<项目>/editing/EDITING_MANIFEST.json`。

---

## 十二、文档索引

| 文档 | 用途 |
| --- | --- |
| [docs/PROJECT_HANDOVER.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/docs/PROJECT_HANDOVER.md) | **本文件**，当前状态交接 |
| [PROJECT_CONTEXT.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/PROJECT_CONTEXT.md) | 2026-06-23 早期架构审计（部分过时） |
| [docs/PREFRAME_FULL_PRODUCT_AUDIT.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/docs/PREFRAME_FULL_PRODUCT_AUDIT.md) | 产品全貌审计 |
| [docs/PROJECT_BLUEPRINT.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/docs/PROJECT_BLUEPRINT.md) | 项目蓝图 |
| [docs/PUBLISHER_ENGINE_SPIKE.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/docs/PUBLISHER_ENGINE_SPIKE.md) | 发布引擎技术调研 |
| [README.md](file:///Users/YxzRainy/Documents/Vibecoding/Preframe/README.md) | 用户文档（部分过时） |
