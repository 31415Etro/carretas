import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { contractError, loadAlerts } from "@/lib/contracts-server"

/** Alertas de reajuste, renovação, encerramento, documentos e obrigações pendentes. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ alerts: await loadAlerts(context.admin) })
  } catch (error) {
    const { message, status } = contractError(error, "Erro ao carregar alertas.")
    return NextResponse.json({ error: message }, { status })
  }
}
