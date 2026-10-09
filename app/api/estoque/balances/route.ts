import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { readAllPages } from "@/lib/supabase-pagination"

/** Saldo físico por item e depósito (para detalhe do item e contagem de inventário). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const url = new URL(request.url)
    const materialId = url.searchParams.get("materialId")
    const warehouseId = url.searchParams.get("warehouseId")
    const rows = await readAllPages<any>((from, to) => {
      let query = context.admin.from("stock_balances").select("material_id,warehouse_id,quantity,updated_at")
      if (materialId) query = query.eq("material_id", materialId)
      if (warehouseId) query = query.eq("warehouse_id", warehouseId)
      return query.order("material_id").order("warehouse_id").range(from, to)
    })
    return NextResponse.json({ balances: rows.map((row) => ({ materialId: row.material_id, warehouseId: row.warehouse_id, quantity: Number(row.quantity || 0), updatedAt: row.updated_at })) })
  } catch (error) {
    return stockError(error, "Erro ao carregar saldos.")
  }
}
