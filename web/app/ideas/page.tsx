import { IdeaInbox } from "../../components/ideas/IdeaInbox";

export const metadata = { title: "灵感收件箱 · 片策" };

export default function IdeasPage() {
  return (
    <main className="page-shell idea-page-shell">
      <div className="page-title">
        <div>
          <p className="eyebrow">灵感收件箱</p>
          <h1>记录每一个想法</h1>
          <p>快速捕捉灵感，需要时可一键转化为内容项目。</p>
        </div>
      </div>
      <IdeaInbox />
    </main>
  );
}
