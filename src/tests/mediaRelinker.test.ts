/** 素材路径重连 — 真实文件系统测试
 *
 * 覆盖：
 * - missing detection（manifest 中 originalPath 失效）
 * - hash relink（hashHead+hashTail+size 完全一致 → 自动重连）
 * - size+filename relink（高置信自动重连）
 * - ambiguous relink（normalized filename 一致 → 待人工确认）
 * - unmatched（无任何匹配 → 未匹配） */

import { strict as assert } from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { relinkFromDirectory } from "../services/mediaRelinker.js";
import { readEditingManifest } from "../services/editingPrepBuilder.js";
import { readMediaAssets, writeMediaAssets } from "../services/mediaAssetStore.js";
import type { EditingManifest } from "../types/editingManifest.js";
import type { MediaAsset } from "../types/mediaAsset.js";

const PROJECT_ROOT = path.resolve(process.cwd(), "output");
const TEST_SLUG = "_relinktest_tmp";
const TEST_PROJECT = path.join(PROJECT_ROOT, TEST_SLUG);
const TEST_EDITING = path.join(TEST_PROJECT, "editing");
const TEST_SCAN_DIR = path.join(PROJECT_ROOT, ".tmp_relink_scan");

const HASH_CHUNK = 64 * 1024;

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fileHashes(content: Buffer): { head: string; tail: string } {
  const head = content.subarray(0, Math.min(HASH_CHUNK, content.length));
  const tail = content.length > HASH_CHUNK
    ? content.subarray(content.length - HASH_CHUNK)
    : content;
  return {
    head: createHash("sha256").update(head).digest("hex").slice(0, 16),
    tail: createHash("sha256").update(tail).digest("hex").slice(0, 16),
  };
}

