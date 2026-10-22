import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listProductionOrders, productionDashboard, salesError } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Ordens de produção da empresa (?q=&status=abertas|<situação>&pagina=&tamanho=). Com ?painel=1 devolve também os indicadores operacionais (dados reais). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const list = await listProductionOrders(context.admin, { q: params.get("q") || "", status: params.get("status") || "", page: Number(params.get("pagina")) || 1, pageSize: Number(params.get("tamanho")) || 25 })
    return NextResponse.json(params.get("painel") ? { ...list, dashboard: await productionDashboard(context.admin) } : list)
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
