import type { createAdminClient } from "@/lib/supabase/server"
import { addMonths, adjustedValue, advanceRun, contractAlerts, dueRuns, finalStatuses, isRecurring, nextAdjustment, pendingCompetences, validateContract, validateContractTransition, type ContractAlert, type ContractInput, type ValueStep } from "@/lib/contracts"
import { saveOs } from "@/lib/os-server"
import { emailConfigured, markQuoteAsContract } from "@/lib/quotes-server"
import { readAllPages } from "@/lib/supabase-pagination"

type Admin = ReturnType<typeof createAdminClient>

export const CONTRACTS_MIGRATION_HINT = "Módulo Contratos ainda não instalado no banco. Rode scripts/211_contratos.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string): never => { throw new Error(message) }
const text = (value: unknown) => String(value ?? "").trim()
const num = (value: unknown) => Number(String(value ?? "").replace(",", ".")) || 0
const today = () => new Date().toISOString().slice(0, 10)
const AUTOMATION = "Automação de contratos"
const requiresAsset = new Set(["Manutenção preventiva", "Manutenção corretiva", "Reparo", "Reforma", "Garantia", "Inspeção / vistoria"])

export function contractError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: CONTRACTS_MIGRATION_HINT, status: 503 }
  if (/não podem ser alterados nem apagados/i.test(message)) return { message: "Documentos de contrato não podem ser alterados nem apagados: envie uma nova versão.", status: 400 }
  return { message, status: 400 }
}

// ---------------- Leitura

function toContract(row: any, names: { clients: Map<string, string>; suppliers: Map<string, string> }, extra: { hasSignature: boolean; billed: number; pending: number } = { hasSignature: false, billed: 0, pending: 0 }) {
  return {
    id: row.id, number: row.contract_number as string, contractType: row.contract_type as string, direction: row.direction as "Receita" | "Despesa", title: row.title, clientId: row.client_id || "", supplierId: row.supplier_id || "",
    counterpartyName: row.direction === "Receita" ? names.clients.get(row.client_id) || "-" : names.suppliers.get(row.supplier_id) || "-", quoteId: row.quote_id || "", signedDate: row.signed_date || "",
    startDate: row.start_date, endDate: row.end_date || "", indefinite: Boolean(row.indefinite), totalValue: Number(row.total_value), initialRecurringValue: Number(row.initial_recurring_value), recurringValue: Number(row.recurring_value),
    billingPeriodicity: row.billing_periodicity || "", dueDay: row.due_day || 0, billingStartDate: row.billing_start_date || "", billingAdvanceDays: Number(row.billing_advance_days ?? 10), paymentMethod: row.payment_method,
    adjustmentIndex: row.adjustment_index, adjustmentPercent: Number(row.adjustment_percent || 0), nextAdjustmentDate: row.next_adjustment_date || "", noticeDays: Number(row.notice_days || 0), autoRenew: Boolean(row.auto_renew),
    renewalMonths: Number(row.renewal_months || 0), penaltyTerms: row.penalty_terms || "", scope: row.scope, sla: row.sla || "", responsibleUserId: row.responsible_user_id || "", responsibleName: row.responsible_name,
    status: row.status as string, statusReason: row.status_reason || "", version: Number(row.version || 1), createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at,
    hasSignature: extra.hasSignature, billedTotal: extra.billed, pendingObligations: extra.pending,
  }
}

async function partyNames(admin: Admin) {
  const [clients, suppliers] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("clients").select("id,name").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("suppliers").select("id,name").order("id").range(from, to)),
  ])
  return { clients: new Map<string, string>(clients.map((row) => [row.id as string, row.name as string])), suppliers: new Map<string, string>(suppliers.map((row) => [row.id as string, row.name as string])) }
}

const SIGNATURE_KINDS = ["Contrato assinado", "Evidência de aceite"]

export async function listContracts(admin: Admin) {
  const [rows, names, documents, billings, obligations] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("contracts").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
    partyNames(admin),
    readAllPages<any>((from, to) => admin.from("contract_documents").select("contract_id,kind").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("contract_billings").select("contract_id,amount").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("contract_obligations").select("contract_id,status").eq("status", "Pendente").order("id").range(from, to)),
  ])
  return rows.map((row) => toContract(row, names, {
    hasSignature: documents.some((doc) => doc.contract_id === row.id && SIGNATURE_KINDS.includes(doc.kind)),
    billed: Math.round(billings.filter((item) => item.contract_id === row.id).reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100,
    pending: obligations.filter((item) => item.contract_id === row.id).length,
  }))
}

