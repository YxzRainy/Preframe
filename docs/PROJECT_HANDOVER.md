# Preframe 项目交接文档

> 更新日期：2026-08-29
> 项目根目录：`/Users/YxzRainy/Documents/Vibecoding/Preframe`
> 当前事实来源：`PROJECT_CONTEXT.md`、`docs/PROJECT_BLUEPRINT.md` 与实际代码。

## 一、产品边界

片策是本地运行的短视频生产工作台，同时提供 CLI 和 Next.js Web 界面。核心数据保存在本地 `output/` 和 `.piance/`，不依赖应用账号、数据库或云端协作。

发布中心、平台账号管理、自动上传、发布 worker、发布会话和发布任务已经永久移除。产品仍保留 `03_发布与复盘.md`，用于准备平台文案、人工发布后记录真实链接与数据，并据此复盘。

## 二、三文档工作流

新项目只生成：

1. `01_创作简报.md`：目标、核心观点、结构、硬约束和事实边界；
2. `02_拍摄执行稿.md`：最终逐字稿、固定镜头表、字幕、素材和拍摄状态；
3. `03_发布与复盘.md`：最终发布卡、平台文案、人工发布记录和真实数据复盘。

生成顺序为 `projectBrief → 01 → 02 → 03`。质量检查属于内部质量门，每份文档最多自动修复一次，不再生成独立质检报告。

## 三、关键实现

- 文档定义：`src/utils/documentDefinitions.ts`
- Prompt：`src/prompts/generatePrompt.ts`、`src/prompts/enhancePrompt.ts`
- 生成与质量门：`src/services/contentWorkflow.ts`、`src/services/documentGeneration.ts`
- 历史迁移：`src/services/projectMigration.ts`
- 镜头与执行计划：`src/services/shotTaskBuilder.ts`、`src/utils/executionPlan.ts`
- 文档编辑与版本：`web/components/DocumentWorkspace.tsx`、`src/services/documentVersionStore.ts`
- 项目依据包：`web/components/ProjectBasisPanel.tsx`
- 拍摄现场：`web/components/ShootingMode.tsx`

## 四、历史兼容

旧版 8/10 文档项目可以继续打开，并通过显式迁移生成三份新版工作稿。迁移成功前不删除旧文档；成功后旧文档进入 `.versions/`。

旧项目中的 `published` 阶段读取时映射为 `archived`。发布中心的本地历史数据不主动删除，但仓库不再包含读取或操作这些数据的代码。

## 五、必跑验证

```bash
npx tsc --noEmit
npm test
npm run build:web
```

生成链路修改后还要真实生成一个项目，确认三份文档均通过质量门、02 能解析镜头、03 不虚构数据。
