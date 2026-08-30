# 片策项目上下文

> 最后更新：2026-08-28
> 本文件是当前仓库的开发上下文。旧版“8/10 份独立策划文档”审计内容已废止；历史项目仍兼容，新项目按三份核心工作稿生成。

## 一、定位与边界

片策是一个本地运行的短视频内容生产工作台，面向个人创作者和小型内容团队。用户输入选题、平台、内容主体、领域、风格和目标用户后，系统使用模型生成一套一致的：

1. `01_创作简报.md`：创作目标、核心观点、硬约束和风险边界；
2. `02_拍摄执行稿.md`：最终逐字稿、镜头执行表、字幕、B-roll、素材和拍摄风险；
3. `03_发布与复盘.md`：最终发布卡、平台文案、置顶评论、发布记录和真实数据复盘。

产品原则：

- 一个项目只有一套最终口径；
- 可自动修复的问题必须在生成阶段修复，不能只生成质检报告；
- 拍摄、剪辑和发布使用同一份结构化事实；
- 发布后的真实数据回写项目和账号策略；
- 历史项目可继续打开，但不应影响新项目的三文档结构。

本地文件系统是数据真源，不使用登录、数据库或云端协作。

## 二、核心生成链路

```text
输入
  ↓
projectBrief（核心观点、内容结构、目标时长、必保留项、禁用表达、风险边界）
  ↓
01_创作简报
  ↓
02_拍摄执行稿
  ↓
03_发布与复盘
  ↓
自动质量门与镜头任务解析
```

关键文件：

- `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/utils/documentDefinitions.ts`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/generatePrompt.ts`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/prompts/enhancePrompt.ts`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/documentGeneration.ts`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/contentWorkflow.ts`

生成逻辑要求：

- 顺序生成，不并发生成互相依赖的文档；
- 01 失败时不继续生成孤立的 02/03；
- 每份文档最多自动修复一次；
- 上游重生成时自动重生成受影响的下游；
- 只在全部通过质量门后把临时目录移动到正式项目目录；
- `project.json` 写入 `workflowVersion: 2`、`workflowModel: "three-document-single-source"` 和 `qualityGate`。

## 三、自动质量门

质检是内部质量控制，不再生成用户可见的 `08_内容质检报告.md`。

当前至少检查：

- Markdown 一级/二级结构和占位语；
- 明显 AI 套话；
- 02 的目标时长与逐字稿长度；
- 02 的固定镜头表列：`时间｜最终口播｜画面/动作｜字幕重点｜B-roll/素材｜拍摄状态`；
- 初始镜头状态是否为“未拍”；
- 是否把再压缩、再同步、不能直接拍等返工留给用户；
- 是否保留 projectBrief 的禁用表达；
- 03 是否把未知信息写为“发布后填写”；
- 03 是否包含 24 小时、72 小时、7 天数据节点；
- 03 是否虚构高频评论或混入账号级通用话术。

质量门错误会触发同一文档的 repair prompt。质量门仍失败时，项目显示 partial/failed，而不是伪装为已完成。

## 四、拍摄与复盘

镜头任务由 `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/shotTaskBuilder.ts` 直接解析 `02_拍摄执行稿.md` 的镜头执行表。

历史 03/04/05/07/09 结构仍作为兼容回退，不作为新项目生成目标。

拍摄复盘只修订 `02_拍摄执行稿.md`，不再输出四份重复的脚本、分镜、清单和成片执行稿。应用修订时，镜头任务会按内容身份迁移既有拍摄状态、素材关系和备注。

## 五、历史项目迁移

旧项目不会在打开时静默删除文件。项目页会显示“历史项目”和“迁移到新版工作流”按钮。迁移服务位于 `/Users/YxzRainy/Documents/Vibecoding/Preframe/src/services/projectMigration.ts`，先基于旧文档生成并校验三份新稿，成功后才把旧文档归档到 `.versions/` 并切换 `workflowVersion: 2`。

## 五、Web 与 CLI

| 用途 | 命令/入口 |
| --- | --- |
| Web 开发 | `npm run dev` |
| Web 生产构建 | `npm run build:web` |
| CLI 生成 | `npm run generate` |
| CLI 修改 | `npm run refine` |
| CLI 素材扫描 | `npm run scan` |
| TypeScript 检查 | `npx tsc --noEmit` |
| 全量测试 | `npm test` |

Web 关键组件：

- `/Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/GenerationProgressModal.tsx`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/ProjectSidebar.tsx`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/ProjectDetailView.tsx`
- `/Users/YxzRainy/Documents/Vibecoding/Preframe/web/components/ShotExecutionWorkspace.tsx`

## 六、历史项目兼容

`LEGACY_DOCUMENT_DEFINITIONS` 登记旧版项目文件名。旧项目保留浏览、导出、旧镜头解析和旧视觉提示词封面生成能力；新项目只生成三份核心工作稿。

不要为了迁移旧项目而批量改写或删除用户的历史 Markdown。必要时通过重生成/另存版本逐步迁移。

## 七、数据与安全

- DeepSeek API Key 只保存在项目根目录 `.env`，不写入浏览器存储、Markdown、`project.json`、日志或配置备份；
- Web 默认只监听 `127.0.0.1`，并拒绝非 loopback Host 与跨来源请求；
- `.env`、`.piance/`、`output/` 和备份目录不得暴露；
- 模型调用统一通过 `src/services/modelClient.ts`；
- 项目文档修改先归档旧版本，不静默覆盖；
- 素材扫描只读取本地文件元数据，符号链接跳过。

## 八、验收标准

每次修改生成链路后至少运行：

```bash
npx tsc --noEmit
npm test
npm run build:web
```

最低验收结果：

- 新项目生成 3 份而不是 8/10 份核心文档；
- 不生成独立内容质检报告；
- 02 能被解析为镜头任务；
- 03 不编造发布数据；
- 上下游口径一致，禁用表达不回流；
- 历史项目仍可打开；
- 全部检查、测试和生产构建通过。