async function writeManifest(entries: EditingManifest["entries"]): Promise<void> {
  const manifest: EditingManifest = {
    projectSlug: TEST_SLUG,
    editingDir: TEST_EDITING,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    entries,
  };
  await mkdir(TEST_EDITING, { recursive: true });
  await writeFile(
    path.join(TEST_EDITING, "EDITING_MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  // 备份 media-assets.json，测试后恢复
  const originalAssets = await readMediaAssets();

  try {
    // ── 准备：创建扫描目录 + 候选文件 ──
    await rm(TEST_PROJECT, { recursive: true, force: true });
    await rm(TEST_SCAN_DIR, { recursive: true, force: true });
    await mkdir(TEST_SCAN_DIR, { recursive: true });
    await mkdir(TEST_EDITING, { recursive: true });

    // 候选 1：hash 匹配（文件名不同，但 hash+size 一致 → 自动重连）
    const content1 = Buffer.from("hash-match-content-001-" + "x".repeat(200));
    const file1Path = path.join(TEST_SCAN_DIR, "RENAMED_HASH.mp4");
    await writeFile(file1Path, content1);
    const hashes1 = fileHashes(content1);

    // 候选 2：size + filename 完全匹配（自动重连）
    const content2 = Buffer.from("size-filename-match-" + "y".repeat(150));
    const file2Path = path.join(TEST_SCAN_DIR, "VID_0502.mp4");
    await writeFile(file2Path, content2);

    // 候选 3：仅 normalized filename 匹配（文件名不同但 normalize 后相同，size 不同 → 模糊）
    const content3 = Buffer.from("ambiguous-" + "z".repeat(80));
    const file3Path = path.join(TEST_SCAN_DIR, "VID-0503.mp4");
    await writeFile(file3Path, content3);

    // ── 准备：写入 media-assets.json（合并原有 + 测试素材，为 hash 匹配提供指纹）──
    const testAsset: MediaAsset = {
      path: "/old/nonexistent/HASH_TEST.mp4",
      fileName: "HASH_TEST.mp4",
      ext: ".mp4",
      kind: "video",
      sizeBytes: content1.length,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-01-01T00:00:00Z",
      normalizedName: "hash test",
      hashHead: hashes1.head,
      hashTail: hashes1.tail,
      stable: true,
      id: "asset_test_0501",
      scannedAt: "2026-01-01T00:00:00Z",
      projectSlug: TEST_SLUG,
    };
    await writeMediaAssets([...originalAssets, testAsset]);

    // ── 准备：写入 manifest，originalPath 全部指向不存在的旧路径 ──
    await writeManifest([
      {
        assetId: "asset_test_0501",
        originalPath: "/old/nonexistent/HASH_TEST.mp4",
        editingPath: path.join(TEST_EDITING, "media", "HASH_TEST.mp4"),
        displayName: "HASH_TEST.mp4",
        originalFileName: "HASH_TEST.mp4",
        type: "video",
        sizeBytes: content1.length,
        symlinkOk: false,
        addedAt: "2026-01-01T00:00:00Z",
      },
      {
        assetId: "asset_test_0502",
        originalPath: "/old/nonexistent/VID_0502.mp4",
        editingPath: path.join(TEST_EDITING, "media", "VID_0502.mp4"),
        displayName: "VID_0502.mp4",
        originalFileName: "VID_0502.mp4",
        type: "video",
        sizeBytes: content2.length,
        symlinkOk: false,
        addedAt: "2026-01-01T00:00:00Z",
      },
      {
        assetId: "asset_test_0503",
        originalPath: "/old/nonexistent/VID_0503.mp4",
        editingPath: path.join(TEST_EDITING, "media", "VID_0503.mp4"),
        displayName: "VID_0503.mp4",
        originalFileName: "VID_0503.mp4",
        type: "video",
        sizeBytes: 99999,
        symlinkOk: false,
        addedAt: "2026-01-01T00:00:00Z",
      },
      {
        assetId: "asset_test_0504",
        originalPath: "/old/nonexistent/VID_0599.mp4",
        editingPath: path.join(TEST_EDITING, "media", "VID_0599.mp4"),
        displayName: "VID_0599.mp4",
        originalFileName: "VID_0599.mp4",
        type: "video",
        sizeBytes: 12345,
        symlinkOk: false,
        addedAt: "2026-01-01T00:00:00Z",
      },
    ]);

    // ── 执行重连（单次调用验证全部结果）──
    const result = await relinkFromDirectory(TEST_SLUG, TEST_SCAN_DIR);

    // ── 1. missing detection ──
    console.log("Missing detection:");
    assert.equal(result.totalMissing, 4, "应检测到 4 个失效素材");
    ok("检测到 4 个失效素材");

    // ── 2. hash relink（0501 文件名不同，靠 hash 自动重连）──
    console.log("Hash relink:");
    {
      const manifest = await readEditingManifest(TEST_SLUG);
      const e1 = manifest?.entries.find((e) => e.assetId === "asset_test_0501");
      assert.ok(e1, "manifest 应包含 asset_test_0501");
      assert.equal(e1!.originalPath, file1Path, "hash 匹配后 originalPath 应更新为扫描目录中的新路径");
      ok("hash relink: 0501 通过 hash 自动重连，originalPath 已更新");
    }

    // ── 3. size+filename relink（0502 文件名+大小匹配）──
    console.log("Size+filename relink:");
    {
      const manifest = await readEditingManifest(TEST_SLUG);
      const e2 = manifest?.entries.find((e) => e.assetId === "asset_test_0502");
      assert.ok(e2, "manifest 应包含 asset_test_0502");
      assert.equal(e2!.originalPath, file2Path, "size+filename 匹配后 originalPath 应更新");
      ok("size+filename relink: 0502 自动重连，originalPath 已更新");
    }

    // 验证自动重连总数
    assert.ok(result.autoRelinked >= 2, `至少 2 个自动重连（hash + size+filename），实际 ${result.autoRelinked}`);
    ok(`自动重连总数 ${result.autoRelinked}`);

    // ── 4. ambiguous relink（0503 normalized name 匹配 → 待确认）──
    console.log("Ambiguous relink:");
    {
      const amb = result.ambiguous.find((a) => a.entry.assetId === "asset_test_0503");
      assert.ok(amb, "asset_test_0503 应进入待确认列表");
      assert.equal(amb!.method, "normalized-name", "0503 应通过 normalized-name 模糊匹配");
      const manifest = await readEditingManifest(TEST_SLUG);
      const e3 = manifest?.entries.find((e) => e.assetId === "asset_test_0503");
      assert.equal(e3!.originalPath, "/old/nonexistent/VID_0503.mp4", "模糊匹配不应自动更新 originalPath");
      ok("ambiguous relink: 0503 进入待确认（normalized-name），originalPath 未自动更新");
    }

    // ── 5. unmatched（0504 无任何匹配）──
    console.log("Unmatched:");
    {
      const unmatched = result.unmatched.find((u) => u.assetId === "asset_test_0504");
      assert.ok(unmatched, "asset_test_0504 应未匹配");
      ok("unmatched: 0504 无匹配项");
    }

    console.log(`\nmediaRelinker.test: ${passed} 项通过。`);
  } finally {
    // 恢复 media-assets.json
    await writeMediaAssets(originalAssets);
    // 清理临时目录
    await rm(TEST_PROJECT, { recursive: true, force: true });
    await rm(TEST_SCAN_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("mediaRelinker.test 失败:", err);
  process.exit(1);
});
