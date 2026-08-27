import { PublishCenter } from "../../components/publisher/PublishCenter";

export const metadata = { title: "发布" };

export default function PublishPage() {
  return (
    <main className="page-shell publish-page-shell">
      <PublishCenter />
    </main>
  );
}
