import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { applyStockMovement } from "@/lib/stock-engine"
import { buildInstallments, canCreateVersion, describeChanges, editableInPlace, effectiveStatus, quoteTotals, shareMessage, validateQuote, validateQuoteTransition, type QuoteInput } from "@/lib/quotes"
import { readAllPages } from "@/lib/supabase-pagination"
import { stageProbability } from "@/lib/commercial"

type Admin = ReturnType<typeof createAdminClient>

export const QUOTES_MIGRATION_HINT = "Módulo Orçamentos ainda não instalado no banco. Rode scripts/210_orcamentos.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string): never => { throw new Error(message) }
const text = (value: unknown) => String(value ?? "").trim()
const num = (value: unknown) => Number(String(value ?? "").replace(",", ".")) || 0
const today = () => new Date().toISOString().slice(0, 10)

export function quoteError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: QUOTES_MIGRATION_HINT, status: 503 }
  return { message, status: 400 }
}

// ---------------- Leitura

const toItem = (row: any) => ({
  id: row.id, lineType: row.line_type as "Produto" | "Serviço", catalogId: row.material_id || row.service_type_id || "", description: row.description, unit: row.unit,
  quantity: Number(row.quantity), unitPrice: Number(row.unit_price), catalogPrice: Number(row.catalog_price), unitCost: Number(row.unit_cost), discountPercent: Number(row.discount_percent),
  total: Number(row.total), notes: row.notes || "",
})

export type QuoteItemView = ReturnType<typeof toItem>

function toQuote(row: any, clients: Map<string, any>, people: Map<string, string>) {
  const client = clients.get(row.client_id)
  return {
    id: row.id, number: row.quote_number as string, version: Number(row.version), title: row.title || "", clientId: row.client_id, clientName: client?.name || "-", clientPhone: client?.phone || "", clientEmail: client?.email || "",
    salespersonId: row.salesperson_id, salespersonName: people.get(row.salesperson_id) || "-", opportunityId: row.opportunity_id || "", issueDate: row.issue_date, validUntil: row.valid_until,
    quoteType: row.quote_type as string, status: row.status as string, effectiveStatus: effectiveStatus(row.status, row.valid_until), itemsSubtotal: Number(row.items_subtotal), discountAmount: Number(row.discount_amount),
    freightAmount: Number(row.freight_amount), expensesAmount: Number(row.expenses_amount), taxPercent: Number(row.tax_percent), taxesAmount: Number(row.taxes_amount), totalAmount: Number(row.total_amount),
    estimatedCost: Number(row.estimated_cost), paymentConditionId: row.payment_condition_id || "", paymentConditionName: row.payment_condition_name || "", deliveryText: row.delivery_text || "",
    warrantyDays: Number(row.warranty_days || 0), notes: row.notes || "", sentAt: row.sent_at || "", sentVia: row.sent_via || "", sentTo: row.sent_to || "", approvedAt: row.approved_at || "",
    acceptedBy: row.accepted_by || "", acceptNotes: row.accept_notes || "", refusalReason: row.refusal_reason || "", convertedAt: row.converted_at || "", convertedTo: row.converted_to || "",
    receivablesGenerated: Boolean(row.receivables_generated_at), createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export type QuoteView = ReturnType<typeof toQuote>

async function lookups(admin: Admin) {
  const [clients, people] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("clients").select("id,name,phone,email").order("id").range(from, to)),
    admin.from("salespeople").select("id,name"),
  ])
  return { clients: new Map<string, any>(clients.map((row) => [row.id as string, row])), people: new Map<string, string>((people.data || []).map((row) => [row.id as string, row.name as string])) }
}

export async function listQuotes(admin: Admin) {
  const [rows, lookup] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("quotes").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
    lookups(admin),
  ])
  return rows.map((row) => toQuote(row, lookup.clients, lookup.people))
}

