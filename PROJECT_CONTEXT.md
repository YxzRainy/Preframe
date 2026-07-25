# 片策项目上下文（只读架构审计）

> 审计日期：2026-06-23  
> 项目目录：`/Users/YxzRainy/Documents/contentflow-agent`  
> 审计范围：源代码、配置、README、已生成项目结构。未安装依赖、未运行构建、未调用外部 API、未改动业务代码。  
> 安全说明：已确认 `.env` 存在，但本次审计没有读取或记录 API Key 的值。

## 一、项目基本信息

### 1.1 名称与定位

- **当前品牌名**：片策
- **英文包名 / CLI 名**：`piance`
- **副标题**：短视频前期策划工作台
- **浏览器标题**：`片策｜短视频前期策划工作台`
- **当前定位**：本地运行的短视频前期策划工具，同时提供 CLI 和 Web 可视化工作台。用户输入选题及内容画像后，由 DeepSeek 一次创建短视频内容项目，生成完整的 8 份前期策划包文档，并保存在本机。
- **产品边界**：无登录、无数据库、无多人协作、无云端部署逻辑，不是 SaaS；所有项目数据以本地目录和文件为准。

### 1.2 当前主要功能

1. 创建内容项目，输入选题、平台、内容主体、内容领域、风格、目标用户和补充要求。
2. 调用 DeepSeek OpenAI-compatible API，一次生成 8 份结构化 Markdown。
3. 在 Web 中以模块卡片或 Markdown 文档形式浏览结果。
4. 对单份文档输入意见并生成修改版，不覆盖原文。
5. 扫描服务器所在电脑的本地素材目录，生成素材索引 Markdown。
6. 浏览 `output/` 中的历史项目。
7. 导出当前 Markdown 或合并后的全部 Markdown。
8. 可选接入兼容图片生成接口，根据视觉提示词生成封面图片。
9. 保留 `generate`、`refine`、`scan` 三个 CLI 工作流。

### 1.3 开发阶段

当前属于**本地可运行 MVP / 作品集 Demo 阶段**。核心生成、修改、历史读取、素材扫描和文件输出链路已经存在；UI 已完成多轮重构，目前是暗色 Clean-Tech / Agent 工作台风格。系统还没有任务持久化状态、真实队列、流式进度、测试体系、权限边界和生产级错误观测。

### 1.4 运行方式

| 用途 | 命令 | 入口 |
| --- | --- | --- |
| Web 开发 | `npm run dev:web` | Next.js，默认 `http://localhost:3000` |
| Web 构建 | `npm run build:web` | `next build web --webpack` |
| Web 生产运行 | `npm run web` | `next start web` |
| CLI 开发入口 | `npm run dev -- --help` | `src/index.ts` |
| CLI 生成 | `npm run generate` | `src/index.ts generate` |
| CLI 修改 | `npm run refine` | `src/index.ts refine` |
| CLI 素材扫描 | `npm run scan` | `src/index.ts scan` |
| CLI 编译 | `npm run build` | `tsc` 输出到 `dist/` |
| CLI 编译产物 | `npm start -- generate` | `node dist/index.js generate` |

### 1.5 技术栈

- **运行时**：Node.js，`package.json` 要求 `>=18`
- **包管理器**：npm，存在 `package-lock.json`
- **语言**：TypeScript，CLI 和 Web 都启用严格类型检查
- **前端框架**：Next.js App Router（依赖范围 `next ^16.1.0`）
- **UI 基础**：React 19
- **样式方案**：普通全局 CSS；没有 Tailwind，没有 CSS Modules，没有大型 UI 库
- **Markdown 渲染**：`react-markdown` + `remark-gfm`
- **CLI**：`commander` + `inquirer` + `tsx`
- **模型 SDK**：`openai`
- **环境变量**：`dotenv`
- **构建体系**：Next.js Webpack 模式 + TypeScript `tsc`
- **未使用**：Vite、Vue、Electron、Tauri、数据库、ORM、独立 Express server

## 二、项目目录结构说明

```text
contentflow-agent/
├── src/                         # CLI 与 Web 共用的核心业务层
│   ├── commands/                # CLI generate/refine/scan 交互命令
│   ├── prompts/                 # 生成、修改提示词和模型输出解析
│   ├── services/                # 模型、图片、项目、文件、素材服务
│   ├── utils/                   # 文件名、Markdown、兼容数据等工具
│   └── index.ts                 # CLI 入口
├── web/
│   ├── app/                     # Next.js App Router 页面和 Route Handler
│   │   ├── api/                 # Web 后端 API
│   │   ├── projects/            # 历史列表与项目详情路由
│   │   ├── globals.css          # 全站样式和设计 token
│   │   ├── layout.tsx           # 根布局、metadata、TopBar
│   │   ├── manifest.ts          # PWA manifest
│   │   └── page.tsx             # 首页生成工作台
│   ├── components/              # Web UI 组件
│   ├── public/                  # favicon、品牌图标与 PWA 图标
│   ├── next.config.ts           # Next 配置
│   └── tsconfig.json            # Web TypeScript 配置
├── output/                      # 本地项目、Markdown、封面和 project.json
├── .env                         # 本机真实配置，已忽略，不应提交
├── .env.example                 # 环境变量模板
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json                # CLI / 共享代码 TypeScript 配置
└── README.md
```

