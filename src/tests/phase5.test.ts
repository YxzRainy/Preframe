import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sandbox = await mkdtemp(path.join(os.tmpdir(), "preframe-phase5-"));
const dataDir = path.join(sandbox, ".piance");
const outputDir = path.join(sandbox, "output");
process.env.PIANCE_DATA_DIR = dataDir;
process.env.PIANCE_OUTPUT_DIR = outputDir;
await mkdir(outputDir, { recursive: true });

const { exportProjectArchive, importProjectArchive } = await import("../services/projectArchive.js");
const { validateArchiveFiles } = await import("../services/portableArchive.js");
const { listTrashProjects, moveProjectToTrash, restoreProjectFromTrash } = await import("../services/projectManager.js");
const { createConfigBackup, restoreConfigBackup } = await import("../services/configBackup.js");
const { clearDiagnostics, listDiagnostics, recordDiagnostic } = await import("../services/diagnosticLog.js");
const { inspectDataMigration, runDataMigration } = await import("../services/dataMigration.js");
const { validateModelConfigInput } = await import("../services/modelClient.js");

after(async () => {
  delete process.env.PIANCE_DATA_DIR;
  delete process.env.PIANCE_OUTPUT_DIR;
  await rm(sandbox, { recursive: true, force: true });
});

async function createProject(slug: string, metadata: Record<string, unknown> = {}): Promise<string> {
  const directory = path.join(outputDir, slug);
  await mkdir(path.join(directory, "covers"), { recursive: true });
  await writeFile(path.join(directory, "project.json"), `${JSON.stringify({ projectName: slug, topic: slug, ...metadata }, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "01_项目概览.md"), `# ${slug}\n`, "utf8");
  return directory;
}

test("项目归档完整往返文本与二进制文件，重名时不覆盖", async () => {
  const directory = await createProject("archive-source");
  const binary = Buffer.from([0, 1, 2, 127, 128, 255]);
  await writeFile(path.join(directory, "covers", "cover.png"), binary);
  const archive = await exportProjectArchive("archive-source");
  assert.ok(archive.files.some((file) => file.path === "covers/cover.png"));

  const imported = await importProjectArchive(archive);
  assert.equal(imported.slug, "archive-source_2");
  assert.deepEqual(await readFile(path.join(outputDir, imported.slug, "covers", "cover.png")), binary);
  assert.equal(await readFile(path.join(directory, "01_项目概览.md"), "utf8"), "# archive-source\n");
});

test("项目归档拒绝路径穿越和内容篡改", () => {
  assert.throws(() => validateArchiveFiles([{ path: "../project.json", size: 2, sha256: "x", contentBase64: "e30=" }]), /不安全路径/u);
  assert.throws(() => validateArchiveFiles([{ path: "project.json", size: 2, sha256: "bad", contentBase64: "e30=" }]), /校验和不匹配/u);
});

test("回收站支持列表与冲突安全恢复", async () => {
  await createProject("trash-source", { projectName: "待恢复项目" });
  await moveProjectToTrash("trash-source");
  await createProject("trash-source", { projectName: "当前同名项目" });
  const trashed = (await listTrashProjects()).find((item) => item.originalSlug === "trash-source");
  assert.ok(trashed);
  assert.equal(trashed?.name, "待恢复项目");
  const restored = await restoreProjectFromTrash(trashed!.id);
  assert.equal(restored.slug, "trash-source_2");
  assert.equal((await listTrashProjects()).some((item) => item.id === trashed!.id), false);
});

test("配置备份不导出明文密钥，恢复时保留本机密钥", async () => {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "model-config.json"), `${JSON.stringify({ provider: "deepseek", baseURL: "https://api.deepseek.com/v1", apiKey: "sk-local-secret-123456", model: "deepseek-chat", temperature: 0.7, maxTokens: 4096 })}\n`, "utf8");
  await writeFile(path.join(dataDir, "tasks.json"), "{\"items\":[{\"title\":\"备份前\"}]}\n", "utf8");
  const backup = await createConfigBackup();
  const serialized = JSON.stringify(backup);
  assert.doesNotMatch(serialized, /sk-local-secret/u);
  const modelConfigFile = backup.files.find((file) => file.path === "model-config.json");
  assert.ok(modelConfigFile);
  assert.match(Buffer.from(modelConfigFile!.contentBase64, "base64").toString("utf8"), /__PREFRAME_REDACTED__/u);

  await writeFile(path.join(dataDir, "tasks.json"), "{\"items\":[]}\n", "utf8");
  const restored = await restoreConfigBackup(backup);
  assert.ok(await readFile(restored.rollbackBackupPath, "utf8"));
  assert.match(await readFile(path.join(dataDir, "tasks.json"), "utf8"), /备份前/u);
  assert.match(await readFile(path.join(dataDir, "model-config.json"), "utf8"), /sk-local-secret-123456/u);

  await rm(path.join(dataDir, "model-config.json"));
  await restoreConfigBackup(backup);
  await assert.rejects(readFile(path.join(dataDir, "model-config.json"), "utf8"), { code: "ENOENT" });
});

test("诊断日志脱敏 API Key 与授权信息", async () => {
  await clearDiagnostics();
  await recordDiagnostic(new Error("apiKey=sk-sensitive-123456 Authorization: Bearer token-secret"), "generate");
  const entries = await listDiagnostics();
  assert.equal(entries.length, 1);
  assert.doesNotMatch(entries[0].message, /sensitive|token-secret/u);
  assert.match(entries[0].message, /REDACTED/u);
});

test("数据迁移补齐旧项目字段、版本并保留迁移前备份", async () => {
  await createProject("legacy-project", { projectName: undefined, topic: "旧项目主题", accountType: "个人IP", contentSubject: undefined, contentDomain: undefined, stage: undefined });
  const before = await inspectDataMigration();
  assert.ok(before.pendingProjects > 0);
  const report = await runDataMigration();
  assert.ok(report.migratedProjects > 0);
  assert.ok(report.backupPath);
  const metadata = JSON.parse(await readFile(path.join(outputDir, "legacy-project", "project.json"), "utf8")) as Record<string, unknown>;
  assert.equal(metadata.projectName, "旧项目主题");
  assert.equal(metadata.contentSubject, "个人博主");
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(typeof metadata.stage, "string");
  assert.ok(await readFile(report.backupPath!, "utf8"));
});

test("模型配置校验拒绝非法 URL、占位密钥和越界参数", () => {
  const valid = { provider: "deepseek", baseURL: "https://api.deepseek.com/v1", apiKey: "sk-real-key-123456", model: "deepseek-chat", temperature: 0.7, maxTokens: 4096 };
  assert.doesNotThrow(() => validateModelConfigInput(valid));
  assert.throws(() => validateModelConfigInput({ ...valid, baseURL: "file:///tmp/model" }), /http/u);
  assert.throws(() => validateModelConfigInput({ ...valid, apiKey: "sk-..." }), /占位值/u);
  assert.throws(() => validateModelConfigInput({ ...valid, temperature: 3 }), /0 到 2/u);
  assert.throws(() => validateModelConfigInput({ ...valid, maxTokens: 10 }), /256/u);
});
