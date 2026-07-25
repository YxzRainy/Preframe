import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { setOutputDir, getWorkspaceStats, canAccessDirectory } from "../../../../../src/services/workspaceConfig";

const execAsync = promisify(exec);

export async function POST() {
  try {
    if (os.platform() !== "darwin") {
      return NextResponse.json(
        { error: "原生文件夹选择当前仅支持 macOS 系统。" },
        { status: 400 }
      );
    }

    const script = `osascript -e 'tell application "System Events" to activate' -e 'tell application "System Events" to choose folder with prompt "选择片策输出目录"' -e 'POSIX path of result'`;
    
    let stdout;
    try {
      const result = await execAsync(script);
      stdout = result.stdout;
    } catch (e) {
      // User likely cancelled the picker
      return NextResponse.json({ canceled: true });
    }

    const selectedPath = stdout.trim();
    
    if (!selectedPath) {
      return NextResponse.json({ canceled: true });
    }

    // Safety checks
    if (selectedPath === "/" || selectedPath === "/System" || selectedPath === "/Library") {
      return NextResponse.json({ error: "安全限制：禁止选择系统根目录作为工作区。" }, { status: 400 });
    }

    const isWritable = await canAccessDirectory(selectedPath);
    if (!isWritable) {
      return NextResponse.json({ error: "所选目录不存在或不可写，请选择其他文件夹。" }, { status: 400 });
    }

    const resolved = await setOutputDir(selectedPath);
    const workspace = await getWorkspaceStats();

    return NextResponse.json({ workspace });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文件夹选择失败。" },
      { status: 500 }
    );
  }
}
