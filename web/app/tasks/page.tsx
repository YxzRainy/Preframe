import { TaskList } from "../../components/dashboard/TaskList";

export const metadata = { title: "今日待办 · 片策" };

export default function TasksPage() {
  return (
    <main className="page-shell tasks-page-shell">
      <div className="page-title">
        <div>
          <p className="eyebrow">今日待办</p>
          <h1>把今天的事做完</h1>
          <p>本地持久化，可绑定项目。专注当下，不必焦虑。</p>
        </div>
      </div>
      <TaskList />
    </main>
  );
}