export async function getQuote(admin: Admin, id: string) {
  const { data: row, error } = await admin.from("quotes").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  if (!row) fail("Orçamento não encontrado.")
  const [lookup, items, events, attachments, versions, orders, receivables] = await Promise.all([
    lookups(admin),
    admin.from("quote_items").select("*").eq("quote_id", id).order("position"),
    admin.from("quote_events").select("*").eq("quote_id", id).order("created_at", { ascending: false }),
    admin.from("quote_attachments").select("*").eq("quote_id", id).order("created_at", { ascending: false }),
    admin.from("quotes").select("id,version,status,total_amount,valid_until,created_at").eq("quote_number", row!.quote_number).order("version", { ascending: false }),
    admin.from("service_orders").select("id,order_number,status").eq("source_quote_id", id),
    admin.from("accounts_receivable").select("id,due_date,expected_amount,received_amount,status,installment_number,installment_count").eq("source_type", "Orçamento").eq("source_reference", `${row!.quote_number} v${row!.version}`).order("due_date"),
  ])
  return {
    quote: toQuote(row, lookup.clients, lookup.people),
    items: (items.data || []).map(toItem),
    events: (events.data || []).map((event) => ({ id: event.id, event: event.event, description: event.description, author: event.author || "", at: event.created_at })),
    attachments: (attachments.data || []).map((file) => ({ id: file.id, path: file.file_path, name: file.file_name, at: file.created_at })),
    versions: (versions.data || []).map((version) => ({ id: version.id, version: Number(version.version), status: effectiveStatus(version.status, version.valid_until), total: Number(version.total_amount), at: version.created_at })),
    orders: (orders.data || []).map((order) => ({ id: order.id, number: order.order_number, status: order.status })),
    receivables: (receivables.data || []).map((item) => ({ id: item.id, dueDate: item.due_date, amount: Number(item.expected_amount), received: Number(item.received_amount), status: item.status, number: item.installment_number, count: item.installment_count })),
  }
}

async function event(admin: Admin, quoteId: string, name: string, description: string, author: string) {
  await admin.from("quote_events").insert({ quote_id: quoteId, event: name, description, author })
}

// ---------------- Gravação

export type QuoteSaveInput = {
  id?: string
  title?: string
  clientId: string
  salespersonId: string
  opportunityId?: string
  issueDate?: string
  validUntil: string
  quoteType: string
  paymentConditionId: string
  discountAmount: number | string
  freightAmount: number | string
  expensesAmount: number | string
  taxPercent: number | string
  deliveryText?: string
  warrantyDays: number | string
  notes?: string
  lines: Array<{ id?: string; lineType: "Produto" | "Serviço"; catalogId: string; description: string; unit?: string; quantity: number | string; unitPrice: number | string; discountPercent?: number | string; notes?: string }>
}

async function catalogSnapshot(admin: Admin, lines: QuoteSaveInput["lines"]) {
  const materialIds = [...new Set(lines.filter((line) => line.lineType === "Produto").map((line) => line.catalogId).filter(Boolean))]
  const serviceIds = [...new Set(lines.filter((line) => line.lineType === "Serviço").map((line) => line.catalogId).filter(Boolean))]
  const [materials, services] = await Promise.all([
    materialIds.length ? admin.from("materials").select("id,sale_price,average_cost,cost_price,unit").in("id", materialIds) : { data: [] as any[] },
    serviceIds.length ? admin.from("service_types").select("id,default_price,estimated_cost,billing_unit").in("id", serviceIds) : { data: [] as any[] },
  ])
  return {
    material: new Map<string, any>((materials.data || []).map((row: any) => [row.id as string, row])),
    service: new Map<string, any>((services.data || []).map((row: any) => [row.id as string, row])),
  }
}