关键说明：

- 没有 `pages/`，Web 使用 App Router。
- 没有单独的 `lib/`、`server/` 或数据库目录；`src/services/` 同时承担 CLI 和 Web 后端服务层。
- `output/` 是事实上的本地数据存储。当前已有多个真实生成项目，但该目录被 `.gitignore` 忽略。
- `web/.next/` 和 `node_modules/` 是生成物/依赖，不属于架构源码。

## 三、核心入口文件

| 类型 | 文件 | 作用 |
| --- | --- | --- |
| CLI 入口 | `src/index.ts` | 加载 `.env`，注册 Commander 的 `generate/refine/scan` 命令，统一处理异常 |
| Web 根入口 | `web/app/layout.tsx` | 根 HTML、metadata、favicon、manifest、全局 TopBar |
| Web 首页 | `web/app/page.tsx` | 渲染 `GenerateWorkspace` |
| 历史项目页 | `web/app/projects/page.tsx` | 渲染 `ProjectList` |
| 项目详情页 | `web/app/projects/[slug]/page.tsx` | 解码 slug，渲染 `ProjectDetailView` |
| 全局样式 | `web/app/globals.css` | 全站颜色、布局、组件、响应式与动画 |
| Web API 入口 | `web/app/api/**/route.ts` | Next.js Route Handler，没有独立 server 进程 |
| 核心工作流 | `src/services/contentWorkflow.ts` | generate/refine/scan/cover 的可复用业务编排 |
| 模型客户端 | `src/services/modelClient.ts` | DeepSeek OpenAI-compatible 调用与异常归类 |
| 文件项目层 | `src/services/projectManager.ts`、`projectReader.ts`、`fileWriter.ts` | 项目目录创建、读取、Markdown/JSON 写入 |
| Prompt | `src/prompts/generatePrompt.ts`、`refinePrompt.ts` | Prompt 构造、JSON 解析、结构验证、修复 Prompt |
| 根配置 | `package.json`、`tsconfig.json` | 脚本、依赖、CLI 编译规则 |
| Web 配置 | `web/next.config.ts`、`web/tsconfig.json` | 允许导入仓库外的 `src/`，扩展 `.js` 到 `.ts` 解析 |
| 环境变量模板 | `.env.example` | DeepSeek 和可选图片 API 配置 |

环境变量在 `src/services/modelClient.ts`、`src/services/imageClient.ts` 和 `web/app/api/config/route.ts` 中读取。只有服务端文件读取这些变量；没有发现 `NEXT_PUBLIC_*` 密钥变量。

## 四、当前 UI 架构

### 4.1 全局层

| 组件 | 文件 | 职责与状态 | 修改风险 |
| --- | --- | --- | --- |
| `TopBar` | `web/components/TopBar.tsx` | 全站品牌、当前路由语境、历史项目和新建任务入口；通过 `usePathname` 判断页面 | **低**，主要是 UI；注意不要破坏链接 |
| 根布局 | `web/app/layout.tsx` | metadata、图标、manifest、全局主题 class、TopBar | **中**，UI 可改；metadata 和图标引用应保留 |

### 4.2 首页生成工作台

| 组件 | 文件 | 主要职责 / props / state | 修改风险 |
| --- | --- | --- | --- |
| `GenerateWorkspace` | `web/components/GenerateWorkspace.tsx` | 首页容器；维护表单、文件列表、当前文件、项目 slug、loading/error、抽屉状态；请求 `/api/config` 和 `/api/generate` | **高**，同时包含页面布局和生成业务状态，改 UI 时必须保留提交逻辑 |
| `NewTaskDrawer` | `web/components/NewTaskDrawer.tsx` | 新建任务抽屉；`value/onChange/onSubmit/onClose/loading/error`；内容主体使用自由输入 + datalist + 快捷 chip | **中**，表单字段名必须与 API 兼容 |
| `ProjectSidebar` | `web/components/ProjectSidebar.tsx` | 当前项目摘要、主文档列表、额外文档入口、新建按钮；接收项目详情、当前文件、切换回调 | **中**，文档选择属于交互逻辑 |
| `AutomationProgress` | `web/components/AutomationProgress.tsx` | 展示创建项目到导出的五阶段提示；状态由 `loading/ready` 推导 | **低**，目前是页面状态提示，不是后端步骤 |
| `ResultTabs` | `web/components/ResultTabs.tsx` | 画布/列表视图切换、8 文档模块、选择当前文档、生成中/空状态 | **中**，依赖共享文档定义 |
| `ContentModuleCard` | `web/components/ContentModuleCard.tsx` | 8 类文档卡片；有静态骨架/示例，存在真实文件时展示真实摘要 | **低**，展示为主；不要改坏 filename 映射 |
| `HomeAgentConsole` | `web/components/HomeAgentConsole.tsx` | 首页右侧状态控制台；显示模型、当前操作、能力和会话状态 | **低**，只展示真实可用能力 |

