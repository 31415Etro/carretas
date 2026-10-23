import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { engError, productionSheet } from "@/lib/engineering-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ficha de fabricação: configuração CONGELADA da venda (modelo, medidas, desenho, kits, materiais, cortes, acabamento, acessórios, revisão). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 })
  try {
    return NextResponse.json({ sheet: await productionSheet(context.admin, id) })
  } catch (error) {
    const mapped = engError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
