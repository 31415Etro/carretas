import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { applyStockMovement } from "@/lib/stock-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Corrige a quantidade em estoque da matéria-prima na empresa em uso. Corpo: { quantity, reason }.
 * Lança um "Ajuste de inventario" só da diferença no depósito padrão da empresa (o histórico fica na aba Estoque e movimentações).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Matéria-prima inválida." }, { status: 400 })
  try {
    const { quantity, reason } = await request.json() as { quantity: number; reason?: string }
    const target = Math.round(Number(quantity) * 1000) / 1000
    if (!Number.isFinite(target) || target < 0) return NextResponse.json({ error: "Informe a quantidade em estoque (zero ou mais)." }, { status: 400 })
    if (!String(reason || "").trim()) return NextResponse.json({ error: "Informe o motivo do ajuste." }, { status: 400 })
    const availability = await context.admin.rpc("material_availability", { p_material_id: id })
    if (availability.error) throw new Error(availability.error.message)
    const current = Number((Array.isArray(availability.data) ? availability.data[0] : availability.data)?.physical || 0)
    const difference = Math.round((target - current) * 1000) / 1000
    if (!difference) return NextResponse.json({ ok: true, previous: current, quantity: target, difference: 0 })
    const warehouse = await context.admin.rpc("company_default_warehouse")
    if (warehouse.error || !warehouse.data) throw new Error(warehouse.error?.message || "A empresa não tem depósito padrão.")
    const movement = await applyStockMovement(context.admin, {
      materialId: id,
      movementType: "Ajuste de inventario",
      quantity: Math.abs(difference),
      ...(difference > 0 ? { toWarehouseId: String(warehouse.data) } : { fromWarehouseId: String(warehouse.data) }),
      responsible: context.responsible,
      documentReference: "Ajuste manual de quantidade",
      reason: String(reason).trim().slice(0, 300),
    })
    return NextResponse.json({ ok: true, previous: current, quantity: target, difference, movement })
  } catch (error) {
    return stockError(error, "Não foi possível ajustar a quantidade.")
  }
}
