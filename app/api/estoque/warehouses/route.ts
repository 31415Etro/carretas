import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { toWarehouse } from "@/lib/stock-engine"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { data, error } = await context.admin.from("warehouses").select("*").order("is_default", { ascending: false }).order("name")
    if (error) throw new Error(error.message)
    return NextResponse.json({ warehouses: (data || []).map(toWarehouse) })
  } catch (error) {
    return stockError(error, "Erro ao carregar depósitos.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { warehouse } = await request.json()
    if (!String(warehouse?.name || "").trim()) return NextResponse.json({ error: "Informe o nome do depósito." }, { status: 400 })
    const row = {
      ...(uuid.test(warehouse.id || "") ? { id: warehouse.id } : {}),
      code: String(warehouse.code || "").trim(),
      name: String(warehouse.name).trim(),
      address: warehouse.address || "",
      responsible: warehouse.responsible || "",
      status: warehouse.status === "Inativo" ? "Inativo" : "Ativo",
      notes: warehouse.notes || "",
    }
    if (row.status === "Inativo" && "id" in row) {
      const { data: balance } = await context.admin.from("stock_balances").select("quantity").eq("warehouse_id", row.id).gt("quantity", 0).limit(1)
      if (balance?.length) return NextResponse.json({ error: "O depósito ainda tem saldo. Transfira os itens antes de inativar." }, { status: 400 })
    }
    const { data, error } = await context.admin.from("warehouses").upsert(row, { onConflict: "id" }).select("*").single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ warehouse: toWarehouse(data) })
  } catch (error) {
    return stockError(error, "Erro ao salvar depósito.")
  }
}
