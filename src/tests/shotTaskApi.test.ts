import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShotTasks, mergeShotTaskState } from "../services/shotTaskBuilder.js";
import type { ShotTask } from "../types/shotTask.js";

const executionDocument = `# 拍摄执行稿

## 镜头执行表
| 时间 | 最终口播 | 画面/动作 | 字幕重点 | B-roll/素材 | 拍摄状态 |
| --- | --- | --- | --- | --- | --- |
| 0-8秒 | 先说清楚核心判断 | 人物近景 | 核心判断 | 无 | 未拍 |
| 8-20秒 | 再给出可以执行的步骤 | 半身口播 | 执行步骤 | 日历特写 | 未拍 |
| 20-35秒 | 最后说明事实和隐私边界 | 中景收尾 | 风险边界 | 备忘录特写 | 未拍 |
`;

test("镜头接口数据源只依赖新版 02 执行表", () => {
  const tasks = buildShotTasks([{ name: "02_拍摄执行稿.md", content: executionDocument }]);
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.status), ["todo", "todo", "todo"]);
  assert.equal(tasks[1]?.requiredAssets.includes("日历特写"), true);
});

test("镜头快捷状态、素材和 take 在重建后保留", () => {
  const tasks = buildShotTasks([{ name: "02_拍摄执行稿.md", content: executionDocument }]);
  const take = { id: "take_test", createdAt: "2026-08-29T00:00:00.000Z", outcome: "good" as const };
  const previous: ShotTask[] = tasks.map((task, index) => index === 1 ? {
    ...task,
    status: "ready",
    existingAssets: [...task.requiredAssets],
    missingAssets: [],
    notes: "素材已核对",
    takes: [take],
    bestTakeId: take.id,
  } : task);
  const rebuilt = buildShotTasks([{ name: "02_拍摄执行稿.md", content: executionDocument }]);
  const merged = mergeShotTaskState(previous, rebuilt);
  assert.equal(merged[1]?.status, "ready");
  assert.deepEqual(merged[1]?.existingAssets, previous[1]?.existingAssets);
  assert.equal(merged[1]?.missingAssets.length, 0);
  assert.equal(merged[1]?.notes, "素材已核对");
  assert.equal(merged[1]?.bestTakeId, take.id);
  assert.deepEqual(merged[1]?.takes, [take]);
});
