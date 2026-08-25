import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeShotTaskState } from "../services/shotTaskBuilder.js";
import { feedbackToPrompt } from "../services/shootingFeedback.js";
import type { ShotTask } from "../types/shotTask.js";
import type { ShootingFeedback } from "../types/shootingFeedback.js";

function task(id: string, order: number, status: ShotTask["status"]): ShotTask {
  return { id, order, narration: "", shotType: "近景", visualDescription: "画面", requiredAssets: ["素材"], existingAssets: ["素材"], missingAssets: [], status, notes: "现场备注" };
}

test("重建镜头任务保留旧状态、素材判断和备注", () => {
  const merged = mergeShotTaskState([task("shot-001", 1, "shot")], [
    { ...task("shot-001", 1, "todo"), visualDescription: "更新后的画面" },
    { ...task("shot-002", 2, "todo"), notes: undefined },
  ]);
  assert.equal(merged[0].status, "shot");
  assert.deepEqual(merged[0].existingAssets, ["素材"]);
  assert.equal(merged[0].notes, "现场备注");
  assert.equal(merged[1].status, "todo");
});

test("拍摄复盘会输出计划/实际和现场证据", () => {
  const feedback: ShootingFeedback = {
    id: "f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    title: "第一轮拍摄",
    shotRecords: [{ shotTaskId: "shot-001", order: 1, plannedDurationSeconds: 5, actualDurationSeconds: 8, outcome: "reshoot", issue: "收音有底噪" }],
    addedShots: [{ id: "a1", label: "手部特写", reason: "补充细节" }],
    onSetIssues: ["灯光反光"],
  };
  const prompt = feedbackToPrompt(feedback);
  assert.match(prompt, /计划 5 秒/);
  assert.match(prompt, /实际 8 秒/);
  assert.match(prompt, /收音有底噪/);
  assert.match(prompt, /手部特写/);
});