export async function getContract(admin: Admin, id: string) {
  const { data: row, error } = await admin.from("contracts").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  if (!row) fail("Contrato não encontrado.")
  const [names, billings, amendments, documents, obligations, plans, events, orders] = await Promise.all([
    partyNames(admin),
    admin.from("contract_billings").select("*").eq("contract_id", id).order("competence_date", { ascending: false }),
    admin.from("contract_amendments").select("*").eq("contract_id", id).order("amendment_number", { ascending: false }),
    admin.from("contract_documents").select("*").eq("contract_id", id).order("created_at", { ascending: false }),
    admin.from("contract_obligations").select("*").eq("contract_id", id).order("due_date"),
    admin.from("contract_os_plans").select("*").eq("contract_id", id).order("next_run_date"),
    admin.from("contract_events").select("*").eq("contract_id", id).order("created_at", { ascending: false }),
    admin.from("service_orders").select("id,order_number,status,created_at").eq("contract_id", id).order("created_at", { ascending: false }).limit(100),
  ])
  const receivableIds = (billings.data || []).map((item) => item.receivable_id).filter(Boolean)
  const payableIds = (billings.data || []).map((item) => item.payable_id).filter(Boolean)
  const [receivables, payables] = await Promise.all([
    receivableIds.length ? admin.from("accounts_receivable").select("id,status,received_amount").in("id", receivableIds) : { data: [] as any[] },
    payableIds.length ? admin.from("accounts_payable").select("id,status,paid_amount").in("id", payableIds) : { data: [] as any[] },
  ])
  const titleStatus = new Map<string, string>([...(receivables.data || []), ...(payables.data || [])].map((item: any) => [item.id as string, item.status as string]))
  const docs = documents.data || []
  return {
    contract: toContract(row, names, { hasSignature: docs.some((doc) => SIGNATURE_KINDS.includes(doc.kind)), billed: Math.round((billings.data || []).reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100, pending: (obligations.data || []).filter((item) => item.status === "Pendente").length }),
    billings: (billings.data || []).map((item) => ({ id: item.id, competence: item.competence_date, periodEnd: item.period_end, dueDate: item.due_date, amount: Number(item.amount), titleId: item.receivable_id || item.payable_id || "", titleStatus: titleStatus.get(item.receivable_id || item.payable_id) || "" })),
    amendments: (amendments.data || []).map((item) => ({ id: item.id, number: item.amendment_number, kind: item.kind, description: item.description, effectiveDate: item.effective_date, before: item.before_snapshot, after: item.after_snapshot, createdBy: item.created_by || "", at: item.created_at })),
    documents: docs.map((item) => ({ id: item.id, kind: item.kind, title: item.title, version: item.version, isOriginal: item.is_original, path: item.file_path, name: item.file_name, signedAt: item.signed_at || "", amendmentId: item.amendment_id || "", createdBy: item.created_by || "", at: item.created_at })),
    obligations: (obligations.data || []).map((item) => ({ id: item.id, kind: item.kind, title: item.title, description: item.description || "", party: item.party, responsibleName: item.responsible_name || "", dueDate: item.due_date || "", status: item.status, completedAt: item.completed_at || "", notes: item.notes || "" })),
    plans: (plans.data || []).map((item) => ({ id: item.id, title: item.title, periodicity: item.periodicity, orderKind: item.order_kind, serviceTypeId: item.service_type_id, technicianId: item.technician_id, customerAssetId: item.customer_asset_id || "", priority: item.priority, description: item.description || "", leadDays: item.lead_days, nextRunDate: item.next_run_date, lastRunDate: item.last_run_date || "", active: Boolean(item.active) })),
    events: (events.data || []).map((item) => ({ id: item.id, event: item.event, description: item.description, author: item.author || "", at: item.created_at })),
    orders: (orders.data || []).map((item) => ({ id: item.id, number: item.order_number, status: item.status, at: item.created_at })),
  }
}

async function event(admin: Admin, contractId: string, name: string, description: string, author: string) {
  await admin.from("contract_events").insert({ contract_id: contractId, event: name, description, author })
}

// ---------------- Cadastro

export type ContractSaveInput = Record<string, any>

const toInput = (input: ContractSaveInput): ContractInput => ({
  contractType: text(input.contractType), direction: text(input.direction), title: text(input.title), clientId: text(input.clientId), supplierId: text(input.supplierId), signedDate: text(input.signedDate), startDate: text(input.startDate),
  endDate: text(input.endDate), indefinite: Boolean(input.indefinite), totalValue: num(input.totalValue), recurringValue: num(input.recurringValue), billingPeriodicity: text(input.billingPeriodicity), dueDay: Math.round(num(input.dueDay)),
  paymentMethod: text(input.paymentMethod), adjustmentIndex: text(input.adjustmentIndex) || "Nenhum", adjustmentPercent: num(input.adjustmentPercent), noticeDays: Math.round(num(input.noticeDays)), autoRenew: Boolean(input.autoRenew),
  renewalMonths: Math.round(num(input.renewalMonths)), scope: text(input.scope), sla: text(input.sla), responsibleName: text(input.responsibleName), status: text(input.status) || "Rascunho",
})

/** Valida e grava o contrato. Depois de vigente, os termos só mudam por aditivo. */
export async function saveContract(admin: Admin, input: ContractSaveInput, responsible: string) {
  const data = toInput(input)
  const invalid = validateContract(data)
  if (invalid) fail(invalid)
  if (!["Rascunho", "Aguardando assinatura"].includes(data.status)) fail("O contrato é criado como rascunho ou aguardando assinatura; para vigente, use a mudança de situação com a assinatura.")
  let previous: any = null
  if (input.id) {
    const { data: current } = await admin.from("contracts").select("*").eq("id", input.id).maybeSingle()
    if (!current) fail("Contrato não encontrado.")
    previous = current
    if (!["Rascunho", "Aguardando assinatura"].includes(previous.status)) fail(`Contrato ${previous.status.toLowerCase()}: os termos só mudam por aditivo.`)
  }
  if (data.direction === "Receita") {
    const { data: client } = await admin.from("clients").select("id").eq("id", data.clientId).maybeSingle()
    if (!client) fail("Cliente não encontrado.")
  } else {
    const { data: supplier } = await admin.from("suppliers").select("id").eq("id", data.supplierId).maybeSingle()
    if (!supplier) fail("Fornecedor não encontrado.")
  }
  const quoteId = text(input.quoteId)
  if (quoteId && !previous) {
    const { data: quote } = await admin.from("quotes").select("status,client_id").eq("id", quoteId).maybeSingle()
    if (!quote) fail("Orçamento de origem não encontrado.")
    if (quote!.status !== "Aprovado") fail("O orçamento de origem precisa estar aprovado.")
    if (data.direction === "Receita" && quote!.client_id !== data.clientId) fail("O cliente do contrato é diferente do cliente do orçamento.")
  }
  const recurring = isRecurring(data)
  const row = {
    ...(previous ? { id: previous.id } : { status: data.status, created_by: responsible, initial_recurring_value: recurring ? data.recurringValue : 0, quote_id: quoteId || null }),
    contract_type: data.contractType, direction: data.direction, title: data.title, client_id: data.direction === "Receita" ? data.clientId : null, supplier_id: data.direction === "Despesa" ? data.supplierId : null,
    signed_date: data.signedDate || null, start_date: data.startDate, end_date: data.indefinite ? null : data.endDate || null, indefinite: data.indefinite, total_value: data.totalValue,
    ...(previous ? { initial_recurring_value: recurring ? data.recurringValue : 0 } : {}),
    recurring_value: recurring ? data.recurringValue : 0, billing_periodicity: recurring ? data.billingPeriodicity : null, due_day: recurring ? data.dueDay : null,
    billing_start_date: text(input.billingStartDate) || null, billing_advance_days: Math.min(90, Math.max(0, Math.round(num(input.billingAdvanceDays ?? 10)))), payment_method: data.paymentMethod,
    adjustment_index: data.adjustmentIndex, adjustment_percent: data.adjustmentIndex === "Percentual fixo" ? data.adjustmentPercent : null,
    next_adjustment_date: data.adjustmentIndex === "Nenhum" ? null : text(input.nextAdjustmentDate) || nextAdjustment(data.startDate), notice_days: data.noticeDays, auto_renew: data.autoRenew,
    renewal_months: data.autoRenew ? data.renewalMonths : null, penalty_terms: text(input.penaltyTerms) || null, scope: data.scope, sla: data.sla || null, responsible_user_id: text(input.responsibleUserId) || null,
    responsible_name: data.responsibleName, ...(previous ? { status: data.status } : {}),
  }
  const { data: saved, error } = await admin.from("contracts").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  if (!previous) {
    await event(admin, saved.id, "Criado", `Contrato ${saved.contract_number} criado.${quoteId ? " Origem: orçamento aprovado." : ""}`, responsible)
    if (quoteId) await markQuoteAsContract(admin, quoteId, saved.contract_number, responsible)
  } else {
    await event(admin, saved.id, "Alterado", "Dados do contrato alterados.", responsible)
  }
  return getContract(admin, saved.id)
}

/** Campos operacionais que podem mudar sem aditivo (responsável, aviso, renovação, cobrança). */
export async function updateOperational(admin: Admin, id: string, input: Record<string, any>, responsible: string) {
  const { data: current } = await admin.from("contracts").select("*").eq("id", id).maybeSingle()
  if (!current) fail("Contrato não encontrado.")
  if (finalStatuses.has(current!.status)) fail(`Contrato ${current!.status.toLowerCase()} não pode ser alterado.`)
  if (!text(input.responsibleName)) fail("Informe o responsável interno.")
  const autoRenew = Boolean(input.autoRenew)
  if (autoRenew && !(num(input.renewalMonths) > 0)) fail("Renovação automática exige o prazo da renovação em meses.")
  const patch = {
    responsible_user_id: text(input.responsibleUserId) || null, responsible_name: text(input.responsibleName), notice_days: Math.max(0, Math.round(num(input.noticeDays))), auto_renew: autoRenew,
    renewal_months: autoRenew ? Math.round(num(input.renewalMonths)) : null, penalty_terms: text(input.penaltyTerms) || null, sla: text(input.sla) || null,
    billing_advance_days: Math.min(90, Math.max(0, Math.round(num(input.billingAdvanceDays ?? 10)))), billing_start_date: text(input.billingStartDate) || null,
  }
  const { error } = await admin.from("contracts").update(patch).eq("id", id)
  if (error) throw error
  await event(admin, id, "Alterado", "Dados operacionais atualizados (responsável, aviso prévio, renovação ou cobrança).", responsible)
  return getContract(admin, id)
}

export async function changeContractStatus(admin: Admin, id: string, to: string, extra: { reason?: string; signedDate?: string }, responsible: string) {
  const { data: row } = await admin.from("contracts").select("*").eq("id", id).maybeSingle()
  if (!row) fail("Contrato não encontrado.")
  const { count } = await admin.from("contract_documents").select("id", { count: "exact", head: true }).eq("contract_id", id).in("kind", SIGNATURE_KINDS)
  const signedDate = text(extra.signedDate) || row!.signed_date || ""
  const message = validateContractTransition(row!.status, to, { signedDate, hasSignature: Boolean(count), reason: extra.reason })
  if (message) fail(message)
  if (to === "Vigente" && signedDate > today()) fail("A data de assinatura não pode ser futura.")
  const patch: Record<string, any> = { status: to, status_reason: text(extra.reason) || null }
  if (to === "Vigente") patch.signed_date = signedDate
  const { error } = await admin.from("contracts").update(patch).eq("id", id)
  if (error) throw error
  if (finalStatuses.has(to)) await admin.from("contract_os_plans").update({ active: false }).eq("contract_id", id)
  await event(admin, id, to, `Situação alterada de ${row!.status} para ${to}.${extra.reason ? ` Motivo: ${text(extra.reason)}.` : ""}`, responsible)
  return getContract(admin, id)
}

// ---------------- Documentos e aditivos (versões)

/** Cada envio vira uma nova versão; nada é sobrescrito. O primeiro "Contrato assinado" é marcado como original. */
export async function addContractDocument(admin: Admin, contractId: string, input: { kind: string; title?: string; path: string; name: string; signedAt?: string; amendmentId?: string }, responsible: string) {
  const { data: contract } = await admin.from("contracts").select("id,status").eq("id", contractId).maybeSingle()
  if (!contract) fail("Contrato não encontrado.")
  if (!["Contrato assinado", "Aditivo", "Evidência de aceite", "Rescisão", "Outro"].includes(input.kind)) fail("Tipo de documento inválido.")
  if (!text(input.path)) fail("Arquivo não enviado.")
  const { data: existing } = await admin.from("contract_documents").select("version").eq("contract_id", contractId).eq("kind", input.kind).order("version", { ascending: false }).limit(1)
  const version = Number(existing?.[0]?.version || 0) + 1
  const { error } = await admin.from("contract_documents").insert({
    contract_id: contractId, amendment_id: text(input.amendmentId) || null, kind: input.kind, title: text(input.title) || input.kind, version, is_original: input.kind === "Contrato assinado" && version === 1,
    file_path: text(input.path), file_name: text(input.name) || "arquivo", signed_at: text(input.signedAt) || null, created_by: responsible,
  })
  if (error) throw error
  await event(admin, contractId, "Documento", `${input.kind} (versão ${version}) anexado: ${text(input.name)}.`, responsible)
}

export async function createAmendment(admin: Admin, contractId: string, input: Record<string, any>, responsible: string) {
  const { data: row } = await admin.from("contracts").select("*").eq("id", contractId).maybeSingle()
  if (!row) fail("Contrato não encontrado.")
  if (!["Vigente", "Suspenso"].includes(row!.status)) fail("Aditivos só se aplicam a contratos vigentes ou suspensos.")
  const kind = text(input.kind)
  const effectiveDate = text(input.effectiveDate) || today()
  if (!text(input.description)) fail("Descreva o aditivo.")
  const before = { endDate: row!.end_date || "", totalValue: Number(row!.total_value), recurringValue: Number(row!.recurring_value), scope: row!.scope, nextAdjustmentDate: row!.next_adjustment_date || "" }
  const after = { ...before }
  if (kind === "Reajuste") {
    const percent = num(input.percent)
    if (!(percent > 0)) fail("Informe o percentual do reajuste.")
    if (!(before.recurringValue > 0)) fail("Só contratos com valor recorrente têm reajuste por percentual: use um aditivo de valor.")
    after.recurringValue = adjustedValue(before.recurringValue, percent)
    after.nextAdjustmentDate = nextAdjustment(effectiveDate)
  } else if (kind === "Renovação") {
    const months = Math.round(num(input.months))
    if (!(months > 0)) fail("Informe o prazo da renovação em meses.")
    if (!row!.end_date) fail("Contrato por prazo indeterminado não precisa de renovação.")
    after.endDate = addMonths(row!.end_date, months)
  } else if (kind === "Aditivo de prazo") {
    if (!text(input.endDate)) fail("Informe o novo término.")
    after.endDate = text(input.endDate)
  } else if (kind === "Aditivo de valor") {
    if (input.totalValue !== undefined && text(input.totalValue) !== "") after.totalValue = num(input.totalValue)
    if (input.recurringValue !== undefined && text(input.recurringValue) !== "") after.recurringValue = num(input.recurringValue)
  } else if (kind === "Alteração de escopo") {
    if (!text(input.scope)) fail("Informe o novo escopo.")
    after.scope = text(input.scope)
  } else if (kind !== "Outro") {
    fail("Tipo de aditivo inválido.")
  }
  if (after.endDate && after.endDate < row!.start_date) fail("O novo término não pode ser anterior ao início.")
  if (!(after.totalValue > 0)) fail("O valor total deve ser maior que zero.")
  if (JSON.stringify(before) === JSON.stringify(after) && kind !== "Outro") fail("O aditivo não altera nada no contrato.")
  const { data: last } = await admin.from("contract_amendments").select("amendment_number").eq("contract_id", contractId).order("amendment_number", { ascending: false }).limit(1)
  const number = Number(last?.[0]?.amendment_number || 0) + 1
  const recurringChanged = after.recurringValue !== before.recurringValue
  const { data: amendment, error } = await admin.from("contract_amendments").insert({
    contract_id: contractId, amendment_number: number, kind, description: text(input.description), effective_date: effectiveDate, before_snapshot: before, after_snapshot: after,
    new_recurring_value: recurringChanged ? after.recurringValue : null, created_by: responsible,
  }).select("id").single()
  if (error) throw error
  const { error: updateError } = await admin.from("contracts").update({ end_date: after.endDate || null, total_value: after.totalValue, recurring_value: after.recurringValue, scope: after.scope, next_adjustment_date: after.nextAdjustmentDate || null, version: number + 1 }).eq("id", contractId)
  if (updateError) throw updateError
  await event(admin, contractId, "Aditivo", `Aditivo ${number} (${kind}): ${text(input.description)}`, responsible)
  return { amendmentId: amendment.id as string, detail: await getContract(admin, contractId) }
}

// ---------------- Obrigações e cronograma de OS

export async function saveObligation(admin: Admin, contractId: string, input: Record<string, any>, responsible: string) {
  if (!text(input.title)) fail("Informe a obrigação ou o documento.")
  if (!["Obrigação", "Documento"].includes(text(input.kind) || "Obrigação")) fail("Tipo inválido.")
  const status = ["Pendente", "Cumprida", "Cancelada"].includes(text(input.status)) ? text(input.status) : "Pendente"
  const row = {
    ...(input.id ? { id: input.id } : {}), contract_id: contractId, kind: text(input.kind) || "Obrigação", title: text(input.title), description: text(input.description) || null, party: input.party === "Contratante" ? "Contratante" : "Contratada",
    responsible_name: text(input.responsibleName) || null, due_date: text(input.dueDate) || null, status, completed_at: status === "Cumprida" ? new Date().toISOString() : null, notes: text(input.notes) || null,
  }
  const { error } = await admin.from("contract_obligations").upsert(row, { onConflict: "id" })
  if (error) throw error
  await event(admin, contractId, "Obrigação", `${row.kind} "${row.title}" ${input.id ? `atualizada (${status})` : "registrada"}.`, responsible)
  return getContract(admin, contractId)
}

export async function savePlan(admin: Admin, contractId: string, input: Record<string, any>, responsible: string) {
  const { data: contract } = await admin.from("contracts").select("id,direction,client_id").eq("id", contractId).maybeSingle()
  if (!contract) fail("Contrato não encontrado.")
  if (contract!.direction !== "Receita") fail("O cronograma de OS vale para contratos de receita (cliente).")
  if (!text(input.title)) fail("Informe o título do plano.")
  if (!["Semanal", "Quinzenal", "Mensal", "Bimestral", "Trimestral", "Semestral", "Anual"].includes(text(input.periodicity))) fail("Informe a periodicidade.")
  if (!text(input.serviceTypeId)) fail("Informe o serviço da OS.")
  if (!text(input.technicianId)) fail("Informe o responsável técnico.")
  if (!text(input.nextRunDate)) fail("Informe a data da próxima execução.")
  const kind = text(input.orderKind) || "Manutenção preventiva"
  if (requiresAsset.has(kind) && !text(input.customerAssetId)) fail("Vincule a carreta/veículo do cliente a este plano.")
  if (text(input.customerAssetId)) {
    const { data: asset } = await admin.from("customer_assets").select("client_id").eq("id", input.customerAssetId).maybeSingle()
    if (!asset || asset.client_id !== contract!.client_id) fail("A carreta/veículo precisa ser do cliente do contrato.")
  }
  const row = {
    ...(input.id ? { id: input.id } : {}), contract_id: contractId, title: text(input.title), periodicity: text(input.periodicity), order_kind: kind, service_type_id: input.serviceTypeId, technician_id: input.technicianId,
    customer_asset_id: text(input.customerAssetId) || null, priority: text(input.priority) || "Media", description: text(input.description) || null, lead_days: Math.min(60, Math.max(0, Math.round(num(input.leadDays ?? 3)))),
    next_run_date: text(input.nextRunDate), active: input.active !== false,
  }
  const { error } = await admin.from("contract_os_plans").upsert(row, { onConflict: "id" })
  if (error) throw error
  await event(admin, contractId, "Cronograma", `Plano de OS "${row.title}" (${row.periodicity}) ${input.id ? "atualizado" : "criado"}; próxima execução em ${row.next_run_date}.`, responsible)
  return getContract(admin, contractId)
}

// ---------------- Automação (cobrança recorrente, OS periódicas, alertas)

async function billContract(admin: Admin, contract: any, steps: ValueStep[], now: string, responsible: string) {
  const { data: done } = await admin.from("contract_billings").select("competence_date").eq("contract_id", contract.id)
  const competences = pendingCompetences({
    status: contract.status, startDate: contract.start_date, endDate: contract.end_date || "", billingStartDate: contract.billing_start_date || "", billingPeriodicity: contract.billing_periodicity || "",
    dueDay: contract.due_day || 0, billingAdvanceDays: Number(contract.billing_advance_days ?? 10), initialRecurringValue: Number(contract.initial_recurring_value),
  }, steps, (done || []).map((item) => item.competence_date), now)
  let created = 0
  const problems: string[] = []
  for (const item of competences) {
    // reserva a competência; se já existir (outra execução), não duplica
    const claim = await admin.from("contract_billings").insert({ contract_id: contract.id, competence_date: item.competence, period_end: item.periodEnd, due_date: item.dueDate, amount: item.amount }).select("id").single()
    if (claim.error) { if (!/duplicate key/.test(claim.error.message)) problems.push(claim.error.message); continue }
    const reference = `${contract.contract_number}@${item.competence}`
    const description = `Contrato ${contract.contract_number} - ${contract.title} (competência ${item.competence.slice(0, 7).split("-").reverse().join("/")})`
    const common = {
      description, competence_date: item.competence, due_date: item.dueDate, expected_amount: item.amount, status: "Aberta", origin: "Contrato", document_number: contract.contract_number, payment_condition_id: null,
      source_type: "Contrato", source_reference: reference, created_by: responsible, updated_by: responsible, notes: `Gerado automaticamente pelo contrato ${contract.contract_number}.`,
    }
    let titleId = ""
    let titleError = ""
    if (contract.direction === "Receita") {
      const { data, error } = await admin.from("accounts_receivable").insert({ ...common, client_id: contract.client_id, received_amount: 0, receipt_method: contract.payment_method }).select("id").single()
      titleId = data?.id || ""
      titleError = error?.message || ""
    } else {
      const { data: supplier } = await admin.from("suppliers").select("name").eq("id", contract.supplier_id).maybeSingle()
      const { data, error } = await admin.from("accounts_payable").insert({ ...common, supplier_id: contract.supplier_id, supplier_name: supplier?.name || "Fornecedor", paid_amount: 0, payment_method: contract.payment_method }).select("id").single()
      titleId = data?.id || ""
      titleError = error?.message || ""
    }
    if (titleError || !titleId) {
      await admin.from("contract_billings").delete().eq("id", claim.data.id)
      problems.push(`${reference}: ${titleError || "título não criado"}`)
      continue
    }
    await admin.from("contract_billings").update(contract.direction === "Receita" ? { receivable_id: titleId } : { payable_id: titleId }).eq("id", claim.data.id)
    created++
  }
  if (created) await event(admin, contract.id, "Cobrança", `${created} lançamento(s) financeiro(s) gerado(s) automaticamente.`, responsible)
  return { created, problems }
}

async function runPlans(admin: Admin, contract: any, now: string, responsible: string) {
  const { data: plans } = await admin.from("contract_os_plans").select("*").eq("contract_id", contract.id).eq("active", true)
  let created = 0
  const problems: string[] = []
  for (const plan of plans || []) {
    const runs = dueRuns({ periodicity: plan.periodicity, nextRunDate: plan.next_run_date, leadDays: plan.lead_days, active: plan.active }, { status: contract.status, endDate: contract.end_date || "" }, now)
    if (!runs.length) continue
    const { data: service } = await admin.from("service_types").select("name").eq("id", plan.service_type_id).maybeSingle()
    let lastDone = ""
    for (const date of runs) {
      const claim = await admin.from("contract_os_runs").insert({ plan_id: plan.id, scheduled_date: date }).select("id").single()
      if (!claim.error) {
        try {
          const os = await saveOs(admin, {
            orderKind: plan.order_kind, clientId: contract.client_id, customerAssetId: plan.customer_asset_id || undefined, serviceTypeId: plan.service_type_id,
            description: `${plan.title} — contrato ${contract.contract_number}${plan.description ? `. ${plan.description}` : ""}`, priority: plan.priority, technicianId: plan.technician_id, teamProviderIds: [], plannedStart: date, dueDate: date,
            entryChecklist: [], services: [{ serviceTypeId: plan.service_type_id, description: service?.name || plan.title, quantity: 1, unit: "Servico", unitPrice: 0, executed: false }], materials: [], discountAmount: 0, warrantyDays: 0,
            contractId: contract.id,
          }, responsible)
          await admin.from("contract_os_runs").update({ service_order_id: os.id }).eq("id", claim.data.id)
          created++
        } catch (reason) {
          await admin.from("contract_os_runs").delete().eq("id", claim.data.id)
          problems.push(`${plan.title} ${date}: ${reason instanceof Error ? reason.message : "falhou"}`)
          break
        }
      } else if (!/duplicate key/.test(claim.error.message)) {
        problems.push(claim.error.message)
        break
      }
      lastDone = date
    }
    if (lastDone) await admin.from("contract_os_plans").update({ last_run_date: lastDone, next_run_date: advanceRun(lastDone, plan.periodicity) }).eq("id", plan.id)
  }
  if (created) await event(admin, contract.id, "Cronograma", `${created} OS de manutenção aberta(s) automaticamente.`, responsible)
  return { created, problems }
}

export async function loadAlerts(admin: Admin, now = today()): Promise<ContractAlert[]> {
  const [rows, documents, obligations, profiles] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("contracts").select("*").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("contract_documents").select("contract_id,kind").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("contract_obligations").select("*").eq("status", "Pendente").order("id").range(from, to)),
    admin.from("profiles").select("id,email"),
  ])
  const emails = new Map<string, string>((profiles.data || []).map((row: any) => [row.id as string, row.email as string]))
  return contractAlerts(rows.map((row) => ({
    id: row.id, number: row.contract_number, title: row.title, status: row.status, endDate: row.end_date || "", noticeDays: Number(row.notice_days || 0), autoRenew: Boolean(row.auto_renew), nextAdjustmentDate: row.next_adjustment_date || "",
    responsibleName: row.responsible_name, responsibleEmail: emails.get(row.responsible_user_id) || "", hasSignature: documents.some((doc) => doc.contract_id === row.id && SIGNATURE_KINDS.includes(doc.kind)),
  })), obligations.map((item) => ({ contractId: item.contract_id, kind: item.kind, title: item.title, dueDate: item.due_date || "", status: item.status })), now)
}

