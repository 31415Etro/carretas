import { WorkVisualDashboard } from "@/components/operations/work-visual-dashboard"

export default async function WorkDashboardPage({ searchParams }: { searchParams: Promise<{ clientId?: string; workId?: string; orderIds?: string }> }) {
  const params = await searchParams
  return <WorkVisualDashboard initialClientId={params.clientId || ""} initialWorkId={params.workId || ""} initialOrderIds={(params.orderIds || "").split(",").filter(Boolean)} />
}
