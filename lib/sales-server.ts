import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { isSalesStructureMissing, SALES_MIGRATION_HINT } from "@/lib/sales"

type Admin = ReturnType<typeof createAdminClient>
export class SalesError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** Erros do banco (as regras já vêm em português) viram mensagens da tela. */
export function salesError(error: unknown, fallback = "Erro ao processar a solicitação.") {
  if (error instanceof SalesError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (/production_order_create_manual|vehicle_documentation_create_manual/.test(message) && /Could not find|does not exist|schema cache/i.test(message)) return new SalesError("A abertura de ordem de produção sem pedido ainda não está instalada no banco. Rode o script 228 no SQL Editor do Supabase (depois do 227).", 503)
  if (isSalesStructureMissing(message)) return new SalesError(SALES_MIGRATION_HINT, 503)
  if (/não encontrad/i.test(message)) return new SalesError(message, 404)
  if (/outra empresa/i.test(message)) return new SalesError(message, 403)
  return new SalesError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}
const page = (filters: { page?: number; pageSize?: number }) => {
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 100)
  const current = Math.max(Number(filters.page) || 1, 1)
  return { pageSize, current, offset: (current - 1) * pageSize }
}

// ---------------------------------------------------------------- Vendas
export async function listSalesOrders(admin: Admin, filters: { q?: string; status?: string; page?: number; pageSize?: number }) {
  const { pageSize, current, offset } = page(filters)
  const rows = await rpc<Array<Record<string, any>>>(admin, "sales_order_list", { p_search: filters.q || null, p_status: filters.status || null, p_limit: pageSize, p_offset: offset })
  // oportunidade de origem (OP-...) pelo orçamento do pedido; sem ela a lista só mostra o orçamento
  const quoteNumbers = [...new Set(rows.map((row) => row.quote_number).filter(Boolean))]
  const opportunityByQuote = new Map<string, { id: string; code: string }>()
  if (quoteNumbers.length) {
    const { data: quotes } = await admin.from("quotes").select("quote_number,opportunity_id").in("quote_number", quoteNumbers).not("opportunity_id", "is", null)
    const ids = [...new Set((quotes || []).map((quote) => quote.opportunity_id))]
    const { data: opportunities } = ids.length ? await admin.from("opportunities").select("id,code").in("id", ids) : { data: [] }
    const byId = new Map((opportunities || []).map((opportunity) => [opportunity.id, opportunity]))
    for (const quote of quotes || []) { const found = byId.get(quote.opportunity_id); if (found) opportunityByQuote.set(quote.quote_number, { id: found.id, code: found.code }) }
  }
  const items = rows.map((row) => ({ ...row, opportunity_id: opportunityByQuote.get(row.quote_number)?.id || null, opportunity_code: opportunityByQuote.get(row.quote_number)?.code || null }))
  return { items, total: rows.length ? Number(rows[0].total_count) : 0, page: current, pageSize }
}
export const salesOrderDetail = (admin: Admin, id: string) => rpc<Record<string, any>>(admin, "sales_order_detail", { p_sales_order_id: id })
export const confirmSalesOrder = (admin: Admin, id: string, user: string) => rpc<Record<string, any>>(admin, "confirm_sales_order", { p_sales_order_id: id, p_user: user })
export const confirmSalesPayment = (admin: Admin, id: string, user: string, note?: string) => rpc<Record<string, any>>(admin, "confirm_sales_payment", { p_sales_order_id: id, p_user: user, p_note: note || null })
export const cancelSalesOrder = (admin: Admin, id: string, reason: string, user: string) => rpc(admin, "cancel_sales_order", { p_sales_order_id: id, p_reason: reason, p_user: user })
/** A chave de idempotência vem da tela (uma por clique); sem ela, uma nova por chamada. */
export const deliverSalesOrder = (admin: Admin, id: string, user: string, input: { requestKey?: string; items?: Array<{ item_id: string; quantity: number }>; warehouseId?: string; notes?: string }) =>
  rpc<Record<string, any>>(admin, "deliver_sales_order", { p: { sales_order_id: id, request_key: input.requestKey || randomUUID(), user, items: input.items, warehouse_id: input.warehouseId, notes: input.notes } })
export const salesSettings = async (admin: Admin) => ({ requirePayment: Boolean((await rpc<Record<string, any>>(admin, "production_dashboard")).require_payment) })
export const saveSalesSettings = (admin: Admin, requirePayment: boolean, user: string) => rpc<Record<string, any>>(admin, "sales_settings_save", { p_require: requirePayment, p_user: user })

