import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { kitOptions, productError } from "@/lib/products-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Pesquisa de kits com versão ativa para vincular ao produto. ?q= */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await kitOptions(context.admin, new URL(request.url).searchParams.get("q") || "") })
  } catch (error) {
    const mapped = productError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