/** Valida e grava o orçamento (rascunho). Preços dos itens já existentes ficam congelados. */
export async function saveQuote(admin: Admin, input: QuoteSaveInput, responsible: string) {
  const normalized: QuoteInput = {
    clientId: text(input.clientId), salespersonId: text(input.salespersonId), issueDate: text(input.issueDate) || today(), validUntil: text(input.validUntil), quoteType: text(input.quoteType),
    paymentConditionId: text(input.paymentConditionId), discountAmount: num(input.discountAmount), freightAmount: num(input.freightAmount), expensesAmount: num(input.expensesAmount),
    taxPercent: num(input.taxPercent), warrantyDays: Math.round(num(input.warrantyDays)),
    lines: input.lines.map((line) => ({ lineType: line.lineType, catalogId: text(line.catalogId), description: text(line.description), quantity: num(line.quantity), unitPrice: num(line.unitPrice), unitCost: 0, discountPercent: num(line.discountPercent) })),
  }
  const invalid = validateQuote(normalized)
  if (invalid) fail(invalid)

  let previous: any = null
  let previousItems: any[] = []
  if (input.id) {
    const { data } = await admin.from("quotes").select("*").eq("id", input.id).maybeSingle()
    if (!data) fail("Orçamento não encontrado.")
    previous = data
    if (!editableInPlace(previous.status)) fail(`Orçamento ${previous.status.toLowerCase()} não pode ser editado: crie uma nova versão.`)
    previousItems = (await admin.from("quote_items").select("*").eq("quote_id", input.id)).data || []
  }

  const { data: condition } = await admin.from("payment_conditions").select("*").eq("id", normalized.paymentConditionId).maybeSingle()
  if (!condition) fail("Condição de pagamento não encontrada.")
  const catalog = await catalogSnapshot(admin, input.lines)

  const lines = input.lines.map((line, index) => {
    const existing = line.id ? previousItems.find((item) => item.id === line.id) : null
    const source = line.lineType === "Produto" ? catalog.material.get(line.catalogId) : catalog.service.get(line.catalogId)
    if (!source) fail(`Item "${text(line.description)}" não encontrado no catálogo.`)
    const fresh = line.lineType === "Produto"
      ? { price: Number(source.sale_price || 0), cost: Number(source.average_cost || source.cost_price || 0), unit: source.unit || "UN" }
      : { price: Number(source.default_price || 0), cost: Number(source.estimated_cost || 0), unit: source.billing_unit || "Servico" }
    const sameCatalogItem = existing && (existing.material_id || existing.service_type_id) === line.catalogId
    return {
      quote_item: {
        ...(existing && line.id ? { id: line.id } : {}), position: index, line_type: line.lineType, material_id: line.lineType === "Produto" ? line.catalogId : null, service_type_id: line.lineType === "Serviço" ? line.catalogId : null,
        description: text(line.description), unit: text(line.unit) || fresh.unit, quantity: num(line.quantity), unit_price: num(line.unitPrice),
        catalog_price: sameCatalogItem ? Number(existing.catalog_price) : fresh.price, unit_cost: sameCatalogItem ? Number(existing.unit_cost) : fresh.cost,
        discount_percent: num(line.discountPercent), notes: text(line.notes) || null,
      },
      calc: { lineType: line.lineType, quantity: num(line.quantity), unitPrice: num(line.unitPrice), discountPercent: num(line.discountPercent), unitCost: sameCatalogItem ? Number(existing.unit_cost) : fresh.cost },
    }
  })
  const totals = quoteTotals(lines.map((line) => line.calc), normalized)
  const snapshot = { installments: Number(condition.installments || 1), firstDueDays: Number(condition.first_due_days || 0), intervalDays: Number(condition.interval_days ?? 30), paymentMethod: condition.payment_method || "" }

  const header = {
    ...(input.id ? { id: input.id } : { status: "Rascunho", created_by: responsible }),
    title: text(input.title) || null, client_id: normalized.clientId, salesperson_id: normalized.salespersonId, opportunity_id: text(input.opportunityId) || null,
    issue_date: normalized.issueDate, valid_until: normalized.validUntil, quote_type: normalized.quoteType, items_subtotal: totals.subtotal, discount_amount: totals.discount,
    freight_amount: normalized.freightAmount, expenses_amount: normalized.expensesAmount, tax_percent: normalized.taxPercent, taxes_amount: totals.taxes, total_amount: totals.total, estimated_cost: totals.cost,
    payment_condition_id: condition.id, payment_condition_name: condition.name, payment_condition_snapshot: snapshot, delivery_text: text(input.deliveryText) || null,
    warranty_days: normalized.warrantyDays, notes: text(input.notes) || null,
  }
  const { data: saved, error } = await admin.from("quotes").upsert(header, { onConflict: "id" }).select("*").single()
  if (error) throw error

  // itens: mantém os existentes (preço congelado), grava os novos e remove os retirados
  const keepIds = lines.map((line) => (line.quote_item as any).id).filter(Boolean)
  const removed = previousItems.filter((item) => !keepIds.includes(item.id)).map((item) => item.id)
  if (removed.length) await admin.from("quote_items").delete().in("id", removed)
  const { error: itemsError } = await admin.from("quote_items").upsert(lines.map((line) => ({ ...line.quote_item, quote_id: saved.id, total: Math.round(line.calc.quantity * line.calc.unitPrice * (1 - line.calc.discountPercent / 100) * 100) / 100 })), { onConflict: "id" })
  if (itemsError) throw itemsError

  if (!previous) {
    await event(admin, saved.id, "Criado", `Orçamento ${saved.quote_number} criado (versão ${saved.version}).`, responsible)
    if (saved.opportunity_id) await linkOpportunity(admin, saved, responsible)
  } else {
    const before = { total: Number(previous.total_amount), items: previousItems.length, validUntil: previous.valid_until, discount: Number(previous.discount_amount), paymentConditionName: previous.payment_condition_name || "" }
    const after = { total: totals.total, items: lines.length, validUntil: normalized.validUntil, discount: totals.discount, paymentConditionName: condition.name }
    await event(admin, saved.id, "Alterado", describeChanges(before, after), responsible)
  }
  return (await getQuote(admin, saved.id))
}

