import { NextResponse } from "next/server"
import { changeOsStatus, isMissing, OS_MIGRATION_HINT } from "@/lib/os-server"
import { stockContext } from "@/lib/stock-api"

/** Mudança de situação: valida o fluxo, registra histórico, estoque e conta a receber. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { status, reason } = await request.json() as { status: string; reason?: string }
    return NextResponse.json(await changeOsStatus(context.admin, (await params).id, status, String(reason || "").trim(), context.responsible))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao mudar a situação."
    return NextResponse.json({ error: isMissing(message) ? OS_MIGRATION_HINT : message }, { status: isMissing(message) ? 503 : 400 })
  }
}
