import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { normalizeVin } from "@/lib/vehicle-documentation"
import {
  addDocumentationFile, cancelDocumentation, consultDocumentation, docError, documentationDetail, registerManualResult, registerManualSubmission, releaseOf, setFinalStage, submitDocumentation, updateDocumentation,
} from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = docError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}
const withRelease = async (admin: Parameters<typeof documentationDetail>[0], id: string) => {
  const detail = await documentationDetail(admin, id)
  return { ...detail, release: await releaseOf(admin, String(detail.documentation.sales_order_id)) }
}

/** Detalhe da unidade: dados, pendências, tentativas (todas), histórico, arquivos e a liberação da produção do pedido. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Documentação inválida." }, { status: 400 })
  try {
    return NextResponse.json({ detail: await withRelease(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Ações. Corpo:
 *  { action: "update", vin?, catNumber?, brandModelVersionCode?, productModel?, responsible?, notes? } | { action: "submit", requestKey } (canal automático) |
 *  { action: "manual_submit", protocol, requestKey } | { action: "consult" } | { action: "manual_result", result, message?, pendencies?, requestKey } (admin/gerente) |
 *  { action: "cancel", reason } (admin/gerente) | { action: "final_stage", stage, note } | { action: "attach", name, path, kind? }
 * Aprovação manual libera a produção, por isso só administrador ou gerente registra. Nada aqui chama órgão público sem o canal configurado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Documentação inválida." }, { status: 400 })
  try {
    const body = await request.json()
    const manager = context.role === "admin" || context.role === "manager"
    let result: unknown = { ok: true }
    switch (body.action) {
      case "update":
        result = await updateDocumentation(context.admin, {
          documentation_id: id, ...(body.vin !== undefined ? { vin: normalizeVin(body.vin) } : {}), ...(body.catNumber !== undefined ? { cat_number: body.catNumber } : {}),
          ...(body.brandModelVersionCode !== undefined ? { brand_model_version_code: body.brandModelVersionCode } : {}), ...(body.productModel !== undefined ? { product_model: body.productModel } : {}),
          ...(body.responsible !== undefined ? { responsible: body.responsible } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}),
        }, context.responsible)
        break
      case "submit": result = await submitDocumentation(context.admin, id, context.responsible, body.requestKey); break
      case "manual_submit": result = await registerManualSubmission(context.admin, id, { protocol: body.protocol, key: body.requestKey, message: body.message }, context.responsible); break
      case "consult": result = await consultDocumentation(context.admin, id, context.responsible); break
      case "manual_result":
        if (!manager) return NextResponse.json({ error: "Somente administrador ou gerente registra o retorno do portal, porque a aprovação libera a produção." }, { status: 403 })
        result = await registerManualResult(context.admin, id, { result: String(body.result || ""), message: body.message, pendencies: Array.isArray(body.pendencies) ? body.pendencies : undefined, key: body.requestKey }, context.responsible)
        break
      case "cancel":
        if (!manager) return NextResponse.json({ error: "Somente administrador ou gerente cancela a documentação." }, { status: 403 })
        await cancelDocumentation(context.admin, id, String(body.reason || ""), context.responsible)
        break
      case "final_stage": await setFinalStage(context.admin, id, String(body.stage || ""), String(body.note || ""), context.responsible); break
      case "attach":
        if (!String(body.path || "").trim()) throw new Error("Envie o arquivo.")
        await addDocumentationFile(context.admin, id, { kind: body.kind, name: String(body.name || "Arquivo"), path: String(body.path) }, context.responsible)
        break
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
    return NextResponse.json({ result, detail: await withRelease(context.admin, id) })
  } catch (error) {
    return fail(error)
  }
}