/** Liga o orçamento à oportunidade e leva o funil à etapa Orçamento (se estiver antes). */
async function linkOpportunity(admin: Admin, quote: any, responsible: string) {
  const { data: opportunity } = await admin.from("opportunities").select("id,stage").eq("id", quote.opportunity_id).maybeSingle()
  if (!opportunity || ["Ganho", "Perdido"].includes(opportunity.stage)) return
  const early = ["Novo lead", "Contato realizado", "Qualificação"].includes(opportunity.stage)
  await admin.from("opportunities").update({ quote_id: quote.id, quote_number: quote.quote_number, ...(early ? { stage: "Orçamento", probability: stageProbability.Orçamento } : {}) }).eq("id", opportunity.id)
  await admin.from("opportunity_interactions").insert({ opportunity_id: opportunity.id, kind: "Orçamento", description: `Orçamento ${quote.quote_number} criado.${early ? ` Etapa alterada de ${opportunity.stage} para Orçamento.` : ""}`, automatic: true, author: responsible })
}

async function copyItems(admin: Admin, fromId: string, toId: string) {
  const { data } = await admin.from("quote_items").select("*").eq("quote_id", fromId).order("position")
  if (!data?.length) return
  const { error } = await admin.from("quote_items").insert(data.map((item) => ({ ...item, id: randomUUID(), quote_id: toId, created_at: undefined, system_company_id: undefined })))
  if (error) throw error
}

