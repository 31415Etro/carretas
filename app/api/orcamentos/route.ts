import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listQuotes, quoteError, saveQuote } from "@/lib/quotes-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = quoteError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ quotes: await listQuotes(context.admin) })
  } catch (error) {
    return bad(error, "Erro ao carregar orçamentos.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { quote } = await request.json()
    return NextResponse.json(await saveQuote(context.admin, quote || {}, context.responsible))
  } catch (error) {
    return bad(error, "Erro ao salvar orçamento.")
  }
}
