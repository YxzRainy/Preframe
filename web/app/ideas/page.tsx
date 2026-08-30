import { IdeaInbox } from "../../components/ideas/IdeaInbox";
import { ContentAssetPanel } from "../../components/ideas/ContentAssetPanel";

export const metadata = { title: "灵感" };

export default function IdeasPage() {
  return (
    <main className="page-shell idea-page-shell">
      <IdeaInbox />
      <ContentAssetPanel />
    </main>
  );
}
