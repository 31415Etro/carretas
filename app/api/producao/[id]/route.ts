import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { releaseOf } from "@/lib/vehicle-documentation-server"
import {
  cancelProductionOrder, changeProductionStatus, completeProduction, generateOrderPurchaseRequest, productionOrderDetail, recordConsumption, reserveMaterials, salesError, updateProductionPlan,
} from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = salesError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

const withRelease = async (admin: Parameters<typeof productionOrderDetail>[0], id: string) => {
  const detail = await productionOrderDetail(admin, id)
  const salesOrderId = detail.order?.sales_order_id
  if (!salesOrderId) return { ...detail, release: { eligible: true, blockers: [] } }
  try {
    return { ...detail, release: await releaseOf(admin, String(salesOrderId)) }
  } catch {
    return detail  // script 224 ainda não instalado
  }
}

/** Detalhes da ordem: kits e versões congelados, materiais (previsto, reservado, consumido), plano de materiais, consumos, lotes concluídos com custo, histórico e custos. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 })
  try {
    return NextResponse.json({ detail: await withRelease(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Ações da ordem (cada uma idempotente ou protegida no banco). Corpo:
 *  { action: "reserve" } | { action: "status", to: "start"|"pause"|"resume"|"inspection"|"back_to_production", reason? } |
 *  { action: "consume", materialId, quantity, unit?, kind?, warehouseId?, requestKey?, notes? } | { action: "complete", quantity, warehouseId?, requestKey?, autoConsume?, notes? } |
 *  { action: "plan", responsible?, priority?, plannedStart?, plannedEnd? } | { action: "purchase_request" } | { action: "cancel", reason }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 })
  try {
    const body = await request.json()
    let result: unknown = { ok: true }
    switch (body.action) {
      case "reserve": result = await reserveMaterials(context.admin, id, context.responsible); break
      case "status": result = await changeProductionStatus(context.admin, id, String(body.to || ""), context.responsible, body.reason); break
      case "consume":
        if (!uuid.test(String(body.materialId || ""))) throw new Error("Escolha o material consumido.")
        result = await recordConsumption(context.admin, id, { materialId: body.materialId, quantity: Number(body.quantity), unit: body.unit, kind: body.kind, warehouseId: body.warehouseId, responsible: context.responsible, requestKey: body.requestKey, notes: body.notes })
        break
      case "complete": result = await completeProduction(context.admin, id, { quantity: Number(body.quantity), responsible: context.responsible, warehouseId: body.warehouseId, requestKey: body.requestKey, autoConsume: Boolean(body.autoConsume), notes: body.notes }); break
      case "plan": await updateProductionPlan(context.admin, { production_order_id: id, responsible: body.responsible, priority: body.priority, planned_start: body.plannedStart, planned_end: body.plannedEnd }); break
      case "purchase_request": result = { request_id: await generateOrderPurchaseRequest(context.admin, id, context.responsible) }; break
      case "cancel": await cancelProductionOrder(context.admin, id, String(body.reason || "")); break
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
    return NextResponse.json({ result, detail: await withRelease(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}
