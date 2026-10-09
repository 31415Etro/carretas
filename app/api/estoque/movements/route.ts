import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { applyStockMovement, stockMovementTypes, toMovement, type StockMovementInput } from "@/lib/stock-engine"

const manualTypes = new Set<string>(stockMovementTypes.filter((type) => type !== "Saldo inicial"))

export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const url = new URL(request.url)
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 50)))
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0))
    let query = context.admin
      .from("stock_movements")
      .select("*, material:materials(name,internal_code,unit)", { count: "exact" })
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
    const materialId = url.searchParams.get("materialId")
    const type = url.searchParams.get("type")
    const warehouseId = url.searchParams.get("warehouseId")
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    if (materialId) query = query.eq("material_id", materialId)
    if (type) query = query.eq("movement_type", type)
    if (warehouseId) query = query.or(`from_warehouse_id.eq.${warehouseId},to_warehouse_id.eq.${warehouseId}`)
    if (from) query = query.gte("occurred_at", `${from}T00:00:00`)
    if (to) query = query.lte("occurred_at", `${to}T23:59:59`)
    const { data, count, error } = await query.range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)
    return NextResponse.json({
      movements: (data || []).map((row: any) => ({ ...toMovement(row), materialName: row.material?.name || "", materialCode: row.material?.internal_code || "", unit: row.material?.unit || "" })),
      count: count || 0,
    })
  } catch (error) {
    return stockError(error, "Erro ao carregar movimentações.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const inputs: StockMovementInput[] = Array.isArray(body.movements) ? body.movements : [body.movement]
    if (!inputs.length || inputs.some((item) => !item?.materialId || !manualTypes.has(item.movementType))) {
      return NextResponse.json({ error: "Informe item, tipo de movimentação válido e quantidade." }, { status: 400 })
    }
    const saved = []
    for (const input of inputs) {
      saved.push(await applyStockMovement(context.admin, { ...input, quantity: Number(input.quantity), responsible: input.responsible || context.responsible }))
    }
    return NextResponse.json({ movements: saved })
  } catch (error) {
    return stockError(error, "Erro ao registrar movimentação.")
  }
}
