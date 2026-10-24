import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { cleanDocument, fiscalPendencies, formatDocument, stageProbability, validateOpportunity, validateParty, validateStageChange, type FunnelStage, type Party } from "@/lib/commercial"
import { readAllPages } from "@/lib/supabase-pagination"

type Admin = ReturnType<typeof createAdminClient>

export const COMMERCIAL_MIGRATION_HINT = "Módulo Comercial ainda não instalado no banco. Rode scripts/209_comercial.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string): never => { throw new Error(message) }
const text = (value: unknown) => String(value ?? "").trim()

export function commercialError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: COMMERCIAL_MIGRATION_HINT, status: 503 }
  if (/duplicate key/.test(message)) return { message: "Já existe um cadastro com este CPF/CNPJ.", status: 400 }
  if (/violates foreign key/.test(message)) return { message: "Registro vinculado a outros dados; inative em vez de excluir.", status: 400 }
  return { message, status: 400 }
}

// ---------------- Clientes e fornecedores (cadastro único)

export type PartyRecord = Party & { id: string; partyId: string; clientId: string; supplierId: string; createdAt: string; pendencies: string[] }

function fromClient(row: any): Omit<Party, "kind"> {
  return {
    personType: row.type === "PF" ? "PF" : "PJ", name: row.name || "", tradeName: row.trade_name || "", document: row.document || "", stateRegistration: row.state_registration || "",
    municipalRegistration: row.municipal_registration || "", icmsIndicator: row.icms_indicator || "9", phone: row.phone || row.mobile || "", email: row.email || "", zipCode: row.zip_code || "",
    street: row.street || "", number: row.number || "", complement: row.complement || "", district: row.district || "", city: row.city || "", state: row.state || "",
    contactName: row.responsible_name || "", contactRole: row.contact_role || "", salespersonId: row.salesperson_id || "", creditLimit: Number(row.credit_limit || 0),
    paymentConditionId: row.payment_condition_id || "", commercialNotes: row.commercial_notes ?? row.notes ?? "", status: row.status || "Ativo",
  }
}

function fromSupplier(row: any): Omit<Party, "kind"> {
  return {
    personType: row.person_type === "PF" ? "PF" : "PJ", name: row.name || "", tradeName: row.trade_name || "", document: row.document || "", stateRegistration: row.state_registration || "",
    municipalRegistration: row.municipal_registration || "", icmsIndicator: row.icms_indicator || "1", phone: row.phone || "", email: row.email || "", zipCode: row.zip_code || "",
    street: row.street || "", number: row.number || "", complement: row.complement || "", district: row.district || "", city: row.city || "", state: row.state || "",
    contactName: row.contact_name || "", contactRole: row.contact_role || "", salespersonId: "", creditLimit: 0, paymentConditionId: row.payment_condition_id || "",
    commercialNotes: row.commercial_notes ?? row.notes ?? "", status: row.status || "Ativo",
  }
}

const sameDocument = (a?: string, b?: string) => Boolean(cleanDocument(a)) && cleanDocument(a) === cleanDocument(b)

/** Junta cliente e fornecedor que são a mesma pessoa (mesmo party_id ou mesmo CPF/CNPJ). */
export async function listParties(admin: Admin): Promise<PartyRecord[]> {
  const [clients, suppliers] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("clients").select("*").order("name").order("id").range(from, to)),
    readAllPages<any>((from, to) => admin.from("suppliers").select("*").order("name").order("id").range(from, to)),
  ])
  const used = new Set<string>()
  const records: PartyRecord[] = []
  for (const client of clients) {
    const supplier = suppliers.find((row) => !used.has(row.id) && ((client.party_id && row.party_id === client.party_id) || sameDocument(row.document, client.document)))
    if (supplier) used.add(supplier.id)
    const base = fromClient(client)
    const party: Party = { ...base, kind: supplier ? "ambos" : "cliente" }
    records.push({ ...party, id: client.id, partyId: client.party_id || "", clientId: client.id, supplierId: supplier?.id || "", createdAt: client.created_at, pendencies: fiscalPendencies(party) })
  }
  for (const supplier of suppliers) {
    if (used.has(supplier.id)) continue
    const party: Party = { ...fromSupplier(supplier), kind: "fornecedor" }
    records.push({ ...party, id: supplier.id, partyId: supplier.party_id || "", clientId: "", supplierId: supplier.id, createdAt: supplier.created_at, pendencies: fiscalPendencies(party) })
  }
  return records.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

