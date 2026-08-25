import { PublishCenter } from "../../components/publisher/PublishCenter";

export const metadata = { title: "矩阵发布中心 · 片策" };

export default function PublishPage() {
  return (
    <main className="page-shell publish-page-shell">
      <PublishCenter />
    </main>
  );
}