### 4.3 项目详情工作台

| 组件 | 文件 | 主要职责 / props / state | 修改风险 |
| --- | --- | --- | --- |
| `ProjectDetailView` | `web/components/ProjectDetailView.tsx` | 拉取项目详情；维护当前文件、refine、scan、cover、提示与错误状态；执行导出/复制 | **高**，详情页所有业务操作集中在此 |
| `DocumentWorkspace` | `web/components/DocumentWorkspace.tsx` | 当前 Markdown 的标题栏、状态、错误/成功条、复制和导出入口 | **中**，展示为主但触发导出回调 |
| `MarkdownPreview` | `web/components/MarkdownPreview.tsx` | `react-markdown` + GFM 渲染 Markdown | **低**，可安全调整排版样式 |
| `AgentToolsPanel` | `web/components/AgentToolsPanel.tsx` | refine、素材扫描、封面生成、快捷修改模板、导出和运行信息 | **高**，UI 与多个 API 操作回调耦合 |
| `StatusBadge` | `web/components/StatusBadge.tsx` | 通用状态标签 | **低** |
| `VisualSurface` / `AccentBadge` | `web/components/VisualSurface.tsx` | 统一物理纵深和强调色视觉容器 | **低**，纯 UI 基础组件 |

### 4.4 历史项目

| 组件 | 文件 | 职责 | 修改风险 |
| --- | --- | --- | --- |
| `ProjectList` | `web/components/ProjectList.tsx` | 客户端请求 `/api/projects`，展示项目摘要、文件数、更新时间和详情链接 | **中**，列表 UI 可改，保留 fetch 和 slug 编码 |

当前没有通用全局状态管理库。页面状态使用 React `useState/useEffect`；项目的长期状态来自磁盘文件。首页刷新后，当前内存中的表单和结果会丢失，但生成结果仍在 `output/`，可以从历史项目重新进入。

## 五、当前业务流程

### 5.1 创建内容项目到 8 份文档

1. 用户打开 `/`，`web/app/page.tsx` 渲染 `GenerateWorkspace`。
2. `GenerateWorkspace` 请求 `GET /api/config` 获取当前模型显示名；失败时 UI 使用 `DeepSeek V4 Pro` 作为显示回退。
3. 用户点击“创建内容项目”，打开 `NewTaskDrawer`。
4. 用户填写：
   - `topic`：选题
   - `platform`：平台
   - `contentSubject`：内容主体，自由文本
   - `contentDomain`：内容领域，自由文本
   - `style`：风格
   - `targetUser`：目标用户
   - `extra`：补充要求
5. 抽屉执行 `onSubmit`，`GenerateWorkspace` 向 `POST /api/generate` 发送 JSON。
6. `web/app/api/generate/route.ts` 校验必填字段，并兼容旧字段 `accountType`。
7. API 调用 `src/services/contentWorkflow.ts` 的 `generateProject()`。
8. `generateProject()` 使用 `buildGeneratePrompt()` 组装一个要求返回严格 JSON 的 Prompt，然后通过 `callModel()` 请求 DeepSeek。
9. `parseGeneratedContent()` 解析并验证八个字符串字段；如果 JSON 或结构不合格，会再调用模型一次执行修复。修复后仍失败则终止，不创建完整项目。
10. 模型内容通过验证后，`createProjectDirectory()` 根据选题创建唯一目录；重名追加 `_2`、`_3`。
11. 8 份内容分别写为：
    - `01_项目概览.md`
    - `02_选题拆解.md`
    - `03_口播脚本.md`
    - `04_分镜与剪辑节奏.md`
    - `05_拍摄清单.md`
    - `06_封面标题与发布文案.md`
    - `07_视觉参考提示词.md`
    - `08_内容质检报告.md`
12. 同目录写入 `project.json`，保存输入、实际模型名和生成时间，不保存 API Key。
13. API 返回 `{ success, projectSlug, files }`。
14. 首页将返回文件放入 React state，`ResultTabs` 显示 8 个模块并允许切换到 Markdown 预览。

### 5.2 修改当前文件

1. 用户在 `/projects/[slug]` 选择一份 Markdown。
2. 在 `AgentToolsPanel` 输入修改意见。
3. `ProjectDetailView` 请求 `POST /api/refine`，参数为 `projectSlug/fileName/feedback`。
4. 服务端读取原文，构造 refine Prompt，调用同一个 `callModel()`。
5. 返回内容必须是以原文件名为 key 的 JSON；失败时同样执行一次模型修复。
6. 新文件以 `_修改版.md` 保存；Web 服务会在重名时追加 `_修改版_2` 等，不覆盖原文。
7. 前端重新拉取项目详情并切换到新文件。

注意：CLI 的 `src/commands/refine.ts` 直接写固定 `_修改版.md`，重复执行可能覆盖上一次同名修改版；这一点与 Web 行为不同。

### 5.3 导出与历史项目

