import { createAdminClient } from "@/lib/supabase/server"
import { ensureReceivableForFinishedOrder } from "@/lib/service-order-receivables"
import { syncStockForServiceOrderSafely } from "@/lib/stock-engine"
import { finishedStatuses, osKinds, osPriorities, osTotals, validateDiscount, validateTransition } from "@/lib/os-workflow"

type AdminClient = ReturnType<typeof createAdminClient>

export const OS_MIGRATION_HINT = "Ordem de serviço ERP ainda não instalada: rode scripts/206_ordem_servico_erp.sql no Supabase."
export const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)

/** Tipos de OS que exigem a carreta/veículo/equipamento do cliente. */
const kindsRequiringAsset = new Set(["Manutenção preventiva", "Manutenção corretiva", "Reparo", "Reforma", "Garantia", "Inspeção / vistoria"])
const lockedStatuses = new Set(["Concluída", "Entregue", "Cancelada", "Finalizada"])
/** OS que fabricam/montam um produto do catálogo (carreta) ao serem concluídas. */
export const productionKinds = new Set(["Fabricação", "Montagem"])

export type OsInput = {
  id?: string
  orderKind: string
  clientId: string
  customerAssetId?: string
  vehicleId?: string
  serviceTypeId: string
  description: string
  priority: string
  technicianId: string
  teamProviderIds: string[]
  plannedStart?: string
  dueDate?: string
  entryChecklist: Array<{ item: string; ok: boolean | null; notes?: string }>
  servicesSummary?: string
  services: Array<{ id?: string; serviceTypeId?: string; description: string; quantity: number; unit: string; unitPrice: number; executed: boolean }>
  materials: Array<{ id?: string; materialId: string; itemName: string; quantity: number; unit: string; unitPrice: number }>
  discountAmount: number
  discountAuthorizedBy?: string
  warrantyDays: number
  technicalNotes?: string
  paymentMethod?: string
  paymentDueDate?: string
  productionProductId?: string
  productionQuantity?: number
  productionSerial?: string
}

export function validateOs(input: OsInput) {
  if (!osKinds.includes(input.orderKind)) return "Informe o tipo de OS."
  if (!input.clientId) return "Informe o cliente."
  if (kindsRequiringAsset.has(input.orderKind) && !input.customerAssetId && !input.vehicleId) return "Vincule a carreta/veículo/equipamento do serviço."
  if (productionKinds.has(input.orderKind) && !input.productionProductId) return "Informe a carreta/produto que será fabricado."
  if (productionKinds.has(input.orderKind) && !(Number(input.productionQuantity || 1) > 0)) return "Quantidade a fabricar deve ser maior que zero."
  if (!input.serviceTypeId) return "Informe o serviço solicitado."
  if (!input.description.trim()) return "Descreva o problema ou a solicitação."
  if (!osPriorities.includes(input.priority)) return "Informe a prioridade."
  if (!input.technicianId) return "Informe o responsável técnico."
  if (input.plannedStart && input.dueDate && input.dueDate < input.plannedStart) return "O prazo de conclusão não pode ser anterior ao início previsto."
  if (input.services.some((item) => !item.description.trim() || !(Number(item.quantity) > 0) || Number(item.unitPrice) < 0)) return "Revise os serviços: descrição, quantidade e valor."
  if (input.materials.some((item) => !item.materialId || !(Number(item.quantity) > 0) || Number(item.unitPrice) < 0)) return "Revise as peças: item do catálogo, quantidade e valor."
  if (new Set(input.materials.map((item) => item.materialId)).size !== input.materials.length) return "Peça repetida; some as quantidades numa linha só."
  const subtotal = input.services.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) + input.materials.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const discount = validateDiscount(Number(input.discountAmount || 0), subtotal, input.discountAuthorizedBy || "")
  if (discount) return discount
  if (Number(input.warrantyDays || 0) < 0) return "Garantia não pode ser negativa."
  return ""
}

