import assert from "node:assert/strict";
import { buildAssetSuggestions, buildTopicMap, extractProjectAtoms, rankContentAtoms } from "../services/contentAssetStore.js";

const atoms = extractProjectAtoms({
  slug: "project-a",
  name: "异地关系",
  topic: "异地恋如何讨论未来城市",
  platform: "小红书",
  domain: "亲密关系",
  creativeBrief: `# 创作简报

## 目标与用户
- 面向正在异地、却一直回避未来城市安排的人。

## 核心观点
- 异地关系真正要确认的不是每天聊多久，而是谁愿意为共同生活调整现实安排。
`,
  shootingExecution: `# 拍摄执行稿

## 最终逐字口播稿
很多异地恋不是败给距离，而是两个人从来没有谈过谁会搬去谁的城市。
比如我见过一对情侣谈了三年，每次聊未来都只说顺其自然，最后工作一变动就分开了。
`,
  publishReview: `# 发布与复盘

## 发布记录
视频链接：https://example.com/a
发布状态：已发布

## 数据复盘
| 节点 | 播放 | 收藏 |
|---|---:|---:|
| 24 小时 | 2300 | 80 |
`,
});
assert.ok(atoms.some((atom) => atom.kind === "viewpoint"));
assert.ok(atoms.some((atom) => atom.kind === "hook"));
assert.ok(atoms.some((atom) => atom.kind === "case"));
assert.ok(atoms.some((atom) => atom.kind === "result"));

const ranked = rankContentAtoms(atoms, "异地 城市");
assert.ok(ranked.length > 0);
assert.ok(ranked[0].tags.includes("异地恋如何讨论未来城市"));

const topics = buildTopicMap(atoms);
assert.ok(topics.some((topic) => topic.label === "亲密关系"));

const suggestions = buildAssetSuggestions(atoms, true);
assert.ok(suggestions.length > 0);
assert.ok(suggestions[0].sourceAtomIds.length > 0);

console.log("content asset tests passed");
