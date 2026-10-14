import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { cleanDocument, formatDocument } from "@/lib/commercial"
import { columnOf, fieldsFor, validateRegistry, type Entity } from "@/lib/registry"
import { readAllPages } from "@/lib/supabase-pagination"

type Admin = ReturnType<typeof createAdminClient>
type Row = Record<string, any>

export const REGISTRY_MIGRATION_HINT = "Cadastro de clientes e fornecedores ainda não atualizado no banco. Rode scripts/215_clientes_fornecedores.sql no SQL Editor do Supabase."
const table = (entity: Entity) => (entity === "client" ? "clients" : "suppliers")
const fail = (message: string): never => { throw new Error(message) }

export function registryError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (/does not exist|Could not find|schema cache/i.test(message)) return { message: REGISTRY_MIGRATION_HINT, status: 503 }
  if (/duplicate key/.test(message)) return { message: "Já existe um cadastro com este CPF/CNPJ.", status: 400 }
  return { message, status: 400 }
}

const numeric = new Set(["creditLimit", "defaultDiscount", "minOrder", "deliveryDays", "rating"])
const dates = new Set(["cnpjStatusDate", "openedAt"])
const sameDocument = (a?: string, b?: string) => Boolean(cleanDocument(a)) && cleanDocument(a) === cleanDocument(b)

/** Linha do banco → objeto do formulário (todos os valores como texto, exceto os extras). */
export function fromRow(entity: Entity, row: Row) {
  const out: Row = { id: row.id, partyId: row.party_id || "", createdAt: row.created_at, updatedAt: row.updated_at, cnpjSource: row.cnpj_source || "", cnpjConsultedAt: row.cnpj_consulted_at || "", createdBy: row.created_by || "", partners: Array.isArray(row.cnpj_partners) ? row.cnpj_partners : [] }
  for (const field of fieldsFor(entity)) {
    const value = row[columnOf(field, entity)]
    out[field.key] = value === null || value === undefined ? "" : numeric.has(field.key) ? (Number(value) ? String(value) : "") : String(value)
  }
  out.name = row.name || ""
  out.personType = (entity === "client" ? row.type : row.person_type) === "PF" ? "PF" : "PJ"
  out.icmsIndicator = row.icms_indicator || "9"
  out.country = row.country || "Brasil"
  return out
}

/** Objeto do formulário → linha do banco. Texto vazio vira null (datas e números nunca vão como ""). */
function toRow(entity: Entity, input: Row) {
  const row: Row = {}
  for (const field of fieldsFor(entity)) {
    if (field.key === "code") continue
    const raw = input[field.key]
    const value = typeof raw === "string" ? raw.trim() : raw
    const column = columnOf(field, entity)
    if (numeric.has(field.key)) row[column] = value === "" || value === undefined || value === null ? (field.key === "deliveryDays" || field.key === "rating" ? null : 0) : Number(value)
    else if (dates.has(field.key)) row[column] = value ? String(value).slice(0, 10) : null
    else row[column] = value === undefined || value === "" ? (["country"].includes(field.key) ? "Brasil" : null) : value
  }
  row.name = String(input.name || "").trim()
  if (entity === "client") row.corporate_name = row.name
  row.document = input.document ? formatDocument(String(input.document)) : ""
  row.state = row.state ? String(row.state).toUpperCase() : null
  if (entity === "client") row.icms_indicator = input.icmsIndicator || "9"
  else row.icms_indicator = "1"
  row.cnpj_source = input.cnpjSource || null
  row.cnpj_consulted_at = input.cnpjConsultedAt || null
  row.cnpj_partners = Array.isArray(input.partners) && input.partners.length ? input.partners : null
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key]
  return row
}

export async function listRegistry(admin: Admin, entity: Entity) {
  const rows = await readAllPages<Row>((from, to) => admin.from(table(entity)).select("*").order("name").order("id").range(from, to))
  return rows.map((row) => fromRow(entity, row))
}

/** Onde o documento já existe (cliente e/ou fornecedor), para evitar duplicidade e permitir vincular. */
export async function findByDocument(admin: Admin, document: string) {
  const clean = cleanDocument(document)
  if (!clean) return { client: null, supplier: null }
  const keys = Array.from(new Set([clean, formatDocument(clean)]))
  const [clients, suppliers] = await Promise.all([
    admin.from("clients").select("id,code,name,document,status,party_id").in("document", keys).limit(5),
    admin.from("suppliers").select("id,code,name,document,status,party_id").in("document", keys).limit(5),
  ])
  if (clients.error) throw clients.error
  if (suppliers.error) throw suppliers.error
  const pick = (row?: Row) => row ? { id: row.id, code: row.code || "", name: row.name, document: row.document, status: row.status, partyId: row.party_id || "" } : null
  return { client: pick(clients.data?.[0]), supplier: pick(suppliers.data?.[0]) }
}

/**
 * Salva um cliente ou fornecedor. `linkFromId` é o cadastro do outro lado com o mesmo CPF/CNPJ que o usuário
 * escolheu vincular: os dois passam a compartilhar o party_id (mesma empresa, sem duplicar).
 */
export async function saveRegistry(admin: Admin, entity: Entity, input: Row, responsible: string, linkFromId = "", relaxed = false) {
  const invalid = validateRegistry(entity, input, relaxed)
  if (invalid) fail(invalid)
  const found = await findByDocument(admin, input.document || "")
  const own = entity === "client" ? found.client : found.supplier
  const other = entity === "client" ? found.supplier : found.client
  if (own && own.id !== input.id) fail(`${formatDocument(input.document)} já está cadastrado como ${entity === "client" ? "cliente" : "fornecedor"}: ${own.name}. Abra esse cadastro para editar.`)
  let partyId: string | null = input.partyId || null
  if (other && !(partyId && other.partyId === partyId)) {
    if (other.id !== linkFromId) fail(`${formatDocument(input.document)} já está cadastrado como ${entity === "client" ? "fornecedor" : "cliente"}: ${other.name}. Use "Vincular" para reaproveitar esse cadastro em vez de duplicar a empresa.`)
    partyId = other.partyId || partyId || randomUUID()
    const { error } = await admin.from(table(entity === "client" ? "supplier" : "client")).update({ party_id: partyId }).eq("id", other.id)
    if (error) throw error
  }
  const id = input.id || randomUUID()
  const row: Row = { ...toRow(entity, input), id, party_id: partyId }
  if (!input.id) row.created_by = responsible
  const { data, error } = await admin.from(table(entity)).upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  return fromRow(entity, data)
}

/** Inativar / reativar sem exigir que o cadastro antigo esteja completo. */
export async function setRegistryStatus(admin: Admin, entity: Entity, id: string, status: string) {
  if (!["Ativo", "Inativo"].includes(status)) fail("Status inválido.")
  const { data, error } = await admin.from(table(entity)).update({ status }).eq("id", id).select("*").single()
  if (error) throw error
  return fromRow(entity, data)
}
