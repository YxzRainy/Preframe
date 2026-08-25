import { ProjectList } from "../../components/ProjectList";
import { StatusBadge } from "../../components/StatusBadge";

export default function ProjectsPage() {
  return (
    <main className="page-shell project-library-shell">
      <div className="page-title">
        <div>
          <p className="eyebrow">项目库</p>
          <h1>项目库</h1>
          <p>管理所有内容项目，继续修改文档、扫描素材或导出 Markdown。</p>
        </div>
        <div className="library-actions"><StatusBadge tone="ready">本地存储正常</StatusBadge></div>
      </div>
      <div className="library-metrics"><div><span>工作模式</span><strong>本地运行</strong></div><div><span>项目输出</span><strong>10 份策划文档</strong></div><div><span>数据位置</span><strong>本地输出目录</strong></div></div>
      <ProjectList />
    </main>
  );
}