async function timeEntries(admin: AdminClient, orderId: string) {
  const { data } = await admin.from("service_order_time_entries").select("hours,hourly_cost").eq("service_order_id", orderId)
  return (data || []).map((row) => ({ hours: Number(row.hours || 0), hourlyCost: Number(row.hourly_cost || 0) }))
}

/** Recalcula e grava valores, horas, custo e margem da OS a partir das linhas salvas. */
export async function recalculateOs(admin: AdminClient, orderId: string) {
  const [{ data: order }, { data: services }, { data: materials }, entries] = await Promise.all([
    admin.from("service_orders").select("discount_amount,production_record_id").eq("id", orderId).single(),
    admin.from("service_order_services").select("quantity,unit_price,executed").eq("service_order_id", orderId),
    admin.from("service_order_materials").select("used_quantity,expected_quantity,unit_price,unit_cost").eq("service_order_id", orderId),
    timeEntries(admin, orderId),
  ])
  const totals = osTotals(
    (services || []).map((row) => ({ quantity: Number(row.quantity), unitPrice: Number(row.unit_price) })),
    (materials || []).map((row) => ({ quantity: Number(row.used_quantity || row.expected_quantity || 0), unitPrice: Number(row.unit_price || 0), unitCost: Number(row.unit_cost || 0) })),
    entries,
    Number(order?.discount_amount || 0),
  )
  // Fabricação: custo real da montagem (componentes + mão de obra da composição) entra no custo da OS.
  let productionCost = 0
  if (order?.production_record_id) {
    const { data: production } = await admin.from("production_records").select("materials_cost,labor_cost").eq("id", order.production_record_id).maybeSingle()
    productionCost = Number(production?.materials_cost || 0) + Number(production?.labor_cost || 0)
  }
  const { error } = await admin.from("service_orders").update({
    labor_amount: totals.labor, materials_amount: totals.materials, total_amount: totals.total, hours_worked: totals.hours, cost_amount: Math.round((totals.cost + productionCost) * 100) / 100,
  }).eq("id", orderId)
  if (error) throw new Error(error.message)
  return totals
}

