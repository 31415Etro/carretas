import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { kitError, materialOptions } from "@/lib/kits-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Busca de matérias-primas cadastradas para o seletor da composição (custo vigente, disponibilidade da empresa e unidades aceitas). ?q= */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await materialOptions(context.admin, new URL(request.url).searchParams.get("q") || "") })
  } catch (error) {
    const mapped = kitError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