async function notifyResponsibles(admin: Admin, alerts: ContractAlert[]) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  if (!apiKey) return 0
  const { data: logged } = await admin.from("contract_alert_log").select("contract_id,alert_key")
  const seen = new Set((logged || []).map((item) => `${item.contract_id}|${item.alert_key}`))
  const fresh = alerts.filter((alert) => alert.responsibleEmail && !seen.has(`${alert.contractId}|${alert.key}`))
  const byRecipient = new Map<string, ContractAlert[]>()
  fresh.forEach((alert) => byRecipient.set(alert.responsibleEmail, [...(byRecipient.get(alert.responsibleEmail) || []), alert]))
  const from = String(process.env.CONTRACT_FROM_EMAIL || process.env.QUOTE_FROM_EMAIL || process.env.SYSTEM_ALERT_FROM_EMAIL || "ERP Carretas <onboarding@resend.dev>").trim()
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
  let sent = 0
  for (const [recipient, items] of byRecipient) {
    const html = `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h3>Alertas de contratos</h3><ul>${items.map((item) => `<li><strong>${escape(item.contractNumber)}</strong> — ${escape(item.title)}<br>${escape(item.kind)}: ${escape(item.message)}</li>`).join("")}</ul></div>`
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [recipient], subject: `[Contratos] ${items.length} alerta(s) que precisam de atenção`, html }) })
    if (!response.ok) continue
    await admin.from("contract_alert_log").insert(items.map((item) => ({ contract_id: item.contractId, alert_key: item.key, recipient })))
    sent += items.length
  }
  return sent
}

