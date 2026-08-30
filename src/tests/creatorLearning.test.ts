import assert from "node:assert/strict";
import { buildCandidatePatterns, deriveLearningFactsFromFeedback, derivePublishingFacts } from "../services/creatorLearningStore.js";
import type { ShootingFeedback } from "../types/shootingFeedback.js";
import type { LearningFact } from "../types/creatorLearning.js";

const feedback: ShootingFeedback = {
  id: "feedback_1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  title: "拍摄复盘",
  shotRecords: [{ shotTaskId: "shot_1", order: 1, label: "开头", outcome: "reshoot", issue: "长句现场容易卡住" }],
  addedShots: [],
  onSetIssues: ["长句现场容易卡住"],
  scriptAdjustments: "开头要拆成更短的两句",
};
const facts = deriveLearningFactsFromFeedback("project-a", "项目 A", feedback);
assert.ok(facts.some((fact) => fact.category === "script"));
assert.ok(facts.some((fact) => fact.text.includes("需要补拍")));

const publishing = derivePublishingFacts("project-a", "项目 A", `# 发布与复盘

## 发布记录

- 视频链接：https://example.com/video
- 发布状态：已发布

## 数据复盘

| 节点 | 播放 | 收藏 |
|---|---:|---:|
| 24 小时 | 1200 | 36 |
| 72 小时 | 发布后填写 | 发布后填写 |
| 7 天 | 发布后填写 | 发布后填写 |
`);
assert.ok(publishing.some((fact) => fact.text.includes("1200")));
assert.ok(!publishing.some((fact) => fact.text.includes("发布后填写")));

const confirmed: LearningFact[] = [
  { ...facts[0], id: "f1", sourceKey: "s1", sourceProjectSlug: "a", status: "confirmed", text: "长句在现场口播时容易卡住" },
  { ...facts[0], id: "f2", sourceKey: "s2", sourceProjectSlug: "b", sourceProjectName: "项目 B", status: "confirmed", text: "现场口播长句很容易卡住" },
];
const patterns = buildCandidatePatterns(confirmed);
assert.equal(patterns.length, 1);
assert.equal(patterns[0].supportingProjectSlugs.length, 2);
assert.equal(patterns[0].status, "candidate");

const confirmedPattern = { ...patterns[0], status: "confirmed" as const, decidedAt: "2026-08-29T00:00:00.000Z" };
const expanded = buildCandidatePatterns([
  ...confirmed,
  { ...confirmed[0], id: "f3", sourceKey: "s3", sourceProjectSlug: "c", sourceProjectName: "项目 C", text: "现场口播长句容易卡住" },
], [confirmedPattern]);
assert.equal(expanded[0].id, confirmedPattern.id);
assert.equal(expanded[0].status, "confirmed");
assert.equal(expanded[0].supportingProjectSlugs.length, 3);

console.log("creator learning tests passed");