/** Cria ou atualiza a OS (cabeçalho, serviços, peças e checklist de entrada). */
export async function saveOs(admin: AdminClient, input: OsInput, responsible: string) {
  const invalid = validateOs(input)
  if (invalid) throw new Error(invalid)
  let orderNumber = ""
  if (input.id) {
    const { data: current, error } = await admin.from("service_orders").select("status").eq("id", input.id).single()
    if (error) throw new Error(error.message)
    if (lockedStatuses.has(current.status)) throw new Error(`OS ${current.status.toLowerCase()} não pode ser alterada. Reabra para execução antes de editar.`)
  } else {
    const { data, error } = await admin.rpc("next_service_order_number")
    if (error) throw new Error(isMissing(error.message) ? OS_MIGRATION_HINT : error.message)
    orderNumber = String(data)
  }

  // Custo das peças = custo médio atual (a baixa no estoque usa o custo do momento).
  const materialIds = input.materials.map((item) => item.materialId)
  const { data: catalog } = materialIds.length ? await admin.from("materials").select("id,average_cost,cost_price").in("id", materialIds) : { data: [] }
  const unitCost = (id: string) => { const row = (catalog || []).find((item) => item.id === id); return Number(row?.average_cost || row?.cost_price || 0) }

  const header = {
    ...(input.id ? { id: input.id } : { order_number: orderNumber, status: "Aberta", opened_by: responsible }),
    order_kind: input.orderKind,
    client_id: input.clientId,
    customer_asset_id: input.customerAssetId || null,
    vehicle_id: input.vehicleId || null,
    service_type_id: input.serviceTypeId,
    description: input.description.trim(),
    priority: input.priority,
    main_provider_id: input.technicianId,
    team_provider_ids: input.teamProviderIds.filter(Boolean),
    scheduled_date: input.plannedStart || null,
    due_date: input.dueDate || null,
    entry_checklist: input.entryChecklist.filter((item) => item.item.trim()),
    services_summary: input.servicesSummary || "",
    discount_amount: Number(input.discountAmount || 0),
    discount_authorized_by: input.discountAuthorizedBy || "",
    warranty_days: Math.round(Number(input.warrantyDays || 0)),
    technical_notes: input.technicalNotes || "",
    payment_method: input.paymentMethod || "",
    payment_due_date: input.paymentDueDate || null,
    production_product_id: productionKinds.has(input.orderKind) ? input.productionProductId || null : null,
    production_quantity: productionKinds.has(input.orderKind) ? Number(input.productionQuantity || 1) : 1,
    production_serial: productionKinds.has(input.orderKind) ? String(input.productionSerial || "").trim() : null,
  }
  const { data: saved, error } = await admin.from("service_orders").upsert(header, { onConflict: "id" }).select("id,order_number,status").single()
  if (error) throw new Error(isMissing(error.message) ? OS_MIGRATION_HINT : error.message)

  // Serviços: substitui as linhas.
  const { error: deleteServices } = await admin.from("service_order_services").delete().eq("service_order_id", saved.id)
  if (deleteServices) throw new Error(isMissing(deleteServices.message) ? OS_MIGRATION_HINT : deleteServices.message)
  if (input.services.length) {
    const { error: servicesError } = await admin.from("service_order_services").insert(input.services.map((item) => ({
      service_order_id: saved.id, service_type_id: item.serviceTypeId || null, description: item.description.trim(), quantity: Number(item.quantity), unit: item.unit || "Servico", unit_price: Number(item.unitPrice || 0), executed: Boolean(item.executed),
    })))
    if (servicesError) throw new Error(servicesError.message)
  }

  // Peças: mantém a linha do mesmo item (a reserva de estoque acompanha a quantidade).
  const { data: currentMaterials } = await admin.from("service_order_materials").select("id,material_id").eq("service_order_id", saved.id)
  const removed = (currentMaterials || []).filter((row) => !materialIds.includes(row.material_id)).map((row) => row.id)
  if (removed.length) await admin.from("service_order_materials").delete().in("id", removed)
  if (input.materials.length) {
    const { error: materialsError } = await admin.from("service_order_materials").upsert(input.materials.map((item) => ({
      ...((currentMaterials || []).find((row) => row.material_id === item.materialId) ? { id: (currentMaterials || []).find((row) => row.material_id === item.materialId)!.id } : {}),
      service_order_id: saved.id, material_id: item.materialId, item_name: item.itemName, expected_quantity: Number(item.quantity), used_quantity: Number(item.quantity), unit: item.unit || "UN",
      unit_price: Number(item.unitPrice || 0), unit_cost: unitCost(item.materialId), status: "Previsto",
    })), { defaultToNull: false })
    if (materialsError) throw new Error(materialsError.message)
  }

  await recalculateOs(admin, saved.id)
  const warnings = await syncStockForServiceOrderSafely(admin, saved.id, responsible)
  return { id: saved.id, orderNumber: saved.order_number, warnings }
}

