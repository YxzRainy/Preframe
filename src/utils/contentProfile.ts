export interface ContentProfileSource {
  contentSubject?: unknown;
  contentDomain?: unknown;
  accountType?: unknown;
}

const LEGACY_ACCOUNT_MAP: Record<string, { contentSubject: string; contentDomain: string }> = {
  "个人IP": { contentSubject: "个人博主", contentDomain: "" },
  "电商品牌": { contentSubject: "电商店铺", contentDomain: "电商内容" },
  "医美医生IP": { contentSubject: "专业人士IP", contentDomain: "医美科普" },
  "AI认知账号": { contentSubject: "知识账号", contentDomain: "AI" },
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 将旧项目的 accountType 平滑迁移为内容主体与内容领域。 */
export function resolveContentProfile(source: ContentProfileSource): { contentSubject: string; contentDomain: string } {
  const currentSubject = text(source.contentSubject);
  const currentDomain = text(source.contentDomain);
  const legacy = text(source.accountType);
  const mapped = LEGACY_ACCOUNT_MAP[legacy];
  return {
    contentSubject: currentSubject || mapped?.contentSubject || legacy,
    contentDomain: currentDomain || mapped?.contentDomain || "",
  };
}
