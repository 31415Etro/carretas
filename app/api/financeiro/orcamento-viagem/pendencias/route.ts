import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { advanceError, listPendingReview } from "@/lib/travel-advance-server"

/** Todos os registros (notinhas) à espera de aprovação do financeiro, de antecipações de reembolso para viagem já finalizadas pelo funcionário. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await listPendingReview(context.admin) })
  } catch (error) {
    const message = advanceError(error, "Erro ao carregar as pendências.").message
    return NextResponse.json({ error: message }, { status: /instalado no banco/.test(message) ? 503 : 400 })
  }
}