/** Muda a situação validando o fluxo; registra histórico, estoque e conta a receber. */
export async function changeOsStatus(admin: AdminClient, orderId: string, to: string, reason: string, responsible: string) {
  const { data: order, error } = await admin.from("service_orders").select("*").eq("id", orderId).single()
  if (error) throw new Error(error.message)
  const { count: executed } = await admin.from("service_order_services").select("id", { count: "exact", head: true }).eq("service_order_id", orderId).eq("executed", true)
  const invalid = validateTransition({ from: order.status, to, reason, suspendedFrom: order.suspended_from_status || "", technicianId: order.main_provider_id || "", executedServices: executed || 0, servicesSummary: order.services_summary || "" })
  if (invalid) throw new Error(invalid)

  // Concluir OS de fabricação produz a carreta (baixa a composição e dá entrada no estoque).
  let productionRecordId = ""
  if (to === "Concluída" && order.production_product_id && !order.production_record_id) {
    const { data: composition } = await admin.from("product_compositions").select("id").eq("product_id", order.production_product_id).eq("status", "Ativa").maybeSingle()
    if (!composition) throw new Error("O produto fabricado não tem composição ativa. Cadastre a composição em Produtos / Serviços.")
    const { data: produced, error: produceError } = await admin.rpc("produce_composition", {
      p: { composition_id: composition.id, quantity: Number(order.production_quantity || 1), serial_number: order.production_serial || "", document_reference: `OS ${order.order_number}`, responsible, notes: `Fabricação pela OS ${order.order_number}` },
    })
    if (produceError) throw new Error(`Fabricação não registrada: ${produceError.message}`)
    productionRecordId = String((produced as any)?.production_id || "")
    // Vincula já, para uma nova tentativa de concluir não fabricar de novo.
    await admin.from("service_orders").update({ production_record_id: productionRecordId }).eq("id", orderId)
  }

  const now = new Date()
  const update: Record<string, unknown> = { status: to, status_reason: reason || null, updated_at: now.toISOString() }
  if (productionRecordId) update.production_record_id = productionRecordId
  if (to === "Suspensa") update.suspended_from_status = order.status
  if (order.status === "Suspensa") update.suspended_from_status = null
  if (to === "Concluída") update.finished_at = now.toISOString()
  if (finishedStatuses.has(order.status) && !finishedStatuses.has(to)) update.finished_at = null
  if (to === "Cancelada") update.cancelled_at = now.toISOString()
  if (to === "Entregue") {
    update.delivered_at = now.toISOString()
    if (Number(order.warranty_days || 0) > 0) {
      const until = new Date(now)
      until.setDate(until.getDate() + Number(order.warranty_days))
      update.warranty_until = until.toISOString().slice(0, 10)
    }
  }
  const { data: changed, error: updateError } = await admin.from("service_orders").update(update).eq("id", orderId).eq("status", order.status).select("id")
  if (updateError) throw new Error(updateError.message)
  if (!changed?.length) throw new Error("A OS foi alterada por outra pessoa. Atualize a tela.")
  await admin.from("service_order_status_history").insert({ service_order_id: orderId, from_status: order.status, to_status: to, reason: reason || null, changed_by: responsible })

  const warnings = await syncStockForServiceOrderSafely(admin, orderId, responsible)
  if (productionRecordId) await recalculateOs(admin, orderId)
  if (finishedStatuses.has(to) || finishedStatuses.has(order.status)) await ensureReceivableForFinishedOrder(admin, orderId)
  return { warnings, produced: Boolean(productionRecordId) }
}