- 当前文件导出：浏览器将当前内存中的 Markdown 创建为 Blob 并下载。
- 全部导出：`ProjectDetailView` 在浏览器端把项目所有 Markdown 合并为一个文件后下载，不是 ZIP。
- 历史项目：`/projects` 请求 `GET /api/projects`，从 `output/` 读取项目目录和 `project.json`；点击后进入 `/projects/[slug]`。
- 详情页：`GET /api/projects/[slug]` 返回 metadata、所有 Markdown 和封面列表。

### 5.4 素材索引

1. 用户在项目详情右侧输入本机素材目录路径。
2. `POST /api/scan` 调用 `scanProjectAssets()`。
3. 服务端递归读取该目录的普通文件，跳过符号链接。
4. 根据扩展名和文件名推测用途，不识别图片或视频画面。
5. 将结果写入当前项目的 `00_素材索引.md`，随后前端刷新项目详情。

## 六、数据结构说明

### 6.1 生成输入

文件：`src/prompts/generatePrompt.ts`

```ts
interface GenerateInput {
  topic: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  style: string;
  targetAudience: string;
  extraRequirements?: string;
}
```

Web 表单在 `web/components/NewTaskDrawer.tsx` 使用相近结构，但命名为 `targetUser` 和 `extra`，由 API 转换成核心结构。

### 6.2 模型生成结果

文件：`src/prompts/generatePrompt.ts`

模型 JSON 的八个 key 映射为 8 个文件：

```text
projectOverview          -> 01_项目概览.md
topicAnalysis            -> 02_选题拆解.md
spokenScript             -> 03_口播脚本.md
storyboardAndEditing     -> 04_分镜与剪辑节奏.md
shootingChecklist        -> 05_拍摄清单.md
coverTitlesAndPostCopy   -> 06_封面标题与发布文案.md
visualPrompts            -> 07_视觉参考提示词.md
qualityCheckReport       -> 08_内容质检报告.md
```

文件：`src/services/contentWorkflow.ts`

```ts
interface ContentFile { name: string; content: string }
interface GenerateResult { projectSlug: string; files: ContentFile[] }
interface GeneratedCover { name: string; ratio: CoverRatio }
```

### 6.3 项目元数据

文件：`src/services/projectReader.ts`

```ts
interface ProjectMetadata {
  topic?: string;
  platform?: string;
  accountType?: string;       // 旧字段
  contentSubject?: string;    // 新字段
  contentDomain?: string;
  style?: string;
  targetAudience?: string;
  extraRequirements?: string;
  model?: string;
  generatedAt?: string;
  [key: string]: unknown;
}
```

```ts
interface ProjectSummary {
  slug: string;
  name: string;
  generatedAt: string;
  platform: string;
  contentSubject: string;
  contentDomain: string;
  fileCount: number;
}

interface ProjectDetail {
  slug: string;
  name: string;
  metadata: ProjectMetadata;
  files: ProjectFile[];
  covers: CoverSummary[];
}
```

旧 `accountType` 会通过 `src/utils/contentProfile.ts` 映射为较新的内容主体/领域。实际 `output/` 同时存在新旧两种 `project.json`，兼容层目前是必要的。

### 6.4 工作流步骤与状态

当前没有服务端持久化的 workflow 数据结构，也没有任务表。步骤主要在 UI 中硬编码：

- 首页 8 文档步骤：`GenerateWorkspace.tsx` 和 `ResultTabs.tsx`
- 五阶段流程：`AutomationProgress.tsx`
- 项目详情 timeline：`ProjectSidebar.tsx`

状态由当前页面内存推导，常见值包括：

- 文档：`未生成`、`生成中`、`已生成`、`可修改`
- 流程：`waiting`、`active`、`complete`
- 操作：`loading/refining/scanning/generatingCover`

这些状态不是后台任务状态；页面刷新后不会恢复“生成中”阶段。

### 6.5 素材索引

文件：`src/services/assetScanner.ts`

```ts
interface AssetInfo {
  name: string;
  type: string;
  size: number;
  modifiedAt: Date;
  subfolder: string;
  possibleUse: string;
}
```

输出是 Markdown 表格，没有独立 JSON 索引或数据库记录。

### 6.6 历史项目

历史项目不是独立数据结构或服务，而是 `output/` 下的文件夹集合。文件夹名即 slug，`project.json` 是项目元数据，Markdown 文件数用于列表统计。没有稳定 UUID、schemaVersion、updatedAt 或独立 status 字段。

## 七、API 和后端逻辑

所有 Route Handler 均位于 `web/app/api/`，运行时为 Node.js。