/** Nova versão de um orçamento já enviado: copia itens e preços negociados; a versão anterior fica "Substituído". */
export async function createVersion(admin: Admin, id: string, responsible: string) {
  const { data: source } = await admin.from("quotes").select("*").eq("id", id).maybeSingle()
  if (!source) fail("Orçamento não encontrado.")
  const status = effectiveStatus(source!.status, source!.valid_until)
  if (!canCreateVersion(status)) fail(status === "Rascunho" ? "Rascunho é editado direto, sem nova versão." : `Orçamento ${status.toLowerCase()} não gera nova versão.`)
  const { data: latest } = await admin.from("quotes").select("version").eq("quote_number", source!.quote_number).order("version", { ascending: false }).limit(1)
  const version = Number(latest?.[0]?.version || source!.version) + 1
  const issue = today()
  const minimumValidity = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
  const copy = {
    ...source, id: randomUUID(), version, status: "Rascunho", issue_date: issue, valid_until: source!.valid_until > minimumValidity ? source!.valid_until : minimumValidity,
    sent_at: null, sent_via: null, sent_to: null, approved_at: null, accepted_by: null, accept_notes: null, refusal_reason: null, converted_at: null, converted_to: null, receivables_generated_at: null,
    created_by: responsible, created_at: undefined, updated_at: undefined, system_company_id: undefined,
  }
  const { data: created, error } = await admin.from("quotes").insert(copy).select("*").single()
  if (error) throw error
  await copyItems(admin, id, created.id)
  await admin.from("quotes").update({ status: "Substituído" }).eq("id", id)
  await event(admin, id, "Substituído", `Substituído pela versão ${version}.`, responsible)
  await event(admin, created.id, "Versão", `Versão ${version} criada a partir da versão ${source!.version}.`, responsible)
  return getQuote(admin, created.id)
}

/** Duplicar: novo número, versão 1, rascunho, mantendo itens e preços. */
export async function duplicateQuote(admin: Admin, id: string, responsible: string) {
  const { data: source } = await admin.from("quotes").select("*").eq("id", id).maybeSingle()
  if (!source) fail("Orçamento não encontrado.")
  const issue = today()
  const validity = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
  const copy = {
    ...source, id: randomUUID(), quote_number: undefined, version: 1, status: "Rascunho", issue_date: issue, valid_until: validity, opportunity_id: null,
    sent_at: null, sent_via: null, sent_to: null, approved_at: null, accepted_by: null, accept_notes: null, refusal_reason: null, converted_at: null, converted_to: null, receivables_generated_at: null,
    created_by: responsible, created_at: undefined, updated_at: undefined, system_company_id: undefined,
  }
  const { data: created, error } = await admin.from("quotes").insert(copy).select("*").single()
  if (error) throw error
  await copyItems(admin, id, created.id)
  await event(admin, created.id, "Criado", `Duplicado do orçamento ${source!.quote_number} (versão ${source!.version}).`, responsible)
  return getQuote(admin, created.id)
}

// ---------------- Situação, envio e aceite

export async function changeQuoteStatus(admin: Admin, id: string, to: string, extra: { acceptedBy?: string; acceptNotes?: string; reason?: string; via?: string; sentTo?: string }, responsible: string) {
  const { data: row } = await admin.from("quotes").select("*").eq("id", id).maybeSingle()
  if (!row) fail("Orçamento não encontrado.")
  const message = validateQuoteTransition(row!.status, to, { acceptedBy: extra.acceptedBy, reason: extra.reason, validUntil: row!.valid_until })
  if (message) fail(message)
  const patch: Record<string, any> = { status: to }
  let description = ""
  if (to === "Enviado") {
    if (!(Number(row!.total_amount) > 0)) fail("O orçamento está com valor zerado.")
    patch.sent_at = new Date().toISOString(); patch.sent_via = text(extra.via) || null; patch.sent_to = text(extra.sentTo) || null
    description = `Enviado${extra.via ? ` por ${extra.via}` : ""}${extra.sentTo ? ` para ${extra.sentTo}` : ""}.`
  } else if (to === "Aprovado") {
    patch.approved_at = new Date().toISOString(); patch.accepted_by = text(extra.acceptedBy); patch.accept_notes = text(extra.acceptNotes) || null
    description = `Aprovado. Aceite: ${text(extra.acceptedBy)}.${extra.acceptNotes ? ` ${text(extra.acceptNotes)}` : ""}`
  } else if (to === "Recusado") {
    patch.refusal_reason = text(extra.reason)
    description = `Recusado: ${text(extra.reason)}.`
  } else if (to === "Cancelado") {
    patch.refusal_reason = text(extra.reason)
    description = `Cancelado: ${text(extra.reason)}.`
  }
  const { error } = await admin.from("quotes").update(patch).eq("id", id)
  if (error) throw error
  await event(admin, id, to, description, responsible)
  return getQuote(admin, id)
}

