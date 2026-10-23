import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { createManualDocumentation, docError, documentationDashboard, listDocumentation } from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Documentação veicular por unidade da empresa. ?q=(pedido, cliente, chassi, protocolo)&status=abertas|atencao|<situação>&pedido=<id>&pagina=&tamanho=. Com ?painel=1 devolve também os indicadores. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const list = await listDocumentation(context.admin, { q: params.get("q") || "", status: params.get("status") || "", orderId: params.get("pedido") || "", page: Number(params.get("pagina")) || 1, pageSize: Number(params.get("tamanho")) || 25 })
    return NextResponse.json(params.get("painel") ? { ...list, dashboard: await documentationDashboard(context.admin) } : list)
  } catch (error) {
    const mapped = docError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Abre a documentação de uma carreta sem pedido de venda (avulsa ou por ordem de produção). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const result = await createManualDocumentation(context.admin, { clientId: String(body.clientId || ""), productId: body.productId, productionOrderId: body.productionOrderId, vin: body.vin, notes: body.notes }, context.responsible)
    return NextResponse.json({ result })
  } catch (error) {
    const mapped = docError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
