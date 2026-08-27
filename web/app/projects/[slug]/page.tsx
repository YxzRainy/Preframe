import type { Metadata } from "next";
import { ProjectDetailView } from "../../../components/ProjectDetailView";
import { readProjects } from "../../../../src/services/projectReader";

function decodeProjectSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodeProjectSlug(slug);
  const projects = await readProjects().catch(() => []);
  const project = projects.find((item) => item.slug === decodedSlug);
  return { title: project?.name || decodedSlug };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedSlug = decodeProjectSlug(slug);
  return <ProjectDetailView slug={decodedSlug} />;
}