// ---------------- Conversão em venda / OS (gera os títulos a receber)

async function winOpportunity(admin: Admin, quote: any, responsible: string) {
  if (!quote.opportunity_id) return
  const { data: opportunity } = await admin.from("opportunities").select("id,stage,client_id").eq("id", quote.opportunity_id).maybeSingle()
  if (!opportunity || ["Ganho", "Perdido"].includes(opportunity.stage)) return
  const { data: client } = await admin.from("clients").select("status").eq("id", opportunity.client_id).maybeSingle()
  if (client?.status === "Prospect") await admin.from("clients").update({ status: "Ativo" }).eq("id", opportunity.client_id)
  await admin.from("opportunities").update({ stage: "Ganho", probability: 100, estimated_value: quote.total_amount, closed_at: new Date().toISOString(), next_contact_date: null, quote_id: quote.id, quote_number: quote.quote_number }).eq("id", opportunity.id)
  await admin.from("opportunity_interactions").insert({ opportunity_id: opportunity.id, kind: "Etapa", description: `Ganho: orçamento ${quote.quote_number} formalizado.`, automatic: true, author: responsible })
}

/**
 * Formaliza o orçamento aprovado: gera os títulos a receber pela condição acordada e,
 * na venda direta, dá baixa no estoque dos produtos. Para OS, a baixa fica por conta da OS.
 */
