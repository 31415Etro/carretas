import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { activateVersion, capacity, compareVersions, explosion, productDetail, productError, saveProduct } from "@/lib/products-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = productError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/**
 * Detalhes do produto. ?versao=<id> mostra outra versão da estrutura; ?comparar=<idA>,<idB> devolve as diferenças;
 * ?explosao=<qtd> devolve a explosão de materiais (árvore + consolidada) da versão exibida; ?capacidade=1 devolve "quantas unidades posso fabricar?".
 * Nenhuma dessas consultas reserva, consome ou movimenta estoque.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try {
    const query = new URL(request.url).searchParams
    const compare = (query.get("comparar") || "").split(",")
    if (compare.length === 2 && compare.every((value) => uuid.test(value))) return NextResponse.json({ differences: await compareVersions(context.admin, compare[0], compare[1]) })
    const version = query.get("versao")
    if (version && !uuid.test(version)) return NextResponse.json({ error: "Versão inválida." }, { status: 400 })
    if (query.get("capacidade")) return NextResponse.json({ capacity: await capacity(context.admin, id, version) })
    if (query.get("explosao")) {
      const quantity = Number(query.get("explosao"))
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return NextResponse.json({ error: "Informe uma quantidade maior que zero." }, { status: 400 })
      const detail = await productDetail(context.admin, id, version)
      if (!detail.shown_version_id) return NextResponse.json({ error: "Este produto ainda não tem estrutura de fabricação." }, { status: 422 })
      return NextResponse.json({ explosion: await explosion(context.admin, detail.shown_version_id, quantity), version_id: detail.shown_version_id })
    }
    return NextResponse.json({ detail: await productDetail(context.admin, id, version) })
  } catch (error) {
    return fail(error)
  }
}

/** Salva o produto. Corpo: { form, withStructure? } ou { action: "activate", versionId }. Estrutura da versão vigente/usada nunca é editada: gera nova versão em rascunho. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try {
    const body = await request.json()
    if (body.action === "activate") {
      if (!uuid.test(String(body.versionId || ""))) throw new Error("Informe a versão a ativar.")
      await activateVersion(context.admin, body.versionId)
      return NextResponse.json({ ok: true })
    }
    if (!body.form || typeof body.form !== "object") throw new Error("Envie os dados do produto.")
    return NextResponse.json(await saveProduct(context.admin, { productId: id, form: body.form, withStructure: Boolean(body.withStructure) }))
  } catch (error) {
    return fail(error)
  }
}
