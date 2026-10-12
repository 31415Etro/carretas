import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError } from "@/lib/commercial-server"

/** Listas de apoio dos formulários: condições de pagamento e produtos/serviços de interesse. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const [conditions, materials] = await Promise.all([
      context.admin.from("payment_conditions").select("id,name").eq("status", "Ativo").order("name"),
      context.admin.from("materials").select("id,name,internal_code").eq("status", "Ativo").order("name").limit(2000),
    ])
    return NextResponse.json({
      paymentConditions: (conditions.data || []).map((row) => ({ id: row.id, name: row.name })),
      products: (materials.data || []).map((row) => ({ id: row.id, name: row.name, code: row.internal_code || "" })),
    })
  } catch (error) {
    const { message, status } = commercialError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
