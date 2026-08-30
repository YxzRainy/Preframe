import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "preframe-phase5-"));
const dataDir = path.join(sandbox, ".piance");
const outputDir = path.join(sandbox, "output");
process.env.PIANCE_DATA_DIR = dataDir;
process.env.PIANCE_OUTPUT_DIR = outputDir;
await mkdir(outputDir, { recursive: true });

const { exportProjectArchive, importProjectArchive } = await import("../services/projectArchive.js");
const { validateArchiveFiles } = await import("../services/portableArchive.js");
const { listTrashProjects, moveProjectToTrash, restoreProjectFromTrash } = await import("../services/projectManager.js");
const { createConfigBackup, restoreConfigBackup } = await import("../services/configBackup.js");
const { clearDiagnostics, listDiagnostics, recordDiagnostic } = await import("../services/diagnosticLog.js");
const { inspectDataMigration, runDataMigration } = await import("../services/dataMigration.js");
const { validateModelConfigInput } = await import("../services/modelClient.js");
const { migrateProjectToCurrentWorkflow } = await import("../services/projectMigration.js");
const { readStage } = await import("../services/projectStage.js");

after(async () => {
  delete process.env.PIANCE_DATA_DIR;
  delete process.env.PIANCE_OUTPUT_DIR;
  await rm(sandbox, { recursive: true, force: true });
});

async function createProject(slug: string, metadata: Record<string, unknown> = {}): Promise<string> {
  const directory = path.join(outputDir, slug);
  await mkdir(path.join(directory, "covers"), { recursive: true });
  await writeFile(path.join(directory, "project.json"), `${JSON.stringify({ projectName: slug, topic: slug, ...metadata }, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "01_项目概览.md"), `# ${slug}\n`, "utf8");
  return directory;
}

test("项目归档完整往返文本与二进制文件，重名时不覆盖", async () => {
  const directory = await createProject("archive-source");
  const binary = Buffer.from([0, 1, 2, 127, 128, 255]);
  await writeFile(path.join(directory, "covers", "cover.png"), binary);
  const archive = await exportProjectArchive("archive-source");
  assert.ok(archive.files.some((file) => file.path === "covers/cover.png"));

  const imported = await importProjectArchive(archive);
  assert.equal(imported.slug, "archive-source_2");
  assert.deepEqual(await readFile(path.join(outputDir, imported.slug, "covers", "cover.png")), binary);
  assert.equal(await readFile(path.join(directory, "01_项目概览.md"), "utf8"), "# archive-source\n");
});

test("项目归档拒绝路径穿越和内容篡改", () => {
  assert.throws(() => validateArchiveFiles([{ path: "../project.json", size: 2, sha256: "x", contentBase64: "e30=" }]), /不安全路径/u);
  assert.throws(() => validateArchiveFiles([{ path: "project.json", size: 2, sha256: "bad", contentBase64: "e30=" }]), /校验和不匹配/u);
});

test("回收站支持列表与冲突安全恢复", async () => {
  await createProject("trash-source", { projectName: "待恢复项目" });
  await moveProjectToTrash("trash-source");
  await createProject("trash-source", { projectName: "当前同名项目" });
  const trashed = (await listTrashProjects()).find((item) => item.originalSlug === "trash-source");
  assert.ok(trashed);
  assert.equal(trashed?.name, "待恢复项目");
  const restored = await restoreProjectFromTrash(trashed!.id);
  assert.equal(restored.slug, "trash-source_2");
  assert.equal((await listTrashProjects()).some((item) => item.id === trashed!.id), false);
});

test("配置备份排除旧模型配置文件，只恢复本地非密钥设置", async () => {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "model-config.json"), `${JSON.stringify({ apiKey: "sk-legacy-secret-123456" })}\n`, "utf8");
  await writeFile(path.join(dataDir, "ideas.json"), "{\"items\":[{\"title\":\"备份前\"}]}\n", "utf8");
  const backup = await createConfigBackup();
  assert.doesNotMatch(JSON.stringify(backup), /sk-legacy-secret/u);
  assert.equal(backup.files.some((file) => file.path === "model-config.json"), false);

  await writeFile(path.join(dataDir, "ideas.json"), "{\"items\":[]}\n", "utf8");
  await rm(path.join(dataDir, "model-config.json"));
  const restored = await restoreConfigBackup(backup);
  assert.ok(await readFile(restored.rollbackBackupPath, "utf8"));
  assert.match(await readFile(path.join(dataDir, "ideas.json"), "utf8"), /备份前/u);
  await assert.rejects(readFile(path.join(dataDir, "model-config.json"), "utf8"), { code: "ENOENT" });
});

