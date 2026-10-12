import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError, partyHistory } from "@/lib/commercial-server"

/** Histórico do cliente/fornecedor: oportunidades, OS, contas a receber e compras. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const params = new URL(request.url).searchParams
  try {
    return NextResponse.json(await partyHistory(context.admin, params.get("clientId") || "", params.get("supplierId") || ""))
  } catch (error) {
    const { message, status } = commercialError(error, "Erro ao carregar histórico.")
    return NextResponse.json({ error: message }, { status })
  }
}