export async function formalizeQuote(admin: Admin, id: string, options: { target: "Venda" | "OS"; warehouseId?: string; baseDate?: string; serviceOrderId?: string }, responsible: string) {
  const { data: quote } = await admin.from("quotes").select("*").eq("id", id).maybeSingle()
  if (!quote) fail("Orçamento não encontrado.")
  if (quote!.status !== "Aprovado") fail(quote!.status === "Convertido" ? "Este orçamento já foi formalizado." : "Só é possível formalizar um orçamento aprovado.")
  if (quote!.receivables_generated_at) fail("Os títulos deste orçamento já foram gerados.")
  const { data: items } = await admin.from("quote_items").select("*").eq("quote_id", id).order("position")
  const rule = quote!.payment_condition_snapshot
  if (!rule) fail("O orçamento não tem condição de pagamento registrada.")
  const baseDate = text(options.baseDate) || today()

  const stockLines = options.target === "Venda" ? (items || []).filter((item) => item.line_type === "Produto" && item.material_id) : []
  const controlled: Array<{ item: any; material: any }> = []
  if (stockLines.length) {
    const { data: materials } = await admin.from("materials").select("id,name,current_stock,reserved_stock,controls_stock").in("id", stockLines.map((item) => item.material_id))
    for (const item of stockLines) {
      const material = (materials || []).find((row) => row.id === item.material_id)
      if (!material || material.controls_stock === false) continue
      const available = Number(material.current_stock || 0) - Number(material.reserved_stock || 0)
      if (available + 0.0005 < Number(item.quantity)) fail(`Estoque insuficiente de ${material.name}: disponível ${available}, orçamento pede ${item.quantity}.`)
      controlled.push({ item, material })
    }
    if (controlled.length && !text(options.warehouseId)) fail("Escolha o depósito de onde sairão os produtos.")
  }

  const parcels = buildInstallments(Number(quote!.total_amount), { installments: rule.installments, firstDueDays: rule.firstDueDays, intervalDays: rule.intervalDays }, baseDate)
  const group = randomUUID()
  const reference = `${quote!.quote_number} v${quote!.version}`
  const { error } = await admin.from("accounts_receivable").insert(parcels.map((parcel) => ({
    client_id: quote!.client_id, description: `Orçamento ${reference}${parcels.length > 1 ? ` - parcela ${parcel.number}/${parcels.length}` : ""}`, competence_date: baseDate, due_date: parcel.dueDate,
    expected_amount: parcel.amount, received_amount: 0, receipt_method: rule.paymentMethod || "", status: "Aberta", origin: "Orçamento", document_number: quote!.quote_number,
    installment_number: parcels.length > 1 ? parcel.number : null, installment_count: parcels.length > 1 ? parcels.length : null, installment_group_id: parcels.length > 1 ? group : null,
    payment_condition_id: quote!.payment_condition_id, source_type: "Orçamento", source_reference: reference, service_order_id: options.serviceOrderId || null, created_by: responsible, updated_by: responsible,
    notes: `Gerado na formalização do orçamento ${reference}.`,
  })))
  if (error) throw error

  const warnings: string[] = []
  for (const { item } of controlled) {
    try {
      await applyStockMovement(admin, { materialId: item.material_id, movementType: "Saida por venda", quantity: Number(item.quantity), fromWarehouseId: text(options.warehouseId), unitCost: null, responsible, documentReference: reference, reason: "Venda formalizada pelo orçamento" })
    } catch (reason) {
      warnings.push(`Baixa de ${item.description}: ${reason instanceof Error ? reason.message : "falhou"}`)
    }
  }
  await admin.from("quotes").update({ status: "Convertido", converted_to: options.target, converted_at: new Date().toISOString(), receivables_generated_at: new Date().toISOString() }).eq("id", id)
  await event(admin, id, "Convertido", `Formalizado como ${options.target === "OS" ? "ordem de serviço" : "venda"}: ${parcels.length} título(s) a receber de ${Number(quote!.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.${warnings.length ? ` Atenção: ${warnings.join(" ")}` : ""}`, responsible)
  await winOpportunity(admin, quote, responsible)
  return { ...(await getQuote(admin, id)), warnings }
}

/** Orçamento aprovado que virou contrato: os títulos saem da recorrência do contrato, não do orçamento. */
export async function markQuoteAsContract(admin: Admin, quoteId: string, contractNumber: string, responsible: string) {
  const { data: quote } = await admin.from("quotes").select("*").eq("id", quoteId).maybeSingle()
  if (!quote) fail("Orçamento não encontrado.")
  if (quote!.status !== "Aprovado") fail("Só é possível gerar contrato de um orçamento aprovado.")
  await admin.from("quotes").update({ status: "Convertido", converted_to: "Contrato", converted_at: new Date().toISOString() }).eq("id", quoteId)
  await event(admin, quoteId, "Convertido", `Convertido no contrato ${contractNumber}. Os lançamentos financeiros seguem as condições do contrato.`, responsible)
  await winOpportunity(admin, quote, responsible)
}

/** Dados do orçamento aprovado para pré-preencher a OS. */
export async function quoteForOrder(admin: Admin, id: string) {
  const detail = await getQuote(admin, id)
  if (detail.quote.status !== "Aprovado") fail(detail.quote.status === "Convertido" ? "Este orçamento já foi formalizado." : "Só é possível abrir OS de um orçamento aprovado.")
  const eff = (item: QuoteItemView) => Math.round(item.unitPrice * (1 - item.discountPercent / 100) * 10000) / 10000
  return {
    quoteId: id, number: detail.quote.number, clientId: detail.quote.clientId, opportunityId: detail.quote.opportunityId, discountAmount: detail.quote.discountAmount, warrantyDays: detail.quote.warrantyDays,
    paymentConditionName: detail.quote.paymentConditionName,
    services: detail.items.filter((item) => item.lineType === "Serviço").map((item) => ({ serviceTypeId: item.catalogId, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: eff(item) })),
    materials: detail.items.filter((item) => item.lineType === "Produto").map((item) => ({ materialId: item.catalogId, itemName: item.description, quantity: item.quantity, unit: item.unit, unitPrice: eff(item) })),
  }
}

