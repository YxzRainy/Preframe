import { ProjectList } from "../../components/ProjectList";

export const metadata = { title: "项目库" };

export default function ProjectsPage() {
  return (
    <main className="page-shell project-library-shell">
      <div className="page-title">
        <div>
          <h1>项目库</h1>
        </div>
      </div>
      <ProjectList />
    </main>
  );
}
