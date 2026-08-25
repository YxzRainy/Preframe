import { DashboardWorkspace } from "../components/dashboard/DashboardWorkspace";
import { loadDashboardData } from "../lib/dashboardData";
import { listTasks } from "../../src/services/taskManager";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [dashboard, tasks] = await Promise.all([
    loadDashboardData().catch(() => undefined),
    listTasks().catch(() => undefined),
  ]);
  return <DashboardWorkspace initialNowIso={new Date().toISOString()} initialData={dashboard} initialTasks={tasks} />;
}