| API | 文件 | 请求 | 返回 | 外部模型 / 文件 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/config` | `web/app/api/config/route.ts` | 无 | `success/model/modelLabel` | 读取 `DEEPSEEK_MODEL`，不返回 Key | 可用 |
| `POST /api/generate` | `web/app/api/generate/route.ts` | topic、platform、contentSubject/contentDomain、style、targetUser、extra；兼容 accountType | slug + 8 文件 | 调 DeepSeek；写项目目录、MD、JSON | 核心可用，依赖有效 Key/网络/模型 |
| `GET /api/projects` | `web/app/api/projects/route.ts` | 无 | 项目摘要数组 | 读 `output/` | 可用 |
| `GET /api/projects/[slug]` | `web/app/api/projects/[slug]/route.ts` | URL slug | metadata/files/covers | 读项目 JSON、MD 和封面目录 | 可用 |
| `POST /api/refine` | `web/app/api/refine/route.ts` | projectSlug、fileName、feedback | 新文件名和内容 | 调 DeepSeek；读原文、写修改版 | 可用，依赖模型 |
| `POST /api/scan` | `web/app/api/scan/route.ts` | projectSlug、assetPath | 索引文件信息 | 递归读取用户路径；写 `00_素材索引.md` | 可用，仅适合受信任本机环境 |
| `GET /api/cover` | `web/app/api/cover/route.ts` | 无 | 是否配置、模型、比例 | 读取 IMAGE 环境变量 | 可用；当前环境未配置图片 API |
| `POST /api/cover` | 同上 | projectSlug、prompt、ratio | 生成封面信息 | 调图片 API；写 `covers/` | 代码已实现；当前配置下不可执行 |
| `GET /api/projects/[slug]/covers/[filename]` | 对应动态 route | slug + filename | 图片二进制 | 读本地封面文件 | 有封面时可用 |

当前 API 没有认证、鉴权、速率限制、请求队列或成本限制。它只应绑定在受信任的本地开发环境；若暴露到局域网/公网，模型调用和任意本地路径扫描会形成安全风险。

## 八、AI 模型调用逻辑

### 8.1 DeepSeek

- 客户端：`src/services/modelClient.ts`
- SDK：`openai`
- `baseURL`：`DEEPSEEK_BASE_URL`，代码默认 `https://api.deepseek.com`
- API Key：`DEEPSEEK_API_KEY`
- 模型：`DEEPSEEK_MODEL`；代码默认 `deepseek-v4-flash`
- 当前本机配置模型：`deepseek-v4-pro`
- temperature：`0.7`
- system message：短视频内容策划助手，要求结构清晰并可直接用于拍摄准备

`callModel(prompt)` 每次创建 OpenAI 客户端并调用 `chat.completions.create()`。它对 Key 缺失、网络失败、API 报错、空返回做了中文错误归类。没有显式流式返回、取消、任务 ID 或自定义超时策略。

### 8.2 生成 Prompt

文件：`src/prompts/generatePrompt.ts`

- 把所有输入画像和 8 份文档的明确章节要求放入一次用户 Prompt。
- 要求模型只返回合法 JSON，八个字段的值分别是完整 Markdown。
- `06_封面标题与发布文案.md` 有额外结构校验，要求标题候选、标题评分、推荐理由、小红书/抖音发布文案和标签建议。
- 首次解析失败后，`buildGenerateRepairPrompt()` 会把原始输出再次交给模型修复；只重试一次。

优点是一次请求能得到完整内容包；风险是输出较长，单次响应可能截断，任何一部分格式错误都可能触发整包修复并增加成本。

### 8.3 Refine Prompt

文件：`src/prompts/refinePrompt.ts`

- 输入原文件名、文档标签、原文和用户意见。
- 要求返回以原文件名为 key 的 JSON。
- 对封面标题与发布文案修改版继续执行结构校验，并兼容旧项目的 `05_封面标题.md`。
- 同样支持一次模型修复。

Web 可以修改任意当前 Markdown；CLI 只提供口播、分镜与剪辑节奏、封面标题与发布文案或三者全部，并兼容旧文件名。

### 8.4 素材与图片

- 素材索引不调用 AI，只按文件名和扩展名做规则判断。
- 封面生成使用 `src/services/imageClient.ts`，不是 `openai` SDK，而是对可配置 URL 执行 `fetch`。
- 支持 `1:1/3:4/4:3/9:16/16:9`，兼容常见 base64 或 URL 返回格式。
- 当前 `.env` 未配置 `IMAGE_API_*`，因此 UI 可展示入口，但实际生成会提示未配置。

### 8.5 Mock / fallback

- `ContentModuleCard.tsx` 有 8 类静态预览骨架；未生成时用于展示内容包形态，不是模型数据。
- `AutomationProgress.tsx` 的阶段进度由 `loading/ready` 推导，不是服务端持久化进度。
- `HomeAgentConsole.tsx` 的能力描述来自当前项目能力和页面状态。
- `AgentToolsPanel.tsx` 的运行信息包含固定状态文案，不是持久化日志。
- 模型显示在配置请求失败时回退为 `DeepSeek V4 Pro`；这可能与真实环境变量不一致。

## 九、文件读写与输出目录

### 9.1 输出位置

文件：`src/services/projectManager.ts`

```ts
const OUTPUT_DIR = path.resolve(process.cwd(), "output");
```

