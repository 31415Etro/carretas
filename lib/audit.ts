// Trilha de auditoria (lado servidor). Os eventos de dados (criação/edição/exclusão) são gravados por
// triggers do banco (scripts/213_auditoria.sql); aqui ficam os eventos de aplicação: login, acesso
// negado, exportações, acesso administrativo e ações de integrações. Nunca registre senhas, tokens
// nem dados sigilosos nas descrições ou nos valores.

import { headers } from "next/headers"
import { redact } from "@/lib/audit-redact"
import { createAdminClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"

export type AuditOrigin = "Usuário" | "API" | "Integração" | "Agendador" | "Sistema"
export type AuditResult = "Sucesso" | "Falha" | "Negado"

export type AuditInput = {
  module: string
  action: string
  description: string
  recordId?: string
  tableName?: string
  oldValues?: unknown
  newValues?: unknown
  result?: AuditResult
  reason?: string
  origin?: AuditOrigin
  actorId?: string
  actorEmail?: string
  companyId?: string | null
}

/** Contexto da requisição (preenchido pelo middleware): usuário, IP, sessão e identificador da requisição. */
export async function auditContext() {
  try {
    const list = await headers()
    return { actorId: list.get("x-audit-actor-id") || "", actorEmail: list.get("x-audit-actor-email") || "", ip: list.get("x-audit-ip") || "", session: list.get("x-audit-session") || "", request: list.get("x-audit-request") || "", origin: (list.get("x-audit-origin") || "Sistema") as AuditOrigin }
  } catch {
    return { actorId: "", actorEmail: "", ip: "", session: "", request: "", origin: "Agendador" as AuditOrigin }
  }
}

/** Grava um evento de aplicação. Nunca lança erro: falha de auditoria não derruba a operação. */
export async function audit(input: AuditInput) {
  try {
    const context = await auditContext()
    const companyId = input.companyId === undefined ? await getSelectedSystemCompanyId() : input.companyId
    const { error } = await createAdminClient({ bypassCompanyScope: true }).from("audit_events").insert({
      system_company_id: companyId || null, actor_id: input.actorId || context.actorId || null, actor_email: input.actorEmail || context.actorEmail || null, module: input.module, action: input.action,
      table_name: input.tableName || null, record_id: input.recordId || null, description: input.description.slice(0, 300), old_values: input.oldValues === undefined ? null : redact(input.oldValues), new_values: input.newValues === undefined ? null : redact(input.newValues),
      ip_address: context.ip || null, session_id: context.session || null, request_id: context.request || null, result: input.result || "Sucesso", reason: input.reason ? input.reason.slice(0, 500) : null, origin: input.origin || context.origin,
    })
    if (error) console.error("[audit]", error.message)
  } catch (error) {
    console.error("[audit]", error instanceof Error ? error.message : error)
  }
}

/** Envolve um handler de rota e registra o resultado (HTTP 2xx/3xx = sucesso; 401/403 = negado; demais = falha). */
export function auditRoute<A extends unknown[]>(meta: { module: string; action: string; origin?: AuditOrigin }, handler: (request: Request, ...rest: A) => Promise<Response>) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    let status = 500
    let failure = ""
    try {
      const response = await handler(request, ...rest)
      status = response.status
      return response
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 160) : "erro"
      throw error
    } finally {
      await audit({
        module: meta.module, action: meta.action, origin: meta.origin,
        description: `${meta.action} — ${request.method} ${new URL(request.url).pathname} → HTTP ${status}${failure ? ` (${failure})` : ""}`,
        result: status >= 200 && status < 400 ? "Sucesso" : status === 401 || status === 403 ? "Negado" : "Falha",
      })
    }
  }
}
