import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listEmployeeOptions } from "@/lib/travel-advance-server"

/** Funcionários ativos para escolher no "Nova antecipação de reembolso para viagem", já com os dados bancários salvos no cadastro dele. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ employees: await listEmployeeOptions(context.admin) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar funcionários." }, { status: 400 })
  }
}
