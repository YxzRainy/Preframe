import assert from "node:assert/strict";
import { buildProjectAdvice, type ProjectAdviceFacts } from "../services/projectAdvisor.js";

const base: ProjectAdviceFacts = {
  stage: "ready_to_shoot",
  workflowVersion: 2,
  documentCompleted: 3,
  documentTotal: 3,
  invalidDocuments: [],
  shotTotal: 4,
  shotCompleted: 0,
  shotReady: 2,
  missingAssets: 0,
  suggestedAssets: 0,
  assetHealthIssues: 0,
  reshootCount: 0,
  feedbackCount: 0,
  publishRecordComplete: false,
  resumeAvailable: false,
};

const invalid = buildProjectAdvice({ ...base, invalidDocuments: [{ fileName: "02_拍摄执行稿.md", errors: ["口播超时"] }] });
assert.equal(invalid.priority, "blocking");
assert.equal(invalid.target, "document");
assert.equal(invalid.documentFile, "02_拍摄执行稿.md");

const reshoot = buildProjectAdvice({ ...base, shotCompleted: 4, reshootCount: 2, feedbackCount: 1 });
assert.equal(reshoot.target, "execution");
assert.match(reshoot.action, /2 个需补拍镜头/u);

const filming = buildProjectAdvice({ ...base, shotCompleted: 1, resumeAvailable: true });
assert.equal(filming.ctaLabel, "继续现场");
assert.match(filming.reason, /当前最大缺口/u);

const feedback = buildProjectAdvice({ ...base, shotCompleted: 4 });
assert.equal(feedback.action, "记录这次拍摄复盘");

const publish = buildProjectAdvice({ ...base, stage: "ready_to_publish", shotCompleted: 4, feedbackCount: 1 });
assert.equal(publish.documentFile, "03_发布与复盘.md");
assert.equal(publish.target, "document");

console.log("project advisor tests passed");
