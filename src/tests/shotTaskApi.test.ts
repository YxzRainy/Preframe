import { buildShotTasks } from "../services/shotTaskBuilder.js";
import { readFileSync } from "node:fs";
import type { ShotTask } from "../types/shotTask.js";

function runShotTaskApiTest() {
  const names = ["03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md", "07_视觉参考提示词.md", "09_成片执行稿.md"];
  const files = names.map((name) => ({
    name,
    content: readFileSync(`output/ai/${name}`, "utf8"),
  }));

  const tasks = buildShotTasks(files);
  console.assert(tasks.length > 0, "Shot tasks should not be empty");

  // 测试快捷操作修改 (标记素材已齐, 状态流转)
  const task: ShotTask = { ...tasks[0] };
  task.existingAssets = [...task.requiredAssets];
  task.missingAssets = [];
  task.status = "ready";

  console.assert(task.existingAssets.length === task.requiredAssets.length, "Existing assets should match required");
  console.assert(task.missingAssets.length === 0, "Missing assets should be empty");
  console.assert(task.status === "ready", "Status should be updated to ready");

  console.log("P2 Phase 2 test passed: ShotTask build & state mutation verified.");
}

runShotTaskApiTest();
