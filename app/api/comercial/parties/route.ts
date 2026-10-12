import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { commercialError, listParties, saveParty } from "@/lib/commercial-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = commercialError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ parties: await listParties(context.admin) })
  } catch (error) {
    return bad(error, "Erro ao carregar cadastros.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { party } = await request.json()
    return NextResponse.json({ party: await saveParty(context.admin, party || {}) })
  } catch (error) {
    return bad(error, "Erro ao salvar cadastro.")
  }
}
