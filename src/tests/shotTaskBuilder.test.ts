import { buildShotTasks } from "../services/shotTaskBuilder.js";
import { readFileSync } from "node:fs";

const names = ["03_口播脚本.md", "04_分镜与剪辑节奏.md", "05_拍摄清单.md", "07_视觉参考提示词.md", "09_成片执行稿.md"];
const files = names.map((name) => ({
  name,
  content: readFileSync(`output/ai/${name}`, "utf8"),
}));

const tasks = buildShotTasks(files);
console.log("shotTasks count:", tasks.length);
console.log(JSON.stringify(tasks.slice(0, 2), null, 2));
console.log("All statuses:", tasks.map((t) => t.status));
console.log("All shotTypes:", tasks.map((t) => t.shotType));
