import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listProducts, productError, saveProduct } from "@/lib/products-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: unknown) => {
  const mapped = productError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/** Lista paginada de produtos finais. ?q=&status=&categoria=&ordem=name|sku|price|cost|margin|stock|updated&desc=1&pagina=1&tamanho=25 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    return NextResponse.json(await listProducts(context.admin, {
      q: params.get("q") || "", status: params.get("status") || "", category: params.get("categoria") || "", order: params.get("ordem") || "name",
      desc: params.get("desc") === "1", page: Number(params.get("pagina")) || 1, pageSize: Number(params.get("tamanho")) || 25,
    }))
  } catch (error) {
    return fail(error)
  }
}

/** Cria o produto. Corpo: { form, withStructure }. SKU automático PRD-000001 ou informado. Não cria saldo nem movimenta estoque. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { form, withStructure } = await request.json()
    if (!form || typeof form !== "object") throw new Error("Envie os dados do produto.")
    return NextResponse.json(await saveProduct(context.admin, { form, withStructure: Boolean(withStructure) }), { status: 201 })
  } catch (error) {
    return fail(error)
  }
}
