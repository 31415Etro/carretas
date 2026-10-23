import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { cancelSalesOrder, confirmSalesOrder, confirmSalesPayment, deliverSalesOrder, salesError, salesOrderDetail } from "@/lib/sales-server"
import { configurationGet, reconfigureItem } from "@/lib/engineering-server"
import { authorizeProduction, docError, documentationSummary, generateDocumentation, listDocumentation, releaseException, releaseOf, revokeAuthorization, salesSettingsGet } from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fullDetail = async (admin: Parameters<typeof salesOrderDetail>[0], id: string) => {
  const detail = await salesOrderDetail(admin, id)
  // documentação por unidade e liberação calculada; se o script 224 ainda não estiver instalado, o pedido segue funcionando sem essas seções
  try {
    const [release, summary, docs, settings] = await Promise.all([releaseOf(admin, id), documentationSummary(admin, { orderId: id }), listDocumentation(admin, { orderId: id, pageSize: 100 }), salesSettingsGet(admin)])
    const rows = (await admin.from("sales_order_items").select("id,configuration_id,material_id").eq("sales_order_id", id)).data || []
    const configurations: Record<string, unknown> = {}
    for (const row of rows) if (row.configuration_id) configurations[row.id as string] = await configurationGet(admin, row.configuration_id).catch(() => null)
    const productIds: Record<string, string> = Object.fromEntries(rows.map((row) => [row.id as string, row.material_id as string]))
    return { ...detail, release, documentation: { summary, items: docs.items }, settings, configurations, productIds }
  } catch {
    return detail
  }
}
const fail = (error: unknown) => {
  const message = String((error as Error)?.message || "")
  const mapped = /Produção bloqueada|documenta|autoriza|chassi|exceção|regra formal|dispensada/i.test(message) ? docError(error) : salesError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

/** Detalhes do pedido: itens com atendimento (pedido, pronto, entregue, em fabricação), ordens de produção, entregas, histórico e pré-visualização do estoque de acabados. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    return NextResponse.json({ detail: await fullDetail(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Ações do pedido. Corpo: { action: "confirm" } | { action: "payment", note? } | { action: "deliver", requestKey?, items?, warehouseId?, notes? } | { action: "cancel", reason }.
 * Confirmar reserva os acabados disponíveis e gera a ordem de produção do restante (idempotente). Entregar baixa os acabados prontos (idempotente pela chave).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    const body = await request.json()
    let result: unknown = { ok: true }
    switch (body.action) {
      case "confirm": result = await confirmSalesOrder(context.admin, id, context.responsible); break
      case "payment": result = await confirmSalesPayment(context.admin, id, context.responsible, body.note); break
      case "deliver": result = await deliverSalesOrder(context.admin, id, context.responsible, { requestKey: body.requestKey, items: body.items, warehouseId: body.warehouseId, notes: body.notes }); break
      case "cancel": await cancelSalesOrder(context.admin, id, String(body.reason || ""), context.responsible); break
      case "reconfigure":
        if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente altera a configuração de um pedido." }, { status: 403 })
        result = await reconfigureItem(context.admin, String(body.itemId), String(body.configurationId), String(body.reason || ""), context.responsible)
        break
      case "authorize": result = await authorizeProduction(context.admin, id, context.responsible, body.note); break
      case "revoke_authorization": result = await revokeAuthorization(context.admin, id, String(body.reason || ""), context.responsible); break
      case "generate_documentation": result = { created: await generateDocumentation(context.admin, id, context.responsible) }; break
      case "release_exception":
        // exceção comercial: permissão específica (administrador ou gerente) + regra formal da empresa + justificativa; documentação nunca é dispensável
        if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente registra exceção de liberação." }, { status: 403 })
        result = await releaseException(context.admin, id, String(body.reason || ""), context.responsible)
        break
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
    return NextResponse.json({ result, detail: await fullDetail(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}