test("诊断日志脱敏 API Key 与授权信息", async () => {
  await clearDiagnostics();
  await recordDiagnostic(new Error("apiKey=sk-sensitive-123456 Authorization: Bearer token-secret"), "generate");
  const entries = await listDiagnostics();
  assert.equal(entries.length, 1);
  assert.doesNotMatch(entries[0].message, /sensitive|token-secret/u);
  assert.match(entries[0].message, /REDACTED/u);
});

test("数据迁移补齐旧项目字段、版本并保留迁移前备份", async () => {
  await createProject("legacy-project", { projectName: undefined, topic: "旧项目主题", accountType: "个人IP", contentSubject: undefined, contentDomain: undefined, stage: undefined });
  const before = await inspectDataMigration();
  assert.ok(before.pendingProjects > 0);
  const report = await runDataMigration();
  assert.ok(report.migratedProjects > 0);
  assert.ok(report.backupPath);
  const metadata = JSON.parse(await readFile(path.join(outputDir, "legacy-project", "project.json"), "utf8")) as Record<string, unknown>;
  assert.equal(metadata.projectName, "旧项目主题");
  assert.equal(metadata.contentSubject, "个人博主");
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(typeof metadata.stage, "string");
  assert.ok(await readFile(report.backupPath!, "utf8"));
});


