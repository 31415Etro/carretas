import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { contractError, listContracts, saveContract } from "@/lib/contracts-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = contractError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ contracts: await listContracts(context.admin) })
  } catch (error) {
    return bad(error, "Erro ao carregar contratos.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { contract } = await request.json()
    return NextResponse.json(await saveContract(context.admin, contract || {}, context.responsible))
  } catch (error) {
    return bad(error, "Erro ao salvar contrato.")
  }
}