function clientRow(party: Party, id: string, partyId: string | null) {
  return {
    id, party_id: partyId, type: party.personType, name: party.name.trim(), corporate_name: party.name.trim(), trade_name: party.tradeName.trim(), document: formatDocument(party.document),
    state_registration: party.stateRegistration.trim(), municipal_registration: party.municipalRegistration.trim(), icms_indicator: party.icmsIndicator || "9", responsible_name: party.contactName.trim(),
    contact_role: party.contactRole.trim(), phone: party.phone.trim(), email: party.email.trim(), zip_code: party.zipCode.trim(), street: party.street.trim(), number: party.number.trim(),
    complement: party.complement.trim(), district: party.district.trim(), city: party.city.trim(), state: party.state.trim().toUpperCase(), salesperson_id: party.salespersonId || null,
    credit_limit: Number(party.creditLimit) || 0, payment_condition_id: party.paymentConditionId || null, commercial_notes: party.commercialNotes.trim(),
    status: party.status,
  }
}

function supplierRow(party: Party, id: string, partyId: string | null) {
  return {
    id, party_id: partyId, person_type: party.personType, name: party.name.trim(), trade_name: party.tradeName.trim(), document: formatDocument(party.document),
    state_registration: party.stateRegistration.trim(), municipal_registration: party.municipalRegistration.trim(), icms_indicator: party.icmsIndicator || "1", contact_name: party.contactName.trim(),
    contact_role: party.contactRole.trim(), phone: party.phone.trim(), email: party.email.trim(), zip_code: party.zipCode.trim(), street: party.street.trim(), number: party.number.trim(),
    complement: party.complement.trim(), district: party.district.trim(), city: party.city.trim(), state: party.state.trim().toUpperCase(), payment_condition_id: party.paymentConditionId || null,
    commercial_notes: party.commercialNotes.trim(), status: party.status === "Inativo" ? "Inativo" : "Ativo",
  }
}

/** Valida, impede duplicidade de CPF/CNPJ e grava cliente e/ou fornecedor conforme o tipo. */
export async function saveParty(admin: Admin, input: Party & { clientId?: string; supplierId?: string; partyId?: string }) {
  const party: Party = { ...input, document: input.document || "" }
  const invalid = validateParty(party)
  if (invalid) fail(invalid)
  const document = cleanDocument(party.document)
  const wantsClient = party.kind !== "fornecedor"
  const wantsSupplier = party.kind !== "cliente"
  const own = new Set([input.clientId, input.supplierId].filter(Boolean) as string[])

  if (document) {
    const [clients, suppliers] = await Promise.all([
      readAllPages<any>((from, to) => admin.from("clients").select("id,name,document,party_id").neq("document", "").order("id").range(from, to)),
      readAllPages<any>((from, to) => admin.from("suppliers").select("id,name,document,party_id").neq("document", "").order("id").range(from, to)),
    ])
    const clash = [...clients.map((row) => ({ ...row, as: "cliente" })), ...suppliers.map((row) => ({ ...row, as: "fornecedor" }))]
      .find((row) => !own.has(row.id) && sameDocument(row.document, document) && !(input.partyId && row.party_id === input.partyId))
    if (clash) fail(`${formatDocument(document)} já está cadastrado como ${clash.as}: ${clash.name}. Edite esse cadastro (e marque "cliente e fornecedor", se for o caso) em vez de cadastrar de novo.`)
  }

  let partyId: string | null = input.partyId || null
  if (wantsClient && wantsSupplier && !partyId) partyId = randomUUID()
  const clientId = input.clientId || randomUUID()
  const supplierId = input.supplierId || randomUUID()

  if (wantsClient) {
    const { error } = await admin.from("clients").upsert(clientRow(party, clientId, partyId), { onConflict: "id" })
    if (error) throw error
  }
  if (wantsSupplier) {
    const { error } = await admin.from("suppliers").upsert(supplierRow(party, supplierId, partyId), { onConflict: "id" })
    if (error) throw error
  }
  // lado que deixou de valer fica inativo (pode ter histórico: pedidos, OS, contas)
  if (!wantsClient && input.clientId) await admin.from("clients").update({ status: "Inativo" }).eq("id", input.clientId)
  if (!wantsSupplier && input.supplierId) await admin.from("suppliers").update({ status: "Inativo" }).eq("id", input.supplierId)
  const savedId = wantsClient ? clientId : supplierId
  return (await listParties(admin)).find((row) => row.id === savedId)
}

