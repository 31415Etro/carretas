import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { registryError } from "@/lib/registry-server"

/** Listas dos campos de seleção: vendedores, condições de pagamento e tabelas de preço. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const [people, conditions, tables] = await Promise.all([
      context.admin.from("salespeople").select("id,name").eq("status", "Ativo").order("name"),
      context.admin.from("payment_conditions").select("id,name").order("name"),
      context.admin.from("price_tables").select("id,name").order("name"),
    ])
    const options = (result: { data: any[] | null }) => (result.data || []).map((row) => ({ value: row.id as string, label: row.name as string }))
    return NextResponse.json({ salespeople: options(people), paymentConditions: options(conditions), priceTables: options(tables) })
  } catch (error) {
    const { message, status } = registryError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
