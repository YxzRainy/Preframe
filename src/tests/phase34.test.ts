import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ShotTask } from "../types/shotTask.js";
import type { PublishPreparation } from "../types/publisher.js";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "preframe-phase34-"));
const dataDir = path.join(sandbox, ".piance");
const outputDir = path.join(sandbox, "output");
process.env.PIANCE_DATA_DIR = dataDir;
process.env.PIANCE_OUTPUT_DIR = outputDir;
await mkdir(outputDir, { recursive: true });

const { mergeShotTaskStateWithMap } = await import("../services/shotTaskBuilder.js");
const { readLinks, remapShotLinks, writeLinks } = await import("../services/shotAssetLinkStore.js");
const { buildPlatformVariants } = await import("../services/platformVariantBuilder.js");
const { checkPreparation } = await import("../services/publishPreparationCheck.js");
const { exportPreparation } = await import("../services/publishPreparationExport.js");
const { createPreparation, markTargetManuallyPublished } = await import("../services/publishPreparationStore.js");

after(async () => {
  delete process.env.PIANCE_DATA_DIR;
  delete process.env.PIANCE_OUTPUT_DIR;
  await rm(sandbox, { recursive: true, force: true });
});

function shot(id: string, order: number, visualDescription: string, status: ShotTask["status"] = "todo"): ShotTask {
  return {
    id,
    order,
    narration: `${visualDescription}口播`,
    shotType: "中景",
    visualDescription,
    requiredAssets: [`${visualDescription}素材`],
    existingAssets: status === "todo" ? [] : [`${visualDescription}素材`],
    missingAssets: status === "todo" ? [`${visualDescription}素材`] : [],
    status,
    notes: status === "todo" ? undefined : `${visualDescription}现场备注`,
  };
}

test("分镜前插入新镜头时按内容迁移现场状态", () => {
  const previous = [
    shot("shot-001", 1, "开场", "done"),
    shot("shot-002", 2, "产品特写", "shot"),
  ];
  const rebuilt = [
    shot("shot-001", 1, "新增钩子"),
    shot("shot-002", 2, "开场"),
    shot("shot-003", 3, "产品特写"),
  ];

  const merged = mergeShotTaskStateWithMap(previous, rebuilt);
  assert.equal(merged.tasks[0].status, "todo");
  assert.equal(merged.tasks[1].status, "done");
  assert.equal(merged.tasks[1].notes, "开场现场备注");
  assert.equal(merged.tasks[2].status, "shot");
  assert.equal(merged.idMap.get("shot-001"), "shot-002");
  assert.equal(merged.idMap.get("shot-002"), "shot-003");
});

test("分镜重排后素材关系同步迁移，孤立关系退出活动集合", async () => {
  await writeLinks([
    {
      id: "link-a",
      projectSlug: "phase34-project",
      shotTaskId: "shot-001",
      assetId: "asset-a",
      confidence: 100,
      source: "manual",
      status: "confirmed",
      primary: true,
      createdAt: "2026-08-24T00:00:00.000Z",
    },
    {
      id: "link-orphan",
      projectSlug: "phase34-project",
      shotTaskId: "shot-009",
      assetId: "asset-b",
      confidence: 80,
      source: "automatic",
      status: "suggested",
      createdAt: "2026-08-24T00:00:00.000Z",
    },
  ]);

  const active = await remapShotLinks(
    "phase34-project",
    new Map([["shot-001", "shot-002"]]),
    new Set(["shot-002"]),
  );
  assert.equal(active.length, 1);
  assert.equal(active[0].shotTaskId, "shot-002");
  assert.equal((await readLinks()).find((link) => link.id === "link-orphan")?.status, "rejected");
});