// ---------------- Anexos, e-mail e logotipo

export async function addAttachment(admin: Admin, quoteId: string, file: { path: string; name: string }, responsible: string) {
  const { error } = await admin.from("quote_attachments").insert({ quote_id: quoteId, file_path: file.path, file_name: file.name, created_by: responsible })
  if (error) throw error
  await event(admin, quoteId, "Anexo", `Anexo adicionado: ${file.name}.`, responsible)
}

export async function removeAttachment(admin: Admin, attachmentId: string, responsible: string) {
  const { data } = await admin.from("quote_attachments").select("quote_id,file_name").eq("id", attachmentId).maybeSingle()
  const { error } = await admin.from("quote_attachments").delete().eq("id", attachmentId)
  if (error) throw error
  if (data) await event(admin, data.quote_id, "Anexo", `Anexo removido: ${data.file_name}.`, responsible)
}

export const emailConfigured = () => Boolean(String(process.env.RESEND_API_KEY || "").trim())

export async function sendQuoteEmail(admin: Admin, id: string, input: { to: string; subject?: string; message?: string; pdfBase64: string; companyName: string; replyTo?: string }, responsible: string) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  if (!apiKey) fail("Envio por e-mail não configurado: defina RESEND_API_KEY no servidor.")
  const to = text(input.to)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) fail("Informe um e-mail de destino válido.")
  if (!text(input.pdfBase64)) fail("PDF do orçamento não foi gerado.")
  const detail = await getQuote(admin, id)
  const { quote } = detail
  const eff = quote.effectiveStatus
  if (!["Rascunho", "Enviado"].includes(eff)) fail(`Orçamento ${eff.toLowerCase()} não pode ser enviado.`)
  const message = text(input.message) || shareMessage({ companyName: input.companyName, clientName: quote.clientName, quoteNumber: quote.number, version: quote.version, total: quote.totalAmount, validUntil: quote.validUntil })
  const from = String(process.env.QUOTE_FROM_EMAIL || process.env.SYSTEM_ALERT_FROM_EMAIL || "ERP Carretas <onboarding@resend.dev>").trim()
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], ...(input.replyTo ? { reply_to: input.replyTo } : {}), subject: text(input.subject) || `Orçamento ${quote.number}${quote.version > 1 ? ` v${quote.version}` : ""} - ${input.companyName}`,
      html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><p>${escape(message).replace(/\n/g, "<br>")}</p></div>`,
      attachments: [{ filename: `${quote.number}-v${quote.version}.pdf`, content: text(input.pdfBase64) }],
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    fail(`Falha no envio: ${payload?.message || `Resend HTTP ${response.status}`}`)
  }
  return changeQuoteStatus(admin, id, "Enviado", { via: "E-mail", sentTo: to }, responsible)
}

export async function companyBranding(admin: Admin, companyId: string) {
  const { data } = await admin.from("system_companies").select("id,name,legal_name,trade_name,cnpj,email,phone,address,logo_path").eq("id", companyId).maybeSingle()
  return {
    id: data?.id || companyId, name: data?.trade_name || data?.name || "Empresa", legalName: data?.legal_name || "", cnpj: data?.cnpj || "", email: data?.email || "", phone: data?.phone || "",
    address: data?.address || "", hasLogo: Boolean(data?.logo_path), logoPath: data?.logo_path || "",
  }
}