export async function loadOs(admin: AdminClient, orderId: string) {
  const [order, services, materials, entries, history, files, signatures] = await Promise.all([
    admin.from("service_orders").select("*").eq("id", orderId).maybeSingle(),
    admin.from("service_order_services").select("*").eq("service_order_id", orderId).order("created_at"),
    admin.from("service_order_materials").select("*").eq("service_order_id", orderId).order("created_at"),
    admin.from("service_order_time_entries").select("*").eq("service_order_id", orderId).order("work_date", { ascending: false }),
    admin.from("service_order_status_history").select("*").eq("service_order_id", orderId).order("changed_at", { ascending: false }),
    admin.from("service_order_files").select("*").eq("service_order_id", orderId).order("created_at"),
    admin.from("service_order_signatures").select("*").eq("service_order_id", orderId).order("created_at", { ascending: false }),
  ])
  if (order.error) throw new Error(order.error.message)
  if (!order.data) return null
  const { data: reservations } = await admin.from("stock_reservations").select("material_id,quantity,status").eq("service_order_id", orderId)
  const { data: receivable } = await admin.from("accounts_receivable").select("id,status,expected_amount,received_amount,due_date").eq("service_order_id", orderId).eq("origin", "OS").maybeSingle()
  const row = order.data
  const totals = osTotals(
    (services.data || []).map((item) => ({ quantity: Number(item.quantity), unitPrice: Number(item.unit_price) })),
    (materials.data || []).map((item) => ({ quantity: Number(item.used_quantity || item.expected_quantity || 0), unitPrice: Number(item.unit_price || 0), unitCost: Number(item.unit_cost || 0) })),
    (entries.data || []).map((item) => ({ hours: Number(item.hours), hourlyCost: Number(item.hourly_cost) })),
    Number(row.discount_amount || 0),
  )
  return {
    id: row.id, orderNumber: row.order_number, status: row.status, statusReason: row.status_reason || "", suspendedFrom: row.suspended_from_status || "",
    orderKind: row.order_kind || "", clientId: row.client_id, customerAssetId: row.customer_asset_id || "", vehicleId: row.vehicle_id || "",
    serviceTypeId: row.service_type_id || "", description: row.description || "", priority: row.priority || "Media", technicianId: row.main_provider_id || "",
    teamProviderIds: row.team_provider_ids || [], plannedStart: row.scheduled_date || "", dueDate: row.due_date || "",
    entryChecklist: Array.isArray(row.entry_checklist) ? row.entry_checklist : [], servicesSummary: row.services_summary || "",
    discountAmount: Number(row.discount_amount || 0), discountAuthorizedBy: row.discount_authorized_by || "", warrantyDays: Number(row.warranty_days || 0),
    productionProductId: row.production_product_id || "", productionQuantity: Number(row.production_quantity || 1), productionSerial: row.production_serial || "", productionRecordId: row.production_record_id || "", costAmount: Number(row.cost_amount || 0),
    warrantyUntil: row.warranty_until || "", technicalNotes: row.technical_notes || "", paymentMethod: row.payment_method || "", paymentDueDate: row.payment_due_date || "",
    openedAt: row.created_at, openedBy: row.opened_by || "", finishedAt: row.finished_at || "", deliveredAt: row.delivered_at || "", cancelledAt: row.cancelled_at || "",
    services: (services.data || []).map((item) => ({ id: item.id, serviceTypeId: item.service_type_id || "", description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: Number(item.unit_price), executed: Boolean(item.executed) })),
    materials: (materials.data || []).map((item) => ({ id: item.id, materialId: item.material_id || "", itemName: item.item_name, quantity: Number(item.used_quantity || item.expected_quantity || 0), unit: item.unit, unitPrice: Number(item.unit_price || 0), unitCost: Number(item.unit_cost || 0), reserved: (reservations || []).filter((reservation) => reservation.material_id === item.material_id && reservation.status === "Ativa").reduce((sum, reservation) => sum + Number(reservation.quantity), 0), consumed: (reservations || []).some((reservation) => reservation.material_id === item.material_id && reservation.status === "Consumida") })),
    timeEntries: (entries.data || []).map((item) => ({ id: item.id, providerId: item.provider_id || "", workDate: item.work_date, hours: Number(item.hours), hourlyCost: Number(item.hourly_cost), notes: item.notes || "", createdBy: item.created_by || "" })),
    history: (history.data || []).map((item) => ({ from: item.from_status || "", to: item.to_status, reason: item.reason || "", changedBy: item.changed_by || "", changedAt: item.changed_at })),
    photos: (files.data || []).map((item) => ({ id: item.id, category: item.category, url: item.file_url, name: item.file_name })),
    acceptance: (signatures.data || [])[0] ? { name: signatures.data![0].responsible_name, document: signatures.data![0].responsible_document || "", signature: signatures.data![0].signature_url || "", notes: signatures.data![0].customer_notes || "", at: signatures.data![0].created_at } : null,
    receivable: receivable ? { id: receivable.id, status: receivable.status, amount: Number(receivable.expected_amount), received: Number(receivable.received_amount || 0), dueDate: receivable.due_date } : null,
    totals,
  }
}
