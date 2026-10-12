import { audit } from "@/lib/audit"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"

type Admin = ReturnType<typeof createAdminClient>

export const AUDIT_MIGRATION_HINT = "Auditoria ainda não instalada no banco. Rode scripts/213_auditoria.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const text = (value: unknown) => String(value ?? "").trim()

export function auditError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: AUDIT_MIGRATION_HINT, status: 503 }
  return { message, status: 400 }
}

/** Auditoria é exclusiva de administradores; o acesso (ou a tentativa) também é auditado. */
export async function auditAdmin() {
  const { user, role } = await currentUserRole()
  if (!user) return { error: "Nao autenticado.", status: 401 } as const
  if (role !== "admin") {
    await audit({ module: "acesso", action: "Acesso negado", description: "Tentativa de acessar a trilha de auditoria sem ser administrador.", result: "Negado", actorId: user.id, actorEmail: user.email || "" })
    return { error: "Acesso exclusivo para administradores.", status: 403 } as const
  }
  return { user, admin: createAdminClient({ bypassCompanyScope: true }) } as const
}

export type AuditFilters = { start?: string; end?: string; module?: string; action?: string; actor?: string; result?: string; origin?: string; record?: string; q?: string; company?: string; before?: string; limit?: number }

const startOfDay = (date: string) => `${date}T00:00:00-03:00`
const endOfDay = (date: string) => `${date}T23:59:59.999-03:00`

async function nameMaps(admin: Admin) {
  const [profiles, companies] = await Promise.all([admin.from("profiles").select("id,full_name,email"), admin.from("system_companies").select("id,name,trade_name")])
  return {
    users: new Map<string, string>((profiles.data || []).map((row: any) => [row.id as string, (row.full_name || row.email) as string])),
    companies: new Map<string, string>((companies.data || []).map((row: any) => [row.id as string, (row.trade_name || row.name) as string])),
  }
}

function toEvent(row: any, maps: Awaited<ReturnType<typeof nameMaps>>) {
  return {
    id: row.id, seq: Number(row.seq), at: row.occurred_at, companyId: row.system_company_id || "", companyName: row.system_company_id ? maps.companies.get(row.system_company_id) || "-" : "—",
    actorId: row.actor_id || "", actorName: row.actor_id ? maps.users.get(row.actor_id) || row.actor_email || "-" : row.actor_email || "Sistema", actorEmail: row.actor_email || "", module: row.module, action: row.action,
    tableName: row.table_name || "", recordId: row.record_id || "", description: row.description, hasValues: Boolean(row.table_name), changedFields: row.changed_fields || [], ip: row.ip_address || "",
    sessionId: row.session_id || "", requestId: row.request_id || "", result: row.result, reason: row.reason || "", origin: row.origin,
  }
}

export async function searchEvents(admin: Admin, filters: AuditFilters) {
  const currentCompany = await getSelectedSystemCompanyId()
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  let query = admin.from("audit_events").select("id,seq,occurred_at,system_company_id,actor_id,actor_email,module,action,table_name,record_id,description,changed_fields,ip_address,session_id,request_id,result,reason,origin").order("seq", { ascending: false }).limit(limit + 1)
  if (filters.company !== "all") query = query.or(`system_company_id.eq.${filters.company && filters.company !== "current" ? filters.company : currentCompany},system_company_id.is.null`)
  if (filters.start) query = query.gte("occurred_at", startOfDay(filters.start))
  if (filters.end) query = query.lte("occurred_at", endOfDay(filters.end))
  if (filters.module) query = query.eq("module", filters.module)
  if (filters.action) query = query.eq("action", filters.action)
  if (filters.result) query = query.eq("result", filters.result)
  if (filters.origin) query = query.eq("origin", filters.origin)
  if (filters.actor) query = /^[0-9a-f-]{36}$/i.test(filters.actor) ? query.eq("actor_id", filters.actor) : query.ilike("actor_email", `%${filters.actor.replace(/[%,()]/g, "")}%`)
  if (filters.record) query = query.or(`record_id.eq.${filters.record.replace(/[,()]/g, "")},request_id.eq.${filters.record.replace(/[,()]/g, "")}`)
  if (filters.q) query = query.ilike("description", `%${filters.q.replace(/[%,()]/g, "")}%`)
  if (filters.before) query = query.lt("seq", Number(filters.before))
  const { data, error } = await query
  if (error) throw error
  const maps = await nameMaps(admin)
  const rows = data || []
  const page = rows.slice(0, limit)
  return { events: page.map((row) => toEvent(row, maps)), nextBefore: rows.length > limit ? String(page[page.length - 1].seq) : "" }
}