- 8 份 Markdown、修改版、素材索引、`project.json` 和 `covers/` 都位于 `output/<项目 slug>/`。
- 历史项目就是这些目录，没有另一个存储位置。
- 项目 slug 来自经 `sanitizeFilename()` 清理的选题，保留中文，替换非法路径字符，最大 80 字符。
- 重名项目追加数字后缀。
- 项目和封面路径均有 basename / 路径越界检查。

### 9.2 硬编码与可配置项

硬编码：

- 根输出目录名固定为 `output`，并依赖进程当前工作目录 `process.cwd()`。
- 8 个基础文件名位于 `src/utils/documentDefinitions.ts` 的共享文档定义中。
- 素材索引名固定为 `00_素材索引.md`。
- 封面目录固定为 `covers/`。

可配置：

- DeepSeek Key、base URL、模型。
- 图片 Key、完整 API URL、模型、尺寸字段名、额外 JSON body。
- 素材目录由用户输入，可是服务端有权限读取的任意本地路径。

### 9.3 浏览器与本地权限

浏览器本身不能直接递归读取任意本地目录。当前方案是用户在网页输入路径，再由 Next.js 服务端读取。因此：

- Web 服务与素材必须在同一台电脑或同一可访问文件系统。
- 路径选择不是浏览器原生目录选择器，用户必须手填路径。
- `scan` API 当前没有允许目录白名单；本地单用户环境可用，公开部署不安全。
- 浏览器下载使用 Blob，不会改写原项目文件。
- 剪贴板复制依赖浏览器权限和安全上下文，通常在 localhost 可用。

## 十、当前已完成功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 创建内容项目 | **已完成** | CLI 和 Web 均可输入完整画像；内容主体/领域支持自由文本 |
| 生成 8 份前期策划包文档 | **已完成** | 核心链路和结构校验已实现；依赖 DeepSeek 配置与网络 |
| 展示文档 | **已完成** | 首页模块视图、详情 Markdown 渲染均存在 |
| 修改当前文件 | **已完成，有差异** | Web 自动版本化；CLI 重复修改可能覆盖同名 `_修改版` |
| 导出 Markdown | **已完成** | 当前文件和全部合并导出；未提供 ZIP/逐文件批量包 |
| 历史项目 | **已完成** | 基于 `output/` 读取；无搜索、删除、归档和分页 |
| 素材索引 | **已完成（基础版）** | 文件级扫描，不做视觉识别；要求手填本地路径 |
| 封面图片生成 | **部分完成** | 前后端代码已接入；当前本机未配置图片 API，未发现已生成封面 |
| favicon / PWA 图标 | **已完成** | `web/public/` 和 `web/app/` 中有常用尺寸与 manifest 引用 |
| 品牌名称 | **已完成** | 页面、metadata、README、package/CLI 已改为“片策” |
| UI 三栏工作台 | **已完成，仍需整理** | 暗色 Agent 工作台已存在，响应式已写；CSS 有历史样式叠加问题 |
| 持久化任务状态 | **未完成** | 当前没有后台 job 或事件存储 |
| 持久化活动日志 | **未完成** | 当前为页面推导/固定文案 |
| 规则配置 | **未完成** | 没有对应后端配置模块 |
| 测试体系 | **未完成** | 未发现 unit/integration/e2e 测试文件，也没有 test 脚本 |

## 十一、当前已知问题

### 11.1 UI 与状态

1. `web/app/globals.css` 超过千行，叠加了多轮浅色、暗色、工作室和 Clean-Tech 覆盖层；存在重复 token 和选择器，实际效果依赖 CSS 顺序，维护风险高。
2. 首页工作流进度不是后端真实进度，只能表示“未开始/请求中/已拿到结果”。
3. 首页结果保存在 React 内存，刷新后丢失当前上下文，需要从历史项目重新进入。
4. `ProjectSidebar.tsx` 的进度显示基于当前已读取主文档数量，仍不是服务端工作流状态。
5. `ProjectList.tsx` 的文件数会把修改版和素材索引也计算进去，因此可能大于 8，不等于主文档完成度。
6. TopBar 根据路由推断当前项目，没有跨页面全局项目状态。

### 11.2 API 与模型

1. 没有认证、速率限制、费用保护或并发控制，不应直接对公网开放。
2. 生成 8 文档采用单个长 JSON 响应，容易受模型输出长度和 JSON 完整性影响；修复请求会额外消耗一次模型调用。
3. 没有流式输出、取消操作或后台 job，HTTP 中断时用户无法恢复任务状态。
4. `modelClient.ts` 的代码回退模型和 `.env.example` 是 `deepseek-v4-flash`，当前 `.env` 是 `deepseek-v4-pro`，而首页配置失败时又固定显示 Pro；三处默认语义不统一。
5. API 多数把异常映射为普通 JSON 错误，但缺少错误码体系和服务端结构化日志。
6. Web refine 可以对所有 Markdown 发起修改，包括素材索引或修改版，缺少允许文件类别约束。
7. 图片接口完全依赖第三方兼容格式；当前未配置，尚无本机成功样例可证明供应商兼容性。

### 11.3 文件与数据

