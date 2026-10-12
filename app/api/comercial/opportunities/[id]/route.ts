import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { addInteraction, commercialError, listInteractions } from "@/lib/commercial-server"

type Params = { params: Promise<{ id: string }> }

const bad = (error: unknown, fallback: string) => {
  const { message, status } = commercialError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

/** Histórico de interações e OS abertas a partir da oportunidade. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await listInteractions(context.admin, id))
  } catch (error) {
    return bad(error, "Erro ao carregar histórico.")
  }
}

/** Registra uma interação (ligação, WhatsApp, reunião...) e, opcionalmente, o próximo contato. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { interaction } = await request.json()
    await addInteraction(context.admin, id, interaction || {}, context.responsible)
    return NextResponse.json(await listInteractions(context.admin, id))
  } catch (error) {
    return bad(error, "Erro ao registrar interação.")
  }
}