export async function partyHistory(admin: Admin, clientId: string, supplierId: string) {
  const out: Record<string, any> = { opportunities: [], orders: [], receivables: [], purchases: [], openReceivables: 0 }
  if (clientId) {
    const [opportunities, orders, receivables] = await Promise.all([
      admin.from("opportunities").select("id,code,title,stage,estimated_value,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(50),
      admin.from("service_orders").select("id,order_number,status,order_kind,total_amount,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(50),
      admin.from("accounts_receivable").select("id,description,due_date,expected_amount,received_amount,status").eq("client_id", clientId).order("due_date", { ascending: false }).limit(100),
    ])
    out.opportunities = (opportunities.data || []).map((row) => ({ id: row.id, code: row.code, title: row.title, stage: row.stage, value: Number(row.estimated_value || 0), date: row.created_at }))
    out.orders = (orders.data || []).map((row) => ({ id: row.id, number: row.order_number, status: row.status, kind: row.order_kind || "", total: Number(row.total_amount || 0), date: row.created_at }))
    out.receivables = (receivables.data || []).map((row) => ({ id: row.id, description: row.description, dueDate: row.due_date, amount: Number(row.expected_amount || 0), received: Number(row.received_amount || 0), status: row.status }))
    out.openReceivables = Math.round((receivables.data || []).filter((row) => !["Recebida", "Cancelada"].includes(row.status)).reduce((sum, row) => sum + Math.max(Number(row.expected_amount || 0) - Number(row.received_amount || 0), 0), 0) * 100) / 100
  }
  if (supplierId) {
    const { data } = await admin.from("purchase_orders").select("id,order_number,status,total_amount,order_date").eq("supplier_id", supplierId).order("order_date", { ascending: false }).limit(50)
    out.purchases = (data || []).map((row) => ({ id: row.id, number: row.order_number, status: row.status, total: Number(row.total_amount || 0), date: row.order_date }))
  }
  return out
}

// ---------------- Vendedores

export async function listSalespeople(admin: Admin) {
  const { data, error } = await admin.from("salespeople").select("*").order("name")
  if (error) throw error
  return (data || []).map((row) => ({ id: row.id, name: row.name, email: row.email || "", phone: row.phone || "", status: row.status, notes: row.notes || "" }))
}

export async function saveSalesperson(admin: Admin, input: Record<string, any>) {
  if (!text(input.name)) fail("Informe o nome do vendedor.")
  if (text(input.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(input.email))) fail("E-mail inválido.")
  const row = { ...(input.id ? { id: input.id } : {}), name: text(input.name), email: text(input.email) || null, phone: text(input.phone) || null, status: input.status === "Inativo" ? "Inativo" : "Ativo", notes: text(input.notes) || null }
  const { data, error } = await admin.from("salespeople").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  return { id: data.id, name: data.name, email: data.email || "", phone: data.phone || "", status: data.status, notes: data.notes || "" }
}

// ---------------- Oportunidades

export type OpportunityItem = { id: string; productId: string; description: string; unit: string; quantity: number; unitPrice: number; total: number }
const toItem = (row: any): OpportunityItem => ({ id: row.id, productId: row.product_id || "", description: row.description, unit: row.unit || "UN", quantity: Number(row.quantity || 0), unitPrice: Number(row.unit_price || 0), total: Math.round(Number(row.quantity || 0) * Number(row.unit_price || 0) * 100) / 100 })

const toOpportunity = (row: any, clients: Map<string, any>, salespeople: Map<string, string>, items: OpportunityItem[] = []) => ({
  id: row.id, code: row.code, title: row.title, clientId: row.client_id, clientName: clients.get(row.client_id)?.name || "-", clientStatus: clients.get(row.client_id)?.status || "",
  salespersonId: row.salesperson_id, salespersonName: salespeople.get(row.salesperson_id) || "-", origin: row.origin || "", interest: row.interest, materialId: row.material_id || "",
  estimatedValue: Number(row.estimated_value || 0), stage: row.stage as FunnelStage, probability: Number(row.probability || 0), expectedCloseDate: row.expected_close_date || "",
  nextContactDate: row.next_contact_date || "", lossReason: row.loss_reason || "", quoteId: row.quote_id || "", quoteNumber: row.quote_number || "", closedAt: row.closed_at || "",
  createdAt: row.created_at, updatedAt: row.updated_at, items,
})

/** Produtos de cada oportunidade. Sem a tabela (script 233 ainda não rodado) segue sem itens. */
async function loadItems(admin: Admin, ids: string[]) {
  const map = new Map<string, OpportunityItem[]>()
  if (!ids.length) return map
  for (let at = 0; at < ids.length; at += 100) {
    const { data, error } = await admin.from("opportunity_items").select("*").in("opportunity_id", ids.slice(at, at + 100)).order("position").order("created_at")
    if (error) return map
    for (const row of data || []) map.set(row.opportunity_id, [...(map.get(row.opportunity_id) || []), toItem(row)])
  }
  return map
}

async function lookups(admin: Admin) {
  const [clients, people] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("clients").select("id,name,status").order("id").range(from, to)),
    admin.from("salespeople").select("id,name"),
  ])
  return { clients: new Map<string, any>(clients.map((row) => [row.id as string, row])), salespeople: new Map<string, string>((people.data || []).map((row) => [row.id as string, row.name as string])) }
}

