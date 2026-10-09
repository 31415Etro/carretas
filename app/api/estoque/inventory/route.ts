import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { applyStockMovement } from "@/lib/stock-engine"

/**
 * Fecha uma contagem de inventário: para cada item contado, compara com o saldo do
 * depósito e lança "Ajuste de inventario" só da diferença.
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { warehouseId, counts, reference, notes } = await request.json() as { warehouseId: string; counts: Array<{ materialId: string; counted: number }>; reference?: string; notes?: string }
    if (!warehouseId || !Array.isArray(counts) || !counts.length) return NextResponse.json({ error: "Informe o depósito e ao menos um item contado." }, { status: 400 })
    if (counts.some((item) => !item.materialId || !Number.isFinite(Number(item.counted)) || Number(item.counted) < 0)) {
      return NextResponse.json({ error: "Quantidade contada inválida." }, { status: 400 })
    }
    const { data: balances, error } = await context.admin.from("stock_balances").select("material_id,quantity").eq("warehouse_id", warehouseId).in("material_id", counts.map((item) => item.materialId))
    if (error) throw new Error(error.message)
    const current = new Map<string, number>((balances || []).map((row: any) => [row.material_id, Number(row.quantity || 0)]))
    const documentReference = reference || `Inventário ${new Date().toISOString().slice(0, 10)}`
    const adjustments = []
    for (const item of counts) {
      const difference = Math.round((Number(item.counted) - (current.get(item.materialId) || 0)) * 1000) / 1000
      if (!difference) continue
      adjustments.push(await applyStockMovement(context.admin, {
        materialId: item.materialId,
        movementType: "Ajuste de inventario",
        quantity: Math.abs(difference),
        ...(difference > 0 ? { toWarehouseId: warehouseId } : { fromWarehouseId: warehouseId }),
        responsible: context.responsible,
        documentReference,
        reason: difference > 0 ? "Sobra na contagem de inventário" : "Falta na contagem de inventário",
        notes: notes || "",
      }))
    }
    return NextResponse.json({ adjustments, counted: counts.length })
  } catch (error) {
    return stockError(error, "Erro ao fechar inventário.")
  }
}
