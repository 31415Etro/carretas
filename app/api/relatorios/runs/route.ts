import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listRuns, reportError, reportUser } from "@/lib/reports-server"

/** Histórico de gerações, exportações e envios (administrador vê todos; os demais, os próprios). */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    return NextResponse.json({ runs: await listRuns(context.admin, user) })
  } catch (error) {
    const { message, status } = reportError(error, "Erro ao carregar o histórico.")
    return NextResponse.json({ error: message }, { status })
  }
}
