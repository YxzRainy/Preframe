import { ProjectDetailView } from "../../../components/ProjectDetailView";

export default async function ProjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let decodedSlug = slug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    // API 会返回更明确的项目标识错误。
  }
  return <ProjectDetailView slug={decodedSlug} />;
}
