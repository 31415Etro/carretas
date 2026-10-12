import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError, listOpportunities, saveOpportunity } from "@/lib/commercial-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = commercialError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ opportunities: await listOpportunities(context.admin) })
  } catch (error) {
    return bad(error, "Erro ao carregar oportunidades.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { opportunity } = await request.json()
    return NextResponse.json({ opportunity: await saveOpportunity(context.admin, opportunity || {}, context.responsible) })
  } catch (error) {
    return bad(error, "Erro ao salvar oportunidade.")
  }
}
