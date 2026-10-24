import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError } from "@/lib/commercial-server"
import { journeyState } from "@/lib/journey-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Estado da Jornada comercial da oportunidade (oportunidade, propostas, pedido e acompanhamento). Só leitura, sem dados financeiros. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { id } = await params
    return NextResponse.json(await journeyState(context.admin, id))
  } catch (error) {
    const { message, status } = commercialError(error, "Erro ao carregar a jornada.")
    return NextResponse.json({ error: message }, { status: /não encontrada|inválida/.test(message) ? 404 : status })
  }
}
