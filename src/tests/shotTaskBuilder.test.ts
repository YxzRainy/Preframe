import assert from "node:assert/strict";
import { buildShotTasks } from "../services/shotTaskBuilder.js";

const unified = `# 拍摄执行稿

## 镜头执行表
| 时间 | 最终口播 | 画面/动作 | 字幕重点 | B-roll/素材 | 拍摄状态 |
| --- | --- | --- | --- | --- | --- |
| 0-5秒 | 直接抛出观点 | 人物近景 | 核心观点 | 无 | 未拍 |
| 5-12秒 | 给出具体例子 | 签字栏特写 | 最后负责的人 | 空白病历本 | 未拍 |
`;

const unifiedTasks = buildShotTasks([{ name: "02_拍摄执行稿.md", content: unified }]);
assert.equal(unifiedTasks.length, 2, "新项目应直接从 02 的镜头执行表构建任务");
assert.equal(unifiedTasks[0]?.durationSeconds, 5, "中文秒数应能解析");
assert.match(unifiedTasks[1]?.visualDescription || "", /签字栏特写/u);
assert.equal(unifiedTasks[1]?.narration, "给出具体例子");
console.log("unified execution parser: passed");
