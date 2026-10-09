import { createAdminClient, createClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"
import type { DashboardData, DashboardSection } from "@/lib/dashboard-erp"

type AdminClient = ReturnType<typeof createAdminClient>

/** Permissão de página exigida para ver cada seção do dashboard. */
export const sectionPermissions: Record<DashboardSection, string> = {
  financeiro: "financeiro",
  estoque: "estoque",
  os: "ordens_servico",
  frota: "frota",
  comercial: "comercial",
}

export async function dashboardViewer() {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role,page_permissions,active").eq("id", user.id).maybeSingle()
  if (!profile || profile.active === false || profile.role === "client") return null
  const permissions: string[] = Array.isArray(profile.page_permissions) ? profile.page_permissions : []
  // Comercial fica oculto até o módulo Comercial ter especificação (as tabelas do funil antigo foram removidas).
  const pendingSections = new Set<DashboardSection>(["comercial"])
  const sections = (Object.keys(sectionPermissions) as DashboardSection[]).filter((section) => !pendingSections.has(section) && (profile.role === "admin" || permissions.includes(sectionPermissions[section])))
  return { user, admin, role: String(profile.role), sections }
}

const missing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)

async function rows(admin: AdminClient, table: string, warnings: string[], build?: (query: any) => any) {
  try {
    return await readAllPages<any>((from, to) => {
      const query = admin.from(table).select("*")
      return (build ? build(query) : query).order("id").range(from, to)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (missing(message)) {
      warnings.push(`${table}: tabela ainda não criada no banco.`)
      return []
    }
    throw error
  }
}

/** Carrega só as tabelas das seções visíveis; períodos longos ficam restritos por data. */
export async function loadDashboardData(admin: AdminClient, sections: DashboardSection[], start: string, end: string) {
  const warnings: string[] = []
  const need = (section: DashboardSection) => sections.includes(section)
  const endOfDay = `${end}T23:59:59`
  const [receivables, payables, transactions, materials, movements, orders, vehicles, maintenance, leads, contracts] = await Promise.all([
    need("financeiro") ? rows(admin, "accounts_receivable", warnings) : [],
    need("financeiro") || need("frota") ? rows(admin, "accounts_payable", warnings) : [],
    need("financeiro") ? rows(admin, "financial_transactions", warnings, (query) => query.eq("status", "Realizado").gte("realized_date", start).lte("realized_date", end)) : [],
    need("estoque") ? rows(admin, "materials", warnings) : [],
    need("estoque") || need("financeiro") ? rows(admin, "stock_movements", warnings, (query) => query.gte("occurred_at", `${start}T00:00:00`).lte("occurred_at", endOfDay)) : [],
    need("os") ? rows(admin, "service_orders", warnings) : [],
    need("frota") ? rows(admin, "vehicles", warnings) : [],
    need("frota") ? rows(admin, "vehicle_maintenance", warnings) : [],
    need("comercial") ? rows(admin, "commercial_leads", warnings) : [],
    need("comercial") ? rows(admin, "contracts", warnings) : [],
  ])

  // Início do serviço = evento "Iniciar serviço" das OS finalizadas no período.
  const orderStarts: Record<string, string> = {}
  const finished = orders.filter((row) => row.finished_at && String(row.finished_at).slice(0, 10) >= start && String(row.finished_at).slice(0, 10) <= end).map((row) => row.id)
  for (let index = 0; index < finished.length; index += 200) {
    const { data, error } = await admin.from("service_order_events").select("service_order_id,step_name,event_datetime").in("service_order_id", finished.slice(index, index + 200)).ilike("step_name", "iniciar%")
    if (error) break
    ;(data || []).forEach((event) => {
      const current = orderStarts[event.service_order_id]
      if (!current || event.event_datetime < current) orderStarts[event.service_order_id] = event.event_datetime
    })
  }

  const clientIds = Array.from(new Set([...receivables.map((row) => row.client_id), ...orders.map((row) => row.client_id)].filter(Boolean)))
  const providerIds = Array.from(new Set(orders.map((row) => row.main_provider_id).filter(Boolean)))
  const clients: Record<string, string> = {}
  const providers: Record<string, string> = {}
  for (let index = 0; index < clientIds.length; index += 200) {
    const { data } = await admin.from("clients").select("id,name").in("id", clientIds.slice(index, index + 200))
    ;(data || []).forEach((row) => { clients[row.id] = row.name })
  }
  for (let index = 0; index < providerIds.length; index += 200) {
    const { data } = await admin.from("providers").select("id,full_name").in("id", providerIds.slice(index, index + 200))
    ;(data || []).forEach((row) => { providers[row.id] = row.full_name })
  }
  const vehicleNames: Record<string, string> = Object.fromEntries(vehicles.map((row) => [row.id, `${row.plate} - ${row.model || ""}`.trim()]))

  const data: DashboardData = { receivables, payables, transactions, materials, movements, orders, orderStarts, vehicles, maintenance, leads, contracts, names: { clients, providers, vehicles: vehicleNames } }
  return { data, warnings }
}
