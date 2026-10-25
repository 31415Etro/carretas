import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError } from "@/lib/commercial-server"
import { structureFacts } from "@/lib/production-links-server"
import { structureProblems } from "@/lib/production-links"

/** Listas de apoio dos formulários: condições de pagamento e produtos/serviços de interesse. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const [conditions, materials] = await Promise.all([
      context.admin.from("payment_conditions").select("id,name").eq("status", "Ativo").order("name"),
      context.admin.from("materials").select("id,name,internal_code,unit,sale_price,item_type,available_for_quote").eq("status", "Ativo").eq("item_type", "Produto").order("name").limit(2000),
    ])
    // produto sem estrutura de fabricação (kits e matérias-primas) não consegue virar produção: avisa já na hora de escolher
    const sellable = (materials.data || []).filter((row) => row.available_for_quote !== false)
    const facts = await structureFacts(context.admin, sellable.map((row) => row.id as string)).catch(() => null)
    const problemOf = (row: { id: string; name: string }) => (facts ? structureProblems([{ productId: row.id, name: row.name }], facts)[0]?.problem || "" : "")
    return NextResponse.json({
      paymentConditions: (conditions.data || []).map((row) => ({ id: row.id, name: row.name })),
      products: (materials.data || []).filter((row) => row.available_for_quote !== false).map((row) => ({ id: row.id, name: row.name, code: row.internal_code || "", unit: row.unit || "UN", price: Number(row.sale_price || 0), structureProblem: problemOf(row as { id: string; name: string }) })),
    })
  } catch (error) {
    const { message, status } = commercialError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
