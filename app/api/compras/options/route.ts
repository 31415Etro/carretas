import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

/** Listas do formulário de pedido: condições de pagamento, categorias de despesa e centros de custo. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  const [conditions, categories, costCenters] = await Promise.all([
    context.admin.from("payment_conditions").select("id,name,installments,first_due_days,interval_days,payment_method").eq("status", "Ativo").order("name"),
    context.admin.from("financial_categories").select("id,name,type").eq("status", "Ativo").in("type", ["saida", "ambos"]).order("name"),
    context.admin.from("cost_centers").select("id,name").eq("status", "Ativo").order("name"),
  ])
  return NextResponse.json({
    paymentConditions: (conditions.data || []).map((row) => ({ id: row.id, name: row.name, installments: Number(row.installments || 1), firstDueDays: Number(row.first_due_days || 0), intervalDays: Number(row.interval_days ?? 30), paymentMethod: row.payment_method || "" })),
    categories: (categories.data || []).map((row) => ({ id: row.id, name: row.name })),
    costCenters: (costCenters.data || []).map((row) => ({ id: row.id, name: row.name })),
    // Tabelas ausentes (migrações 201 ainda não rodadas) não bloqueiam o pedido.
    warnings: [conditions.error, categories.error, costCenters.error].filter(Boolean).map((error) => error!.message),
  })
}
