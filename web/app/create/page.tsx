import { redirect } from "next/navigation";

export const metadata = { title: "创建内容项目 · 片策" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ new: "1" });
  for (const key of ["ideaId", "projectName", "topic", "extra"]) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  redirect(`/?${query.toString()}`);
}
