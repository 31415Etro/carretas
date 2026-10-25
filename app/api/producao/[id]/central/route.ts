import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { centralExtras } from "@/lib/central-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Central de Produção: identificação, configuração vendida, kits com componentes e tarefas por carreta de UMA ordem (tudo da mesma fonte). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 })
  try {
    return NextResponse.json(await centralExtras(context.admin, id))
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Erro ao carregar a ordem."
    return NextResponse.json({ error: message }, { status: /não encontrada/.test(message) ? 404 : 400 })
  }
}