test("旧项目迁移先生成并校验三份新稿，再归档旧文档", async () => {
  const slug = "workflow-migration-project";
  const directory = await createProject(slug, {
    projectName: slug,
    topic: "迁移测试选题",
    platform: "小红书",
    contentSubject: "个人博主",
    contentDomain: "内容生产",
    style: "专业但通俗",
    targetAudience: "目标用户",
    projectBrief: {
      topic: "迁移测试选题",
      contentSubject: "个人博主",
      contentDomain: "内容生产",
      platform: "小红书",
      style: "专业但通俗",
      targetAudience: "目标用户",
      extraRequirements: "",
      coreViewpoint: "迁移测试选题要先确认谁负责",
      contentStructure: "观点→例子→执行动作",
      targetDuration: "45-60秒",
      requiredElements: "谁负责",
      forbiddenExpressions: "一定成功",
      riskBoundaries: "不编造事实",
    },
  });
  const legacyNames = [
    "01_项目概览.md", "02_选题拆解.md", "03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md",
    "06_封面标题与发布文案.md", "07_视觉参考提示词.md", "08_内容质检报告.md", "09_成片执行稿.md", "10_发布承接话术.md",
  ];
  for (const name of legacyNames) await writeFile(path.join(directory, name), `# ${name}\n\n迁移测试选题的历史内容。`, "utf8");
  const segments = [
    "迁移测试选题先确认谁负责，不要只看表面进度。旧项目中的核心观点必须保留，不能在迁移时换成另一个结论。",
    "接着核对历史文档中的案例、执行动作和风险边界。相同内容只保留一份最终说法，冲突信息标记为需要确认，不把选择留在多份稿件之间。",
    "最后把确认后的观点写入新版执行稿，让口播、镜头、字幕和素材使用同一套内容。迁移完成后再检查归档版本，确认旧资料仍然可以恢复。",
  ];
  const scriptText = segments.join("");
  const long = "迁移测试选题的发布文案需要把目标用户关心的判断说清楚，并根据真实数据决定下一步。".repeat(6);
  const docs: Record<string, string> = {
    "01_创作简报.md": `# 创作简报

## 目标与用户
迁移测试选题服务目标用户，内容主体是个人博主。迁移目标是把旧项目中已经确认的判断收束成一套可以继续执行的新版工作稿。

## 核心观点
迁移测试选题要先确认谁负责，不能只搬运旧文件名。

## 内容结构
先说明迁移问题，再核对历史结论，然后给出统一执行动作。

## 执行约束
目标时长45-60秒，保留谁负责这一判断，禁用一定成功。所有冲突都必须在写入新版文档前处理。

## 事实与风险边界
不编造事实，不删除未归档的旧资料，不把旧文档中的推测改写成已确认结论。

## 人工确认
发布前核对事实来源、案例授权和历史项目中仍有分歧的事项。

补充说明：迁移只保留实际执行需要的内容，同时保证旧文档可以从版本归档中恢复。`,
    "02_拍摄执行稿.md": `# 拍摄执行稿

## 执行摘要
迁移测试选题面向小红书目标用户，目标时长45-60秒。采用竖屏真人口播，说明如何安全迁移旧项目。

## 最终逐字口播稿
${scriptText}

## 镜头执行表
| 时间 | 最终口播 | 画面/动作 | 字幕重点 | B-roll/素材 | 拍摄状态 |
| --- | --- | --- | --- | --- | --- |
| 0-12秒 | ${segments[0]} | 人物近景直视镜头 | 先确认谁负责 | 旧文件夹虚化画面 | 未拍 |
| 12-35秒 | ${segments[1]} | 半身口播，逐项手势说明 | 核对案例、动作和边界 | 文档对照示意 | 未拍 |
| 35-55秒 | ${segments[2]} | 中景收尾，展示归档目录 | 一套最终口径 | 版本归档目录示意 | 未拍 |

## 场景与设备
安静室内、手机竖屏、领夹麦和柔和正面光。

## 素材与替代方案
优先使用脱敏后的旧文档目录和版本列表；无法录屏时使用手写流程图替代。

## 拍摄风险
不展示真实用户资料、密钥或未授权内容，不把旧项目中的推测说成事实。

## 锁稿检查
镜头从0秒连续到55秒，逐行口播与最终逐字稿一致，已检查禁用表达和隐私边界，可直接拍。`,
    "03_发布与复盘.md": `# 发布与复盘

## 最终发布卡
主标题：旧项目迁移，先确认谁负责。封面文字：别急着搬文件，先统一口径。内容形式为小红书竖屏视频，封面不展示真实项目数据。

## 平台发布文案
${long}

## 置顶评论
迁移旧项目时，你最担心内容丢失、状态错乱，还是多人版本冲突？

## 发布记录
视频发布时间：发布后填写；视频链接：发布后填写；实际标题和封面版本：发布后填写。

## 数据复盘
| 回收节点 | 播放与停留 | 互动与评论 | 结论 |
| --- | --- | --- | --- |
| 24 小时 | 发布后填写 | 发布后填写 | 发布后填写 |
| 72 小时 | 发布后填写 | 发布后填写 | 发布后填写 |
| 7 天 | 发布后填写 | 发布后填写 | 发布后填写 |

## 复用与下一步
只根据真实数据判断是否需要重剪、补充迁移案例或拆分版本恢复教程，不预设传播表现。`,
  };
  let modelCallsForTest = 0;
  const result = await migrateProjectToCurrentWorkflow(slug, {
    modelCall: async () => {
      const name = (["01_创作简报.md", "02_拍摄执行稿.md", "03_发布与复盘.md"] as const)[Math.min(modelCallsForTest++, 2)];
      return JSON.stringify({ content: docs[name] });
    },
  });
  assert.equal(result.migrated, true, JSON.stringify(result.documentsStatus));
  assert.equal(result.status, "complete");
  assert.deepEqual(result.files.map((file) => file.name), ["01_创作简报.md", "02_拍摄执行稿.md", "03_发布与复盘.md"]);
  assert.equal(result.archivedFiles.length, 10);
  assert.equal((await readFile(path.join(directory, "project.json"), "utf8")).includes('"workflowVersion": 2'), true);
  await assert.rejects(readFile(path.join(directory, "01_项目概览.md"), "utf8"), { code: "ENOENT" });
  assert.ok((await readdir(path.join(directory, ".versions"))).length > 0);
});

test("发布中心移除后，旧 published 阶段显式迁移为 archived", async () => {
  const directory = await createProject("legacy-published-stage", {
    stage: "published",
    stageUpdatedAt: "2026-08-01T00:00:00.000Z",
  });
  const stage = await readStage("legacy-published-stage");
  assert.equal(stage.stage, "archived");
  const metadata = JSON.parse(await readFile(path.join(directory, "project.json"), "utf8")) as Record<string, unknown>;
  assert.equal(metadata.stage, "archived");
});

test("模型配置校验拒绝非法 URL、占位密钥和越界参数", () => {
  const valid = { provider: "deepseek", baseURL: "https://api.deepseek.com/v1", apiKey: "sk-real-key-123456", model: "deepseek-chat", temperature: 0.7, maxTokens: 4096 };
  assert.doesNotThrow(() => validateModelConfigInput(valid));
  assert.throws(() => validateModelConfigInput({ ...valid, baseURL: "file:///tmp/model" }), /http/u);
  assert.throws(() => validateModelConfigInput({ ...valid, apiKey: "sk-..." }), /占位值/u);
  assert.throws(() => validateModelConfigInput({ ...valid, temperature: 3 }), /0 到 2/u);
  assert.throws(() => validateModelConfigInput({ ...valid, maxTokens: 10 }), /256/u);
});