// ---------------------------------------------------------------- Produção
export async function listProductionOrders(admin: Admin, filters: { q?: string; status?: string; page?: number; pageSize?: number }) {
  const { pageSize, current, offset } = page(filters)
  const rows = await rpc<Array<Record<string, any>>>(admin, "production_order_list", { p_search: filters.q || null, p_status: filters.status || null, p_limit: pageSize, p_offset: offset })
  return { items: rows, total: rows.length ? Number(rows[0].total_count) : 0, page: current, pageSize }
}
export const productionOrderDetail = (admin: Admin, id: string) => rpc<Record<string, any>>(admin, "production_order_detail", { p_order: id })
export const productionDashboard = (admin: Admin) => rpc<Record<string, any>>(admin, "production_dashboard")
export const reserveMaterials = (admin: Admin, id: string, user: string) => rpc<Record<string, any>>(admin, "reserve_production_materials", { p_production_order_id: id, p_user: user })
export const changeProductionStatus = (admin: Admin, id: string, action: string, user: string, reason?: string) => rpc<string>(admin, "production_change_status", { p_order: id, p_action: action, p_user: user, p_reason: reason || null })
export const cancelProductionOrder = (admin: Admin, id: string, reason: string) => rpc(admin, "cancel_production_order", { p_production_order_id: id, p_reason: reason })
export const updateProductionPlan = (admin: Admin, input: Record<string, unknown>) => rpc(admin, "production_update_plan", { p: input })

/** Consumo: se a unidade informada difere da do material, converte pela tabela de conversões do cadastro. A chave de idempotência evita baixa dupla. */
export async function recordConsumption(admin: Admin, id: string, input: { materialId: string; quantity: number; unit?: string; kind?: string; warehouseId?: string; responsible: string; requestKey?: string; notes?: string }) {
  let quantity = Number(input.quantity)
  if (!(quantity > 0)) throw new SalesError("Informe a quantidade consumida (maior que zero).")
  const { data: material } = await admin.from("materials").select("unit").eq("id", input.materialId).maybeSingle()
  if (!material) throw new SalesError("Material não encontrado.", 404)
  if (input.unit && String(input.unit).toUpperCase() !== String(material.unit).toUpperCase()) {
    quantity = Number(await rpc(admin, "convert_quantity", { p_material_id: input.materialId, p_quantity: quantity, p_from: String(input.unit).toUpperCase(), p_to: String(material.unit).toUpperCase() }))
  }
  return rpc<Record<string, any>>(admin, "record_production_consumption", { p: {
    production_order_id: id, material_id: input.materialId, quantity, kind: input.kind || "Consumo", from_warehouse_id: input.warehouseId || "", responsible: input.responsible,
    request_key: input.requestKey || randomUUID(), notes: input.notes || null,
  } })
}
/** Conclusão total ou parcial: entrada do acabado no estoque da empresa e atualização do pedido. */
export const completeProduction = (admin: Admin, id: string, input: { quantity: number; responsible: string; warehouseId?: string; requestKey?: string; autoConsume?: boolean; notes?: string }) =>
  rpc<Record<string, any>>(admin, "complete_production", { p: { production_order_id: id, quantity: input.quantity, responsible: input.responsible, to_warehouse_id: input.warehouseId || "", request_key: input.requestKey || randomUUID(), auto_consume: Boolean(input.autoConsume), notes: input.notes || null } })

// ---------------------------------------------------------------- MRP e solicitações de compra
export const mrpOverview = (admin: Admin) => rpc<Array<Record<string, any>>>(admin, "mrp_overview")
export const generatePurchaseRequest = (admin: Admin, user: string) => rpc<string>(admin, "generate_purchase_request_consolidated", { p_requested_by: user })
export const generateOrderPurchaseRequest = (admin: Admin, orderId: string, user: string) => rpc<string>(admin, "generate_purchase_request", { p_production_order_id: orderId, p_requested_by: user })
export const listPurchaseRequests = (admin: Admin, status?: string) => rpc<Array<Record<string, any>>>(admin, "purchase_request_list", { p_status: status || null })
export const setPurchaseRequestStatus = (admin: Admin, id: string, status: string, user: string) => rpc(admin, "purchase_request_set_status", { p_request: id, p_status: status, p_user: user })

/** Ordem de produção aberta direto na produção (sem pedido de venda): estrutura ativa congelada, materiais reservados e tarefas da esteira. */
const createManualProductionOrderBase = (admin: Admin, input: { productId: string; quantity: number; plannedEnd?: string; priority?: number; clientId?: string; responsible?: string; notes?: string; createDocumentation?: boolean }, user: string) =>
  rpc<Record<string, any>>(admin, "production_order_create_manual", {
    p: { product_id: input.productId, quantity: input.quantity, planned_end: input.plannedEnd || null, priority: input.priority || 3, client_id: input.clientId || null, responsible: input.responsible || null, notes: input.notes || null, create_documentation: Boolean(input.createDocumentation) },
    p_user: user,
  })

/** Ordem aberta direto na produção: já baixa do estoque as matérias-primas dos kits (script 237; sem ele a ordem nasce igual, sem a baixa). */
export async function createManualProductionOrder(admin: Admin, input: Parameters<typeof createManualProductionOrderBase>[1], user: string) {
  const created = await createManualProductionOrderBase(admin, input, user)
  if (created?.production_order_id) {
    const consumed = await admin.rpc("production_order_consume_kits", { p_order: created.production_order_id, p_user: user })
    return { ...created, materials_consumed: consumed.error ? null : consumed.data }
  }
  return created
}
