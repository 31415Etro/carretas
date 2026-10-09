import { NextResponse } from "next/server"
import { dashboardViewer } from "@/lib/dashboard-erp-server"

export const dynamic = "force-dynamic"

const allowedKeys = ["period", "start", "end", "costCenterId", "providerId", "sections", "hiddenIndicators", "chartType", "refreshMinutes"]

/** Configuração do dashboard por usuário (período, filtros, indicadores, gráfico, atualização). */
export async function GET() {
  const viewer = await dashboardViewer()
  if (!viewer) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  const { data, error } = await viewer.admin.from("dashboard_preferences").select("config").eq("user_id", viewer.user.id).maybeSingle()
  if (error) return NextResponse.json({ config: null, warning: error.message })
  return NextResponse.json({ config: data?.config || null })
}

export async function PUT(request: Request) {
  const viewer = await dashboardViewer()
  if (!viewer) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  const { config } = await request.json()
  if (!config || typeof config !== "object") return NextResponse.json({ error: "Configuração inválida." }, { status: 400 })
  const clean = Object.fromEntries(Object.entries(config).filter(([key]) => allowedKeys.includes(key)))
  const { error } = await viewer.admin.from("dashboard_preferences").upsert({ user_id: viewer.user.id, config: clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
  if (error) return NextResponse.json({ error: /does not exist|Could not find|schema cache/i.test(error.message) ? "Rode scripts/204_dashboard_preferencias.sql para salvar a configuração." : error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
