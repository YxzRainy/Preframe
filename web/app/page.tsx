import { DashboardWorkspace } from "../components/dashboard/DashboardWorkspace";
import { loadDashboardData } from "../lib/dashboardData";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await loadDashboardData().catch(() => undefined);
  return <DashboardWorkspace initialNowIso={new Date().toISOString()} initialData={dashboard} />;
}
