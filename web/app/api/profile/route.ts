import { NextResponse } from "next/server";
import { getCreatorProfile, resetCreatorProfile, saveCreatorProfile } from "../../../../src/services/profileConfig";

export const runtime = "nodejs";

function profileResponse(profile: { name: string }) {
  return NextResponse.json({ success: true, profile: { name: profile.name, avatarUrl: "/api/profile/avatar" } });
}

export async function GET() {
  try {
    return profileResponse(await getCreatorProfile());
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "创作者资料读取失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (String(form.get("reset") || "") === "true") return profileResponse(await resetCreatorProfile());
      const name = String(form.get("name") || "").trim();
      const avatar = form.get("avatar");
      let upload;
      if (avatar && typeof avatar === "object" && "arrayBuffer" in avatar && "type" in avatar) {
        const file = avatar as File;
        if (file.size > 0) {
          upload = { bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type };
        }
      }
      return profileResponse(await saveCreatorProfile(name, upload));
    }

    const body = await request.json() as Record<string, unknown>;
    if (body.reset === true) return profileResponse(await resetCreatorProfile());
    if (typeof body.name !== "string") throw new Error("昵称不能为空。");
    return profileResponse(await saveCreatorProfile(body.name));
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "创作者资料保存失败。" }, { status: 400 });
  }
}