/** Gera cobranças e OS pendentes e avisa os responsáveis. Pode rodar quantas vezes quiser: não duplica. */
export async function runAutomation(admin: Admin, now = today()) {
  const { data: contracts, error } = await admin.from("contracts").select("*").eq("status", "Vigente")
  if (error) throw error
  const summary = { billings: 0, orders: 0, notified: 0, alerts: 0, problems: [] as string[], emailConfigured: emailConfigured() }
  for (const contract of contracts || []) {
    try {
      if (isRecurring({ contractType: contract.contract_type, recurringValue: Number(contract.recurring_value) }) || Number(contract.initial_recurring_value) > 0) {
        const { data: amendments } = await admin.from("contract_amendments").select("effective_date,new_recurring_value").eq("contract_id", contract.id).not("new_recurring_value", "is", null)
        const steps: ValueStep[] = (amendments || []).map((item) => ({ from: item.effective_date, value: Number(item.new_recurring_value) }))
        const result = await billContract(admin, contract, steps, now, AUTOMATION)
        summary.billings += result.created
        summary.problems.push(...result.problems)
      }
      if (contract.direction === "Receita") {
        const result = await runPlans(admin, contract, now, AUTOMATION)
        summary.orders += result.created
        summary.problems.push(...result.problems)
      }
    } catch (reason) {
      summary.problems.push(`${contract.contract_number}: ${reason instanceof Error ? reason.message : "falhou"}`)
    }
  }
  const alerts = await loadAlerts(admin, now)
  summary.alerts = alerts.length
  try {
    summary.notified = await notifyResponsibles(admin, alerts)
  } catch (reason) {
    summary.problems.push(`E-mail: ${reason instanceof Error ? reason.message : "falhou"}`)
  }
  return summary
}