1. `OUTPUT_DIR` 依赖 `process.cwd()`；如果从不同目录启动，可能读写到错误位置。
2. 没有原子事务或回滚；8 文件写入中途失败，可能留下不完整项目目录。
3. 同名项目的“检查后创建”在高并发下可能发生竞争。
4. `projectReader.ts` 对损坏或不可读的 `project.json` 有容错，但会把错误吞掉并返回空元数据，不利于发现数据损坏。
5. `project.json` 没有 schemaVersion、稳定项目 ID、updatedAt、status 和版本列表；未来迁移会困难。
6. 素材扫描没有文件数量、目录深度或大小限制，也没有默认忽略隐藏目录、`node_modules` 等大型目录；误扫可能耗时很长。
7. 素材索引会记录源目录绝对路径，分享 Markdown 前需要考虑隐私。
8. CLI refine 与 Web refine 的版本命名策略不一致。

### 11.4 工程质量

1. 没有自动化测试、lint 脚本或 CI 配置。
2. 本次结构升级后已要求执行 `npm run build` 和 `npm run build:web`，接手者应以最新构建结果为准。
3. 当前 `git status` 显示项目文件整体为未跟踪状态，说明仓库可能尚未完成首次提交，或当前目录不在预期 Git 历史中；**需要人工确认并先建立可靠版本基线**。
4. README 的后续方向需要随产品边界继续更新。
5. 缺少 `.nvmrc`、`.node-version` 或 Volta 固定版本，只能确定 Node `>=18`。

## 十二、最近 UI 改动情况

根据现有代码和样式层可以判断，UI 经历了以下路线：

1. 最初是浅色普通后台 / 卡片式 Web Demo。
2. 中间尝试过浅色三栏内容工作台和纸张感 ContentFlow Studio。
3. 后来改为暗色 AI 自动化工作台，加入流程节点、Agent 控制台、模块卡片和状态效果。
4. 最新样式方向是 **Clean-Tech 物理纵深**：保留暗色墨绿基调，但通过统一顶光、低饱和边框和真实悬浮感弱化霓虹。
5. 当前仍保留六卡片 content pipeline grid；尚未变成可自由拖拽的 Workflow Canvas。
6. `VisualSurface.tsx` 提供可复用的深度层级，`globals.css` 末尾 Clean-Tech 区域控制最新视觉覆盖。

当前主要视觉组件：

- 整体骨架：`GenerateWorkspace.tsx`、`ProjectDetailView.tsx`
- 顶栏：`TopBar.tsx`
- 左侧流程：`ProjectSidebar.tsx`
- 中间流程与卡片：`AutomationProgress.tsx`、`ResultTabs.tsx`、`ContentModuleCard.tsx`
- 右侧控制台：`HomeAgentConsole.tsx`、`AgentToolsPanel.tsx`
- 深度组件：`VisualSurface.tsx`
- 全局配色与所有主要视觉规则：`web/app/globals.css`

继续改 UI 最容易从上述组件和 `globals.css` 的最终主题层入手。不要再在 CSS 文件末尾无限追加覆盖；应先收敛 token 和删除确认无用的旧主题规则，但这应在建立视觉回归截图后单独执行。

## 十三、哪些文件可以安全改

以下文件主要负责展示，保持 props 契约和回调不变时可较安全修改：

- `web/components/TopBar.tsx`
- `web/components/AutomationProgress.tsx`
- `web/components/ContentModuleCard.tsx`
- `web/components/HomeAgentConsole.tsx`
- `web/components/MarkdownPreview.tsx`
- `web/components/StatusBadge.tsx`
- `web/components/VisualSurface.tsx`
- `web/app/globals.css`
- `web/app/layout.tsx` 中的非 metadata 布局部分
- `web/public/` 的品牌展示资源（若不改变已有 URL）

可改但需保留交互契约：

- `NewTaskDrawer.tsx`：保留字段、校验和 `onSubmit` 数据结构
- `ProjectSidebar.tsx`：保留文件选择和新建回调
- `ResultTabs.tsx`：保留文件名前缀映射与 `onSelect`
- `DocumentWorkspace.tsx`：保留复制/导出回调
- `ProjectList.tsx`：保留 API 请求和 slug URL 编码

适合抽离为配置的内容：文档名称、UI 状态文案、内容主体快捷项、平台/风格选项、工作流阶段。当前主文档定义已经集中到 `src/utils/documentDefinitions.ts`。

## 十四、哪些文件不要乱改

