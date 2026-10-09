"use client"

import { ErpDashboard } from "@/components/dashboard/erp-dashboard"
import { ModulePlaceholder } from "@/components/shell/module-placeholder"
import { useAuth } from "@/lib/auth-context"

export function DashboardSwitch() {
  const { user } = useAuth()
  if (user?.role === "client") return <ModulePlaceholder title="Portal do cliente" description="Acompanhamento das suas ordens de serviço." />
  return <ErpDashboard />
}
