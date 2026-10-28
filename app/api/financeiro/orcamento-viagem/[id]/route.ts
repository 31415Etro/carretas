import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { advanceError, cancelAdvance, getAdvanceDetail, markSettlementResolved } from "@/lib/travel-advance-server"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await getAdvanceDetail(context.admin, (await params).id))
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao carregar a antecipação de reembolso para viagem.").message }, { status: 400 })
  }
}

/** action: "cancelar" (só se ainda Aberto) | "resolver_devolucao" (financeiro confirma que recebeu/descontou o saldo). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { id } = await params
    const body = await request.json()
    if (body.action === "cancelar") await cancelAdvance(context.admin, id)
    else if (body.action === "resolver_devolucao") await markSettlementResolved(context.admin, id, String(body.note || ""))
    else return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao atualizar a antecipação de reembolso para viagem.").message }, { status: 400 })
  }
}
