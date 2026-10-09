"use client"

import { ErpDashboard } from "@/components/dashboard/erp-dashboard"
import { OperationsDashboardBackendPage } from "@/components/operations/dashboard-backend-page"
import { useAuth } from "@/lib/auth-context"

/** Usuários internos veem o dashboard ERP; clientes externos continuam com o painel das suas OS. */
export function DashboardSwitch() {
  const { user } = useAuth()
  return user?.role === "client" ? <OperationsDashboardBackendPage /> : <ErpDashboard />
}