test("发布准备从项目文档提取平台差异稿", async () => {
  const slug = "publish-variants";
  const projectDir = path.join(outputDir, slug);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ projectName: "平台差异稿测试", topic: "创作效率" }), "utf8");
  await writeFile(path.join(projectDir, "06_封面标题与发布文案.md"), [
    "# 封面标题与发布文案",
    "## 标题候选",
    "三步提高创作效率",
    "## 抖音发布文案",
    "抖音短稿：三步讲清楚。",
    "## 小红书发布文案",
    "小红书长稿：记录完整方法和踩坑经验。",
    "## 标签建议",
    "#创作 #效率",
  ].join("\n"), "utf8");
  await writeFile(path.join(projectDir, "10_发布承接话术.md"), "# 发布承接话术\n\n## 承接话术\n欢迎留言。\n", "utf8");

  const result = await buildPlatformVariants({ projectSlug: slug, enabledPlatforms: ["douyin", "xiaohongshu"] });
  assert.equal(result.targets[0].description, "抖音短稿：三步讲清楚。");
  assert.equal(result.targets[1].description, "小红书长稿：记录完整方法和踩坑经验。");
  assert.notEqual(result.targets[0].description, result.targets[1].description);
  assert.deepEqual(result.targets[0].tags, ["创作", "效率"]);
});

test("发布前检查覆盖视频格式、封面和账号状态", async () => {
  const videoPath = path.join(sandbox, "final.mp4");
  const coverPath = path.join(sandbox, "cover.jpg");
  await writeFile(videoPath, "video");
  await writeFile(coverPath, "cover");
  const preparation: PublishPreparation = {
    id: "prep-check",
    videoPath,
    masterContent: { title: "标题", description: "正文", tags: ["标签"], thumbnailPath: coverPath },
    targets: [{
      id: "target-check",
      platform: "douyin",
      title: "标题",
      description: "正文",
      tags: ["标签"],
      thumbnailPath: coverPath,
      enabled: true,
      validationErrors: [],
    }],
    status: "draft",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  const result = await checkPreparation(preparation);
  assert.equal(result.videoExists, true);
  assert.equal(result.videoFormatValid, true);
  assert.equal(result.targets[0].coverPresent, true);
  assert.equal(result.targets[0].accountConfigured, false);
  assert.equal(result.level, "warning");

  const invalidVideo = path.join(sandbox, "final.txt");
  await writeFile(invalidVideo, "video");
  const invalid = await checkPreparation({ ...preparation, videoPath: invalidVideo });
  assert.equal(invalid.videoFormatValid, false);
  assert.equal(invalid.level, "blocked");
});

test("发布包导出平台文案、素材引用和 manifest", async () => {
  const videoPath = path.join(sandbox, "export.mp4");
  const output = path.join(sandbox, "exports");
  await writeFile(videoPath, "video");
  await mkdir(output, { recursive: true });
  const preparation: PublishPreparation = {
    id: "prep-export",
    projectSlug: "publish-variants",
    videoPath,
    masterContent: { title: "标题", description: "正文", tags: ["标签"] },
    targets: [{
      id: "target-export",
      platform: "douyin",
      title: "抖音标题",
      description: "抖音正文",
      tags: ["创作"],
      enabled: true,
      validationErrors: [],
      publishResult: "published",
      publishUrl: "https://example.com/video",
    }],
    status: "ready",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  const result = await exportPreparation({ preparation, outputDir: output, copyVideo: false });
  assert.match(await readFile(path.join(result.exportDir, "douyin.md"), "utf8"), /抖音正文/u);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as { targets: Array<{ publishResult?: string }> };
  assert.equal(manifest.targets[0].publishResult, "published");
});

test("记录平台发布成功后推进项目阶段并保存结果", async () => {
  const slug = "publish-result";
  const projectDir = path.join(outputDir, slug);
  const videoPath = path.join(sandbox, "published.mp4");
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "project.json"), "{}\n", "utf8");
  await writeFile(videoPath, "video");
  const preparation = await createPreparation({
    projectSlug: slug,
    videoPath,
    masterContent: { title: "标题", description: "正文", tags: [] },
    targets: [{ platform: "douyin", title: "标题", description: "正文", tags: [], enabled: true }],
  });
  const updated = await markTargetManuallyPublished(preparation.id, preparation.targets[0].id, true, {
    result: "published",
    publishUrl: "https://example.com/published",
  });
  assert.equal(updated.targets[0].publishResult, "published");
  const metadata = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")) as {
    stage?: string;
    publishData?: { publishUrl?: string; platform?: string };
  };
  assert.equal(metadata.stage, "published");
  assert.equal(metadata.publishData?.platform, "抖音");
  assert.equal(metadata.publishData?.publishUrl, "https://example.com/published");
});
