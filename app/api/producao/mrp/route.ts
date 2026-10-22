import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { mrpOverview, salesError } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Planejamento de materiais: necessidade consolidada das ordens abertas x saldo livre x compras em andamento. Só leitura (não reserva nem consome). */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await mrpOverview(context.admin) })
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
