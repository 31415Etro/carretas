import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { SNAPSHOT_HINT } from "@/lib/central-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Erro ao processar."
  if (/Could not find the function|schema cache/i.test(message)) return NextResponse.json({ error: SNAPSHOT_HINT }, { status: 503 })
  return NextResponse.json({ error: message }, { status: 400 })
}

/** Pendências de vínculo: ordens sem kits/matérias-primas, itens vendidos sem estrutura e kits que nenhuma etapa usa. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { data, error } = await context.admin.rpc("production_link_pendencies")
    if (error) throw error
    return NextResponse.json({ pendencies: data })
  } catch (error) {
    return fail(error)
  }
}

/** Reconciliação assistida de uma ordem antiga sem composição. Só administrador ou gerente; motivo obrigatório; fica na auditoria da ordem. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Só administrador ou gerente reconcilia a composição de uma ordem." }, { status: 403 })
  try {
    const body = await request.json()
    if (!uuid.test(String(body.orderId || ""))) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 })
    const { data, error } = await context.admin.rpc("production_order_relink", { p_order: body.orderId, p_reason: String(body.reason || ""), p_user: context.responsible })
    if (error) throw error
    return NextResponse.json({ result: data })
  } catch (error) {
    return fail(error)
  }
}
