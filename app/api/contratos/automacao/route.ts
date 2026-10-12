import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { contractError, runAutomation } from "@/lib/contracts-server"

/** Roda a automação da empresa selecionada (cobranças, OS periódicas e alertas). Pode ser repetida sem duplicar. */
export async function POST() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await runAutomation(context.admin))
  } catch (error) {
    const { message, status } = contractError(error, "Erro na automação de contratos.")
    return NextResponse.json({ error: message }, { status })
  }
}