export async function getEventDetail(admin: Admin, id: string) {
  const { data, error } = await admin.from("audit_events").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Evento não encontrado.")
  const maps = await nameMaps(admin)
  return { ...toEvent(data, maps), oldValues: data.old_values, newValues: data.new_values, hash: data.hash, prevHash: data.prev_hash }
}

const csvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)
  return /[";\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

/** CSV do período filtrado (até 20.000 eventos). O próprio export é registrado na trilha. */
export async function exportEvents(admin: Admin, filters: AuditFilters, actor: { id: string; email: string }) {
  const rows: any[] = []
  let before = filters.before
  for (let page = 0; page < 40; page++) {
    const result = await searchEvents(admin, { ...filters, before, limit: 500 })
    const ids = result.events.map((event) => event.id)
    if (ids.length) {
      const { data } = await admin.from("audit_events").select("id,old_values,new_values").in("id", ids)
      const values = new Map<string, any>((data || []).map((row: any) => [row.id as string, row]))
      rows.push(...result.events.map((event) => ({ ...event, oldValues: values.get(event.id)?.old_values, newValues: values.get(event.id)?.new_values })))
    }
    if (!result.nextBefore) break
    before = result.nextBefore
  }
  const header = ["Evento", "Data/hora", "Empresa", "Usuário", "E-mail", "Módulo", "Ação", "Tabela", "Registro", "Descrição", "Valores anteriores", "Valores posteriores", "IP", "Sessão", "Requisição", "Resultado", "Motivo", "Origem"]
  const lines = [header.join(";"), ...rows.map((row) => [row.seq, new Date(row.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), row.companyName, row.actorName, row.actorEmail, row.module, row.action, row.tableName, row.recordId, row.description, row.oldValues, row.newValues, row.ip, row.sessionId, row.requestId, row.result, row.reason, row.origin].map(csvCell).join(";"))]
  await audit({ module: "auditoria", action: "Exportação de dados", description: `Exportou ${rows.length} evento(s) da trilha de auditoria (filtros: ${Object.entries(filters).filter(([key, value]) => value && !["before", "limit"].includes(key)).map(([key, value]) => `${key}=${value}`).join(", ") || "nenhum"}).`, actorId: actor.id, actorEmail: actor.email })
  return `﻿${lines.join("\r\n")}\r\n`
}

export async function verifyChain(admin: Admin) {
  const company = await getSelectedSystemCompanyId()
  const results = []
  for (const [label, id] of [["Empresa", company], ["Eventos sem empresa (login/acesso)", null]] as Array<[string, string | null]>) {
    const { data, error } = await admin.rpc("verify_audit_chain", { p_company: id })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    results.push({ scope: label, ok: Boolean(row?.ok), checked: Number(row?.checked || 0), brokenSeq: row?.broken_seq == null ? null : Number(row.broken_seq) })
  }
  return results
}

export async function getRetention(admin: Admin) {
  const company = await getSelectedSystemCompanyId()
  const { data } = await admin.from("audit_settings").select("retention_days").eq("system_company_id", company).maybeSingle()
  return { retentionDays: Number(data?.retention_days || 1825), companyId: company }
}

export async function setRetention(days: number, actor: string) {
  if (!Number.isInteger(days) || days < 365) throw new Error("A retenção mínima é de 365 dias.")
  if (days > 3650) throw new Error("A retenção máxima é de 3650 dias (10 anos).")
  const company = await getSelectedSystemCompanyId()
  const { error } = await createAdminClient().from("audit_settings").upsert({ system_company_id: company, retention_days: days, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: "system_company_id" })
  if (error) throw error
  return { retentionDays: days }
}

export async function summary(admin: Admin) {
  const currentCompany = await getSelectedSystemCompanyId()
  const since = new Date(Date.now() - 86400000).toISOString()
  const base = () => admin.from("audit_events").select("id", { count: "exact", head: true }).gte("occurred_at", since).or(`system_company_id.eq.${currentCompany},system_company_id.is.null`)
  const [events, denied, failed] = await Promise.all([base(), base().eq("result", "Negado"), base().eq("result", "Falha")])
  return { last24h: events.count || 0, denied24h: denied.count || 0, failed24h: failed.count || 0 }
}

export const sanitizeFilters = (params: URLSearchParams): AuditFilters => ({
  start: text(params.get("start")) || undefined, end: text(params.get("end")) || undefined, module: text(params.get("module")) || undefined, action: text(params.get("action")) || undefined, actor: text(params.get("actor")) || undefined,
  result: text(params.get("result")) || undefined, origin: text(params.get("origin")) || undefined, record: text(params.get("record")) || undefined, q: text(params.get("q")) || undefined, company: text(params.get("company")) || undefined,
  before: text(params.get("before")) || undefined, limit: Number(params.get("limit")) || undefined,
})
