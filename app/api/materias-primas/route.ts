import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listRawMaterials, rawMaterialError, saveRawMaterial } from "@/lib/raw-materials-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: unknown) => {
  const mapped = rawMaterialError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/** Lista de matérias-primas com custo vigente e a posição de estoque da empresa em uso. ?q=&status=&abaixoMinimo=1 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const items = await listRawMaterials(context.admin, { q: params.get("q") || "", status: params.get("status") || "", belowMinimum: params.get("abaixoMinimo") === "1" })
    return NextResponse.json({ items })
  } catch (error) {
    return fail(error)
  }
}

/** Cria a matéria-prima. Corpo: { form } (os mesmos campos da tela). SKU automático (MP-000001) ou informado. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { form } = await request.json()
    if (!form || typeof form !== "object") throw new Error("Envie os dados da matéria-prima.")
    return NextResponse.json(await saveRawMaterial(context.admin, { form, responsible: context.responsible }), { status: 201 })
  } catch (error) {
    return fail(error)
  }
}
