import { NextResponse } from "next/server"
import { validateComposition, type CompositionItem } from "@/lib/compositions"
import { stockContext } from "@/lib/stock-api"

const MIGRATION_HINT = "Composições ainda não instaladas: rode scripts/205_catalogo_produtos_servicos.sql no Supabase."
const missing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string) => NextResponse.json({ error: missing(message) ? MIGRATION_HINT : message }, { status: missing(message) ? 503 : 400 })

/** Versões da composição de um produto (com custo atual dos componentes) e histórico de montagens. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const productId = new URL(request.url).searchParams.get("productId")
  if (!productId) return NextResponse.json({ error: "Informe o produto." }, { status: 400 })
  const { data: versions, error } = await context.admin.from("product_compositions").select("*").eq("product_id", productId).order("version", { ascending: false })
  if (error) return fail(error.message)
  const ids = (versions || []).map((row) => row.id)
  const { data: items, error: itemsError } = ids.length
    ? await context.admin.from("product_composition_items").select("*, component:materials(name,internal_code,unit,average_cost,cost_price)").in("composition_id", ids)
    : { data: [], error: null }
  if (itemsError) return fail(itemsError.message)
  const { data: productions } = await context.admin.from("production_records").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(20)
  return NextResponse.json({
    versions: (versions || []).map((row) => ({
      id: row.id, version: row.version, status: row.status, laborCost: Number(row.labor_cost || 0), assemblyMinutes: Number(row.assembly_minutes || 0), notes: row.notes || "", createdBy: row.created_by || "", createdAt: row.created_at,
      items: (items || []).filter((item: any) => item.composition_id === row.id).map((item: any) => ({
        componentId: item.component_id, name: item.component?.name || "", code: item.component?.internal_code || "", unit: item.unit, quantity: Number(item.quantity), lossPercent: Number(item.loss_percent || 0),
        unitCost: Number(item.component?.average_cost || item.component?.cost_price || 0),
      })),
    })),
    productions: (productions || []).map((row) => ({ id: row.id, quantity: Number(row.quantity), materialsCost: Number(row.materials_cost), laborCost: Number(row.labor_cost), unitCost: Number(row.unit_cost), documentReference: row.document_reference || "", responsible: row.responsible || "", createdAt: row.created_at })),
  })
}

/** Salva uma nova versão (a anterior fica inativa) ou reativa uma versão existente. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json() as { action?: "activate"; compositionId?: string; productId: string; laborCost: number; assemblyMinutes: number; notes?: string; items: CompositionItem[] }
    const admin = context.admin
    if (body.action === "activate") {
      const { data: target, error } = await admin.from("product_compositions").select("id,product_id").eq("id", body.compositionId).single()
      if (error) throw new Error(error.message)
      await admin.from("product_compositions").update({ status: "Inativa" }).eq("product_id", target.product_id).eq("status", "Ativa")
      const { error: activateError } = await admin.from("product_compositions").update({ status: "Ativa" }).eq("id", target.id)
      if (activateError) throw new Error(activateError.message)
      return NextResponse.json({ ok: true })
    }

    const { data: active } = await admin.from("product_compositions").select("product_id, items:product_composition_items(component_id)").eq("status", "Ativa")
    const graph = Object.fromEntries((active || []).map((row: any) => [row.product_id, (row.items || []).map((item: any) => item.component_id)]))
    const invalid = validateComposition(body.productId, body.items || [], Number(body.laborCost || 0), Number(body.assemblyMinutes || 0), graph)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const { data: last } = await admin.from("product_compositions").select("version").eq("product_id", body.productId).order("version", { ascending: false }).limit(1)
    const version = Number(last?.[0]?.version || 0) + 1
    const { error: deactivateError } = await admin.from("product_compositions").update({ status: "Inativa" }).eq("product_id", body.productId).eq("status", "Ativa")
    if (deactivateError) throw new Error(deactivateError.message)
    const { data: saved, error } = await admin.from("product_compositions").insert({
      product_id: body.productId, version, status: "Ativa", labor_cost: Number(body.laborCost || 0), assembly_minutes: Math.round(Number(body.assemblyMinutes || 0)), notes: body.notes || "", created_by: context.responsible,
    }).select("id").single()
    if (error) throw new Error(error.message)
    const { error: itemsError } = await admin.from("product_composition_items").insert(body.items.map((item) => ({
      composition_id: saved.id, component_id: item.componentId, quantity: Number(item.quantity), unit: item.unit || "UN", loss_percent: Number(item.lossPercent || 0),
    })))
    if (itemsError) {
      // Não deixa versão vazia ativa.
      await admin.from("product_compositions").delete().eq("id", saved.id)
      throw new Error(itemsError.message)
    }
    await admin.from("materials").update({ item_type: "Kit" }).eq("id", body.productId)
    return NextResponse.json({ id: saved.id, version })
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Erro ao salvar composição.")
  }
}
