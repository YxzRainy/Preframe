import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ShotTask } from "../types/shotTask.js";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "preframe-phase34-"));
const dataDir = path.join(sandbox, ".piance");
const outputDir = path.join(sandbox, "output");
process.env.PIANCE_DATA_DIR = dataDir;
process.env.PIANCE_OUTPUT_DIR = outputDir;
await mkdir(outputDir, { recursive: true });

const { mergeShotTaskStateWithMap } = await import("../services/shotTaskBuilder.js");
const { readLinks, remapShotLinks, writeLinks } = await import("../services/shotAssetLinkStore.js");

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
