import { ClientEnvironmentPanel } from "@/components/operations/client-environment-panel"

export default async function ClientEnvironmentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const params = await searchParams
  return <ClientEnvironmentPanel initialClientId={params.clientId || ""} />
}
