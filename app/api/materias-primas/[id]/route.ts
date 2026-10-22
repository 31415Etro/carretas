import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { rawMaterialDetail, rawMaterialError, saveRawMaterial } from "@/lib/raw-materials-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = rawMaterialError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/** Página de detalhes: cadastro, estoque por depósito, fornecedores, compras, movimentações, kits que usam o item e ordens que o consomem. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Matéria-prima inválida." }, { status: 400 })
  try {
    return NextResponse.json(await rawMaterialDetail(context.admin, id))
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || ""
    if (/não encontrada/i.test(message)) return NextResponse.json({ error: "Matéria-prima não encontrada." }, { status: 404 })
    return fail(error)
  }
}

/** Atualiza a matéria-prima. SKU de item com histórico só muda com motivo (troca controlada). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Matéria-prima inválida." }, { status: 400 })
  try {
    const { form } = await request.json()
    if (!form || typeof form !== "object") throw new Error("Envie os dados da matéria-prima.")
    return NextResponse.json(await saveRawMaterial(context.admin, { id, form, responsible: context.responsible }))
  } catch (error) {
    return fail(error)
  }
}
