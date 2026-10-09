import { NextResponse } from "next/server"
import { isMissing, loadOs, OS_MIGRATION_HINT } from "@/lib/os-server"
import { stockContext } from "@/lib/stock-api"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const order = await loadOs(context.admin, (await params).id)
    if (!order) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 })
    return NextResponse.json({ order })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar OS."
    return NextResponse.json({ error: isMissing(message) ? OS_MIGRATION_HINT : message }, { status: isMissing(message) ? 503 : 400 })
  }
}