export async function listOpportunities(admin: Admin) {
  const [rows, lookup] = await Promise.all([
    readAllPages<any>((from, to) => admin.from("opportunities").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
    lookups(admin),
  ])
  const items = await loadItems(admin, rows.map((row) => row.id as string))
  return rows.map((row) => toOpportunity(row, lookup.clients, lookup.salespeople, items.get(row.id as string) || []))
}

export async function listInteractions(admin: Admin, opportunityId: string) {
  const { data, error } = await admin.from("opportunity_interactions").select("*").eq("opportunity_id", opportunityId).order("interaction_at", { ascending: false })
  if (error) throw error
  const orders = await admin.from("service_orders").select("id,order_number,status").eq("opportunity_id", opportunityId)
  return {
    interactions: (data || []).map((row) => ({ id: row.id, kind: row.kind, description: row.description, at: row.interaction_at, automatic: row.automatic, author: row.author || "" })),
    orders: (orders.data || []).map((row) => ({ id: row.id, number: row.order_number, status: row.status })),
  }
}

async function logInteraction(admin: Admin, opportunityId: string, kind: string, description: string, author: string, automatic = true, at?: string) {
  await admin.from("opportunity_interactions").insert({ opportunity_id: opportunityId, kind, description, automatic, author, ...(at ? { interaction_at: at } : {}) })
}

/** Venda feita: o lead vira cliente sozinho, sem exigir cadastro completo (o que faltar fica para completar depois). */
async function convertLead(admin: Admin, clientId: string) {
  if (!clientId) return
  await admin.from("clients").update({ status: "Ativo" }).eq("id", clientId).eq("status", "Prospect")
}

export async function saveOpportunity(admin: Admin, input: Record<string, any>, responsible: string, role?: string) {
  const data = {
    title: text(input.title), clientId: text(input.clientId), salespersonId: text(input.salespersonId), interest: text(input.interest), estimatedValue: Number(input.estimatedValue) || 0,
    stage: text(input.stage) || "Novo lead", probability: input.probability === "" || input.probability == null ? NaN : Number(input.probability), expectedCloseDate: text(input.expectedCloseDate),
    nextContactDate: text(input.nextContactDate), lossReason: text(input.lossReason),
  }
  if (Number.isNaN(data.probability)) data.probability = stageProbability[data.stage as FunnelStage] ?? 10
  // produtos escolhidos do catálogo: o valor estimado é a soma (quantidade x preço) e o interesse vem dos nomes
  const items = (Array.isArray(input.items) ? input.items : []).map((item: any, index: number) => ({
    productId: text(item.productId), description: text(item.description), unit: text(item.unit) || "UN", quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), position: index,
  }))
  if (items.some((item) => !item.description)) fail("Todos os produtos precisam de descrição.")
  if (items.some((item) => !(item.quantity > 0))) fail("A quantidade de cada produto deve ser maior que zero.")
  if (items.some((item) => !(item.unitPrice >= 0))) fail("O preço de cada produto não pode ser negativo.")
  if (items.length) {
    data.estimatedValue = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100
    data.interest = items.map((item) => (item.quantity !== 1 ? `${item.quantity}x ${item.description}` : item.description)).join("; ").slice(0, 300)
  }
  const invalid = validateOpportunity(data)
  if (invalid) fail(invalid)
  let previous: any = null
  if (input.id) {
    const { data: current, error } = await admin.from("opportunities").select("*").eq("id", input.id).maybeSingle()
    if (error) throw error
    if (!current) fail("Oportunidade não encontrada.")
    previous = current
    if (previous.stage === "Ganho") fail("Negociação ganha não pode ser alterada.")
    if (previous.stage !== data.stage) {
      const message = validateStageChange(previous.stage, data.stage, { lossReason: data.lossReason, estimatedValue: data.estimatedValue, reopenReason: text(input.reopenReason) })
      if (message) fail(message)
    }
  }
  if (data.stage === "Ganho") await convertLead(admin, data.clientId)
  // GANHAR gera o pedido de venda: usa o orçamento da oportunidade (aprova e converte, se preciso). Sem orçamento não há o que vender.
  let salesOrder: { id: string; number: string; duplicate: boolean } | null = null
  if (data.stage === "Ganho" && previous?.stage !== "Ganho") {
    let quoteRow: any = null
    if (input.quoteId || previous?.quote_id) quoteRow = (await admin.from("quotes").select("id,status,quote_number").eq("id", input.quoteId || previous.quote_id).maybeSingle()).data
    if (!quoteRow && previous?.id) {
      const found = await admin.from("quotes").select("id,status,quote_number").eq("opportunity_id", previous.id).not("status", "in", "(Cancelado,Recusado)").order("created_at", { ascending: false }).limit(1)
      quoteRow = found.data?.[0] || null
    }
    if (!quoteRow) fail("Para ganhar a negociação é preciso um orçamento: use \"Gerar orçamento\" nesta oportunidade e depois marque como ganha.")
    const { convertQuoteToSalesOrder } = await import("@/lib/quotes-server")
    const converted = await convertQuoteToSalesOrder(admin, quoteRow.id, responsible, { approveFirst: true, role })
    salesOrder = converted.salesOrder
    input = { ...input, quoteId: quoteRow.id, quoteNumber: quoteRow.quote_number }
  }
  const closing = data.stage === "Ganho" || data.stage === "Perdido"
  const row = {
    ...(input.id ? { id: input.id } : { created_by: responsible }),
    title: data.title, client_id: data.clientId, salesperson_id: data.salespersonId, origin: text(input.origin) || null, interest: data.interest, material_id: items[0]?.productId || input.materialId || null,
    estimated_value: data.estimatedValue, stage: data.stage, probability: closing ? stageProbability[data.stage as FunnelStage] : Math.round(data.probability),
    expected_close_date: data.expectedCloseDate || null, next_contact_date: closing ? null : data.nextContactDate || null, loss_reason: data.stage === "Perdido" ? data.lossReason : null,
    quote_id: input.quoteId || null, quote_number: text(input.quoteNumber) || null, closed_at: closing ? previous?.closed_at || new Date().toISOString() : null,
  }
  const { data: saved, error } = await admin.from("opportunities").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  if (Array.isArray(input.items)) {
    // troca a lista de produtos da oportunidade pela enviada
    const removed = await admin.from("opportunity_items").delete().eq("opportunity_id", saved.id)
    if (removed.error) fail(isMissing(removed.error.message) ? "Os produtos da oportunidade ainda não estão liberados no banco: rode scripts/233_oportunidade_produtos.sql no Supabase." : removed.error.message)
    if (items.length) {
      const inserted = await admin.from("opportunity_items").insert(items.map((item) => ({ opportunity_id: saved.id, product_id: item.productId || null, description: item.description, unit: item.unit, quantity: item.quantity, unit_price: item.unitPrice, position: item.position })))
      if (inserted.error) throw inserted.error
    }
  }
  if (!previous) await logInteraction(admin, saved.id, "Etapa", `Oportunidade criada na etapa ${saved.stage}.`, responsible)
  else if (previous.stage !== saved.stage) await logInteraction(admin, saved.id, "Etapa", `Etapa alterada de ${previous.stage} para ${saved.stage}.${saved.stage === "Perdido" ? ` Motivo: ${data.lossReason}.` : ""}${previous.stage === "Perdido" ? ` Reaberta: ${text(input.reopenReason)}.` : ""}`, responsible)
  if (previous && !previous.quote_number && saved.quote_number) await logInteraction(admin, saved.id, "Orçamento", `Orçamento ${saved.quote_number} associado.`, responsible)
  const lookup = await lookups(admin)
  const savedItems = (await loadItems(admin, [saved.id as string])).get(saved.id as string) || []
  return { ...toOpportunity(saved, lookup.clients, lookup.salespeople, savedItems), salesOrder }
}

export async function addInteraction(admin: Admin, opportunityId: string, input: Record<string, any>, responsible: string) {
  if (!text(input.description)) fail("Descreva a interação.")
  const { data: opportunity } = await admin.from("opportunities").select("id,stage").eq("id", opportunityId).maybeSingle()
  if (!opportunity) fail("Oportunidade não encontrada.")
  await logInteraction(admin, opportunityId, text(input.kind) || "Observação", text(input.description), responsible, false, input.at || undefined)
  if (text(input.nextContactDate) && !["Ganho", "Perdido"].includes(opportunity!.stage)) await admin.from("opportunities").update({ next_contact_date: text(input.nextContactDate) }).eq("id", opportunityId)
}
