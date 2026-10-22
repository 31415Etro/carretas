import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { kitError, listKits, saveKit } from "@/lib/kits-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: unknown) => {
  const mapped = kitError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/** Lista paginada de kits. ?q=&status=&categoria=&ordem=name|sku|cost|products|updated&desc=1&pagina=1&tamanho=25 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    return NextResponse.json(await listKits(context.admin, {
      q: params.get("q") || "", status: params.get("status") || "", category: params.get("categoria") || "", order: params.get("ordem") || "name",
      desc: params.get("desc") === "1", page: Number(params.get("pagina")) || 1, pageSize: Number(params.get("tamanho")) || 25,
    }))
  } catch (error) {
    return fail(error)
  }
}

/** Cria o kit com a primeira versão. Corpo: { form, activate }. SKU automático KIT-000001 ou informado. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { form, activate } = await request.json()
    if (!form || typeof form !== "object") throw new Error("Envie os dados do kit.")
    return NextResponse.json(await saveKit(context.admin, { form, activate: Boolean(activate) }), { status: 201 })
  } catch (error) {
    return fail(error)
  }
}
