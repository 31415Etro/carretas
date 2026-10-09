import { NextResponse } from "next/server"
import { buildDashboard, type DashboardSection } from "@/lib/dashboard-erp"
import { dashboardViewer, loadDashboardData } from "@/lib/dashboard-erp-server"

export const dynamic = "force-dynamic"

const isoDate = /^\d{4}-\d{2}-\d{2}$/

function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
}

/**
 * Indicadores do dashboard. Parâmetros: start, end, costCenterId, providerId, sections
 * (lista separada por vírgula) e detail (chave do indicador para listar os registros de origem).
 * Só retorna seções que o usuário tem permissão de ver.
 */
export async function GET(request: Request) {
  const viewer = await dashboardViewer()
  if (!viewer) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  try {
    const url = new URL(request.url)
    const today = todayInBrazil()
    const start = isoDate.test(url.searchParams.get("start") || "") ? url.searchParams.get("start")! : `${today.slice(0, 7)}-01`
    const end = isoDate.test(url.searchParams.get("end") || "") ? url.searchParams.get("end")! : today
    if (start > end) return NextResponse.json({ error: "A data inicial não pode ser posterior à final." }, { status: 400 })
    const requested = (url.searchParams.get("sections") || "").split(",").filter(Boolean) as DashboardSection[]
    const sections = requested.length ? viewer.sections.filter((section) => requested.includes(section)) : viewer.sections
    const detail = url.searchParams.get("detail") || ""
    const detailSection = ({ fin: "financeiro", est: "estoque", os: "os", frota: "frota", com: "comercial" } as Record<string, DashboardSection>)[detail.split(".")[0]]
    if (detail && (!detailSection || !viewer.sections.includes(detailSection))) {
      return NextResponse.json({ error: "Sem permissão para este indicador." }, { status: 403 })
    }

    const { data, warnings } = await loadDashboardData(viewer.admin, detail ? [detailSection] : sections, start, end)
    const result = buildDashboard(data, { start, end, today, costCenterId: url.searchParams.get("costCenterId") || "", providerId: url.searchParams.get("providerId") || "" })
    if (detail) {
      const table = result.details[detail]
      if (!table) return NextResponse.json({ error: "Indicador desconhecido." }, { status: 404 })
      return NextResponse.json({ detail: { ...table, rows: table.rows.slice(0, 500), total: table.rows.length } })
    }
    const visible = Object.fromEntries(Object.entries(result.sections).filter(([section]) => sections.includes(section as DashboardSection)))
    // Listas dos filtros "centro de custo" e "usuário/equipe" (responsável pela OS).
    const [costCenters, providers] = await Promise.all([
      viewer.admin.from("cost_centers").select("id,name").eq("status", "Ativo").order("name"),
      viewer.admin.from("providers").select("id,full_name").order("full_name"),
    ])
    return NextResponse.json({
      period: { start, end, today },
      allowedSections: viewer.sections,
      sections: visible,
      options: {
        costCenters: (costCenters.data || []).map((row) => ({ id: row.id, name: row.name })),
        providers: (providers.data || []).map((row) => ({ id: row.id, name: row.full_name })),
      },
      warnings,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao montar o dashboard." }, { status: 500 })
  }
}
