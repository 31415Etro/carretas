import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { cancelSalesOrder, confirmSalesOrder, confirmSalesPayment, deliverSalesOrder, salesError, salesOrderDetail } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = salesError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

/** Detalhes do pedido: itens com atendimento (pedido, pronto, entregue, em fabricação), ordens de produção, entregas, histórico e pré-visualização do estoque de acabados. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    return NextResponse.json({ detail: await salesOrderDetail(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Ações do pedido. Corpo: { action: "confirm" } | { action: "payment", note? } | { action: "deliver", requestKey?, items?, warehouseId?, notes? } | { action: "cancel", reason }.
 * Confirmar reserva os acabados disponíveis e gera a ordem de produção do restante (idempotente). Entregar baixa os acabados prontos (idempotente pela chave).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    const body = await request.json()
    let result: unknown = { ok: true }
    switch (body.action) {
      case "confirm": result = await confirmSalesOrder(context.admin, id, context.responsible); break
      case "payment": result = await confirmSalesPayment(context.admin, id, context.responsible, body.note); break
      case "deliver": result = await deliverSalesOrder(context.admin, id, context.responsible, { requestKey: body.requestKey, items: body.items, warehouseId: body.warehouseId, notes: body.notes }); break
      case "cancel": await cancelSalesOrder(context.admin, id, String(body.reason || ""), context.responsible); break
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
    return NextResponse.json({ result, detail: await salesOrderDetail(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}
