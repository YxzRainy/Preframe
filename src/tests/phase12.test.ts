import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "preframe-phase12-"));
const dataDir = path.join(sandbox, ".piance");
const outputDir = path.join(sandbox, "output");
process.env.PIANCE_DATA_DIR = dataDir;
process.env.PIANCE_OUTPUT_DIR = outputDir;
await mkdir(outputDir, { recursive: true });

const { resolveWorkspaceOutputPath } = await import("../services/workspaceConfig.js");
const { createIdea, markIdeaConverted, listIdeas } = await import("../services/ideaManager.js");
const {
  archiveDocumentVersion,
  lineDiff,
  listDocumentVersions,
  rollbackDocumentVersion,
} = await import("../services/documentVersionStore.js");
const { PROJECT_DOCUMENT_DEFINITIONS } = await import("../utils/documentDefinitions.js");

after(async () => {
  delete process.env.PIANCE_DATA_DIR;
  delete process.env.PIANCE_OUTPUT_DIR;
  await rm(sandbox, { recursive: true, force: true });
});

test("旧 workspace.json 的 outputDir 字段仍能解析", () => {
  const resolved = resolveWorkspaceOutputPath({ outputDir: "~/PreframeProjects" });
  assert.equal(resolved, path.join(os.homedir(), "PreframeProjects"));
});

test("灵感转换后写入项目 slug", async () => {
  const idea = await createIdea({ title: "测试灵感", note: "测试备注" });
  await markIdeaConverted(idea.id, "test-project");
  const saved = (await listIdeas()).find((item) => item.id === idea.id);
  assert.equal(saved?.convertedProjectSlug, "test-project");
});

test("新项目只保留三份核心文档并使用统一结构", () => {
  assert.deepEqual(PROJECT_DOCUMENT_DEFINITIONS.map((item) => item.filename), [
    "01_创作简报.md",
    "02_拍摄执行稿.md",
    "03_发布与复盘.md",
  ]);
  const execution = PROJECT_DOCUMENT_DEFINITIONS.find((item) => item.number === "02")!;
  assert.ok(execution.requiredSections.includes("镜头执行表"));
  assert.ok(execution.requiredSections.includes("锁稿检查"));
});

test("文档版本可归档、比较并回滚", async () => {
  const slug = "version-project";
  const fileName = "01_创作简报.md";
  const projectDir = path.join(outputDir, slug);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "project.json"), "{}\n", "utf8");
  await writeFile(path.join(projectDir, fileName), "# 创作简报\n\n旧内容\n", "utf8");
  const archived = await archiveDocumentVersion(slug, fileName, "# 创作简报\n\n旧内容\n", "regenerate");
  await writeFile(path.join(projectDir, fileName), "# 创作简报\n\n新内容\n", "utf8");

  const versions = await listDocumentVersions(slug, fileName);
  assert.equal(versions[0]?.id, "current");
  assert.ok(versions.some((version) => version.id === archived.id));
  const diff = lineDiff("a\n旧内容", "a\n新内容");
  assert.match(diff, /- 旧内容/u);
  assert.match(diff, /\+ 新内容/u);

  await rollbackDocumentVersion(slug, fileName, archived.id);
  assert.equal(await readFile(path.join(projectDir, fileName), "utf8"), "# 创作简报\n\n旧内容\n");
  assert.ok((await listDocumentVersions(slug, fileName)).some((version) => version.reason === "rollback"));
});
