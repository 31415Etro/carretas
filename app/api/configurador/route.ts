import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import * as eng from "@/lib/engineering-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = eng.engError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

/** O que o vendedor pode personalizar (limites efetivos, referências, opções, desenho) ou, com ?configuracao=<id>, uma configuração gravada. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const params = new URL(request.url).searchParams
  try {
    const configuration = params.get("configuracao")
    if (configuration) {
      if (!uuid.test(configuration)) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 })
      return NextResponse.json({ configuration: await eng.configurationGet(context.admin, configuration) })
    }
    const product = params.get("produto") || ""
    if (!uuid.test(product)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
    return NextResponse.json({ spec: await eng.configuratorSpec(context.admin, product) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Corpo: { action: "calculate" | "save", productId, params, options, plannedLoad?, configurationId?, quoteItemId? } |
 *        { action: "request_review", configurationId, reason } | { action: "decide_review", reviewId, decision, note } (admin/gerente) |
 *        { action: "reconfigure", itemId, configurationId, reason } (admin/gerente: troca controlada da configuração vendida).
 * "calculate" só calcula (nada é gravado). O vendedor não altera parâmetros homologados: só escolhe valores DENTRO dos limites cadastrados pela engenharia.
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const manager = context.role === "admin" || context.role === "manager"
    const input = { product_id: body.productId, params: body.params || {}, options: body.options || {}, planned_load: body.plannedLoad ?? null, configuration_id: body.configurationId || null, quote_item_id: body.quoteItemId || null }
    switch (body.action) {
      case "calculate": return NextResponse.json({ result: await eng.configure(context.admin, input) })
      case "save": return NextResponse.json({ result: await eng.configurationSave(context.admin, input, context.responsible) })
      case "request_review": return NextResponse.json({ reviewId: await eng.reviewRequest(context.admin, String(body.configurationId), String(body.reason || ""), context.responsible) })
      case "decide_review":
        if (!manager) return NextResponse.json({ error: "Somente administrador ou gerente (engenharia) decide a análise técnica." }, { status: 403 })
        return NextResponse.json({ result: await eng.reviewDecide(context.admin, String(body.reviewId), String(body.decision), String(body.note || ""), context.responsible) })
      case "reconfigure":
        if (!manager) return NextResponse.json({ error: "Somente administrador ou gerente altera a configuração de um pedido." }, { status: 403 })
        return NextResponse.json({ result: await eng.reconfigureItem(context.admin, String(body.itemId), String(body.configurationId), String(body.reason || ""), context.responsible) })
      case "ack_doc_review":
        await eng.ackConfigReview(context.admin, String(body.documentationId), String(body.note || ""), context.responsible)
        return NextResponse.json({ ok: true })
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
  } catch (error) {
    return fail(error)
  }
}