| 高风险区域 | 文件 | 原因 |
| --- | --- | --- |
| 核心编排 | `src/services/contentWorkflow.ts` | 决定模型调用、解析、目录创建和写入顺序 |
| DeepSeek 客户端 | `src/services/modelClient.ts` | 密钥、模型、API 错误处理的唯一入口 |
| Prompt 与解析 | `src/prompts/generatePrompt.ts`、`refinePrompt.ts` | 任何字段变化都可能让模型返回与写文件映射失配 |
| 项目路径 | `src/services/projectManager.ts` | 涉及目录越界保护、slug 和根输出位置 |
| 项目读取 | `src/services/projectReader.ts` | 新旧 metadata 兼容和历史项目展示依赖它 |
| 文件写入 | `src/services/fileWriter.ts` | 所有持久化共用 |
| 素材扫描 | `src/services/assetScanner.ts` | 直接读取用户本地目录，涉及性能与隐私 |
| 图片客户端 | `src/services/imageClient.ts` | 第三方响应兼容、远程下载和文件写入 |
| API Route | `web/app/api/**/route.ts` | 前端契约、安全边界和本地文件权限 |
| 页面业务容器 | `GenerateWorkspace.tsx`、`ProjectDetailView.tsx` | UI 与所有业务状态/请求耦合 |
| 配置 | `package.json`、两个 `tsconfig.json`、`web/next.config.ts` | CLI/Web 双构建和跨目录导入依赖现有设置 |
| 环境配置 | `.env`、`.env.example` | 不得提交真实 Key；变量名与服务端代码必须同步 |

如果要调整 8 份文档的文件名或数据结构，必须同步共享文档定义、Prompt、解析、工作流、项目读取和 UI 展示，不能只改某一个位置。

## 十五、下一步建议

### 15.1 UI 继续重构

1. 先冻结当前页面并建立 1440/1920/移动端截图基线。
2. 将 `globals.css` 拆为 token、layout、components、markdown、responsive 五个普通 CSS 文件，或至少删除已确认无效的历史主题层。
3. 继续让文档定义配置承担文件名、编号、标题、卡片片段和兼容旧名的责任。
4. Agent 控制台只展示真实能力：模型、最近操作、当前 HTTP 状态、实际文件数；没有后端数据的功能不要写成可用能力。
5. 增强真实工具交互，而不是继续加光效：项目搜索、文档版本对比、缺失文件提示、操作结果可追溯。

### 15.2 功能稳定性

1. 增加 `npm run lint`、`npm test` 和至少三类集成测试：Prompt 解析、路径安全、项目读写。
2. 将项目写入改为临时目录 + 完成后原子 rename，避免半成品。
3. 对素材扫描增加允许根目录、最大文件数、最大深度、忽略目录和取消机制。
4. 为 API 定义统一错误码，保留服务端详细日志但不向浏览器泄露敏感信息。
5. 明确本地服务绑定地址；若允许局域网访问，至少增加本地访问令牌。
6. 统一 CLI/Web refine 的版本命名策略。

### 15.3 数据结构整理

1. 为 `project.json` 增加 `schemaVersion`、`id`、`createdAt`、`updatedAt`、`status`、`inputs`、`documents`。
2. 编写只读迁移/兼容策略，继续支持现有 `accountType` 项目，不直接破坏旧目录。
3. 将 8 文档定义放入共享常量，由 Prompt、服务和 UI 共同消费。
4. 区分“基础文档数”和“全部 Markdown 数”，避免历史列表进度失真。
5. 将 refine 版本关系写入 metadata，支持版本树和对比，而不是只靠文件名猜测。

### 15.4 Agent 生成质量

1. 将一次超长 8 文档生成拆为“策划纲要 + 分文档并发生成”，同时保存阶段状态；质量和可恢复性会更好，但 API 成本/并发需要控制。
2. 给不同平台、领域和时长建立可选 Prompt profile，不要把所有约束堆在一个通用 Prompt。
3. 保存 promptVersion、model、temperature 和生成耗时，方便复现与对比。
4. 为医学、金融、法律等领域增加明确的风险提示和人工审核状态。
5. 对标题数量、脚本时长、分镜表字段建立确定性程序校验，减少只靠模型自律。

### 15.5 作品集展示

1. 提供一个不消耗 API 的内置演示项目，并明确标注“示例数据”。
2. 展示真实链路：输入 → 生成中 → 8 文档 → 单文档 refine → 输出目录。
3. 在 README 增加架构图、Web 截图、错误处理说明和隐私边界。
4. 清理 Git 状态并建立首个可回退版本；任何后续 UI 大改都应独立提交。
5. 图片生成属于可选集成，作品集演示时应明确“需自行配置兼容 API”。

## 十六、交接摘要

片策是一个 Node.js + TypeScript 项目，在同一仓库中同时维护 Commander/Inquirer CLI 和 Next.js App Router Web 工作台。用户输入选题及内容画像后，服务端通过 OpenAI SDK 调用 DeepSeek，将一次结构化 JSON 响应解析为 8 份 Markdown，并写入本地 `output/`；历史项目、修改版、素材索引和可选封面也都基于文件系统。当前 DeepSeek 模型配置为 `deepseek-v4-pro`，核心生成、refine、历史读取、导出和基础素材扫描已经可用。UI 已从浅色后台迭代为暗色 Clean-Tech 三栏 Agent 工作台，控制台只应呈现真实可用能力。最优先的下一步不是继续增加视觉效果，而是建立 Git 基线和测试，继续稳定共享文档定义与项目 schema，清理多轮叠加的全局 CSS；之后再考虑流式任务、可恢复生成和版本对比。
