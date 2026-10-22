import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { DOC_MIGRATION_HINT, isDocStructureMissing } from "@/lib/vehicle-documentation"
import { getProvider } from "@/lib/vehicle-documentation-provider"

type Admin = ReturnType<typeof createAdminClient>
export class DocError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}
export function docError(error: unknown, fallback = "Erro ao processar a documentação.") {
  if (error instanceof DocError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (isDocStructureMissing(message)) return new DocError(DOC_MIGRATION_HINT, 503)
  if (/não encontrad/i.test(message)) return new DocError(message, 404)
  if (/outra empresa/i.test(message)) return new DocError(message, 403)
  return new DocError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

// ---------------------------------------------------------------- Consultas
export async function listDocumentation(admin: Admin, filters: { q?: string; status?: string; orderId?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 100)
  const page = Math.max(Number(filters.page) || 1, 1)
  const rows = await rpc<Array<Record<string, any>>>(admin, "vehicle_doc_list", { p_search: filters.q || null, p_status: filters.status || null, p_order: filters.orderId || null, p_limit: pageSize, p_offset: (page - 1) * pageSize })
  return { items: rows, total: rows.length ? Number(rows[0].total_count) : 0, page, pageSize }
}
export const documentationDetail = (admin: Admin, id: string) => rpc<Record<string, any>>(admin, "vehicle_doc_detail", { p_doc: id })
export const documentationDashboard = (admin: Admin) => rpc<Record<string, any>>(admin, "vehicle_doc_dashboard")
export const documentationSummary = (admin: Admin, ids: { orderId?: string; opportunityId?: string }) => rpc<Record<string, any>>(admin, "vehicle_doc_summary", { p_sales_order_id: ids.orderId || null, p_opportunity_id: ids.opportunityId || null })
export const releaseOf = (admin: Admin, orderId: string) => rpc<Record<string, any>>(admin, "production_eligibility", { p_sales_order_id: orderId })
export const releaseMap = (admin: Admin) => rpc<Array<Record<string, any>>>(admin, "production_release_map")

// ---------------------------------------------------------------- Dados da unidade
export const updateDocumentation = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<Record<string, any>>(admin, "vehicle_doc_update", { p: input, p_user: user })
export const cancelDocumentation = (admin: Admin, id: string, reason: string, user: string) => rpc(admin, "vehicle_doc_cancel", { p_doc: id, p_reason: reason, p_user: user })
export const setFinalStage = (admin: Admin, id: string, stage: string, note: string, user: string) => rpc(admin, "vehicle_doc_set_final_stage", { p_doc: id, p_stage: stage, p_note: note || null, p_user: user })
export const addDocumentationFile = (admin: Admin, id: string, file: { kind?: string; name: string; path: string }, user: string) => rpc(admin, "vehicle_doc_add_file", { p_doc: id, p_kind: file.kind || "Comprovante", p_name: file.name, p_path: file.path, p_user: user })

// ---------------------------------------------------------------- Envio
/** Envio pelo canal automático (simulador/lote). A chave de idempotência vem da tela (uma por clique); repetir devolve a mesma tentativa. */
export async function submitDocumentation(admin: Admin, id: string, user: string, key?: string) {
  const detail = await documentationDetail(admin, id)
  const channel = String(detail.documentation.channel)
  const provider = getProvider(channel)
  const begin = await rpc<Record<string, any>>(admin, "vehicle_doc_begin_submit", { p_doc: id, p_key: key || randomUUID(), p_user: user })
  if (begin.duplicate) return { duplicate: true, ...begin }
  const submitAttempts = (detail.attempts as Array<Record<string, any>>).filter((attempt) => ["envio", "reenvio"].includes(attempt.kind)).length + 1
  let outcome: Record<string, any>
  try {
    outcome = await provider.submit(begin.payload, { idempotencyKey: String(begin.attempt_id), submitAttempts })
  } catch (error) {
    outcome = { outcome: "indisponivel", message: error instanceof Error ? error.message : "Serviço externo indisponível." }
  }
  const finished = await rpc<Record<string, any>>(admin, "vehicle_doc_finish_submit", { p_attempt: begin.attempt_id, p: outcome, p_user: user })
  return { duplicate: false, ...finished }
}

/** Canal manual: a pessoa fez o pré-cadastro no portal e informa o protocolo recebido. */
export async function registerManualSubmission(admin: Admin, id: string, input: { protocol: string; key?: string; message?: string }, user: string) {
  const protocol = String(input.protocol || "").trim()
  if (!protocol) throw new DocError("Informe o protocolo devolvido pelo portal.")
  const begin = await rpc<Record<string, any>>(admin, "vehicle_doc_begin_submit", { p_doc: id, p_key: input.key || randomUUID(), p_user: user })
  if (begin.duplicate) return { duplicate: true, ...begin }
  const finished = await rpc<Record<string, any>>(admin, "vehicle_doc_finish_submit", { p_attempt: begin.attempt_id, p: { outcome: "sucesso", protocol, message: input.message || "Pré-cadastro feito manualmente no portal.", response: { manual: true } }, p_user: user })
  return { duplicate: false, ...finished }
}

/** Retorno informado por uma pessoa (aprovação, exigência ou rejeição). Quem chama precisa ser administrador ou gerente (checado na rota). */
export const registerManualResult = (admin: Admin, id: string, input: { result: string; message?: string; pendencies?: string[]; key?: string }, user: string) =>
  rpc<Record<string, any>>(admin, "vehicle_doc_apply_result", { p_doc: id, p: { result: input.result, message: input.message || null, pendencies: input.pendencies?.length ? input.pendencies : undefined, kind: "retorno_manual", result_key: input.key || randomUUID(), response: { manual: true } }, p_user: user })

// ---------------------------------------------------------------- Consulta e monitoramento
/** Consulta o andamento de UMA unidade no canal (quando o canal consulta). Resultado repetido é ignorado pela chave. */
export async function consultDocumentation(admin: Admin, id: string, user: string) {
  const detail = await documentationDetail(admin, id)
  const doc = detail.documentation
  if (!doc.protocol) throw new DocError("A unidade ainda não tem protocolo para consultar.")
  const provider = getProvider(String(doc.channel))
  const consults = (detail.attempts as Array<Record<string, any>>).filter((attempt) => attempt.kind === "consulta" && attempt.outcome !== "ignorado").length
  const answer = await provider.consult(String(doc.protocol), { vin: String(doc.vin || ""), consults })
  if ("unavailable" in answer) {
    await rpc(admin, "vehicle_doc_mark_checked", { p_doc: id, p_minutes: 720, p_message: answer.unavailable })
    return { checked: false, message: answer.unavailable }
  }
  const day = new Date().toISOString().slice(0, 10)
  const key = answer.result === "processando" ? `auto:${doc.protocol}:processando:${day}` : `auto:${doc.protocol}:${answer.result}`
  const applied = await rpc<Record<string, any>>(admin, "vehicle_doc_apply_result", { p_doc: id, p: { result: answer.result, message: answer.message, pendencies: answer.pendencies, kind: "consulta", result_key: key, response: answer.response }, p_user: user })
  return { checked: true, result: answer.result, ...applied }
}

/**
 * Serviço de acompanhamento (roda no backend, pelo agendador e sem depender de ninguém com a página aberta): consulta os protocolos vencidos,
 * atualiza as unidades e devolve o que mudou e o que está parado há muito tempo. Falha de um protocolo não interrompe os outros.
 */
export async function runDocumentationMonitor(admin: Admin) {
  const queue = await rpc<Array<Record<string, any>>>(admin, "vehicle_doc_pending_checks", { p_limit: 100 })
  const changes: Array<Record<string, any>> = []
  const errors: Array<Record<string, any>> = []
  for (const item of queue) {
    try {
      const outcome = await consultDocumentation(admin, item.id, "monitoramento automático")
      if (outcome.checked && (outcome as Record<string, any>).status && (outcome as Record<string, any>).status !== item.status) changes.push({ id: item.id, protocol: item.protocol, from: item.status, to: (outcome as Record<string, any>).status })
    } catch (error) {
      errors.push({ id: item.id, protocol: item.protocol, error: error instanceof Error ? error.message : "falha" })
      await rpc(admin, "vehicle_doc_mark_checked", { p_doc: item.id, p_minutes: 120, p_message: error instanceof Error ? error.message.slice(0, 200) : "falha na consulta" }).catch(() => null)
    }
  }
  const dashboard = await documentationDashboard(admin)
  const attention = await listDocumentation(admin, { status: "atencao", pageSize: 100 })
  return { checked: queue.length, changes, errors, stale: Number(dashboard.stale || 0), needs_attention: attention.total, dashboard }
}

// ---------------------------------------------------------------- Liberação da produção e regras da empresa
export const authorizeProduction = (admin: Admin, orderId: string, user: string, note?: string) => rpc<Record<string, any>>(admin, "production_authorize", { p_sales_order_id: orderId, p_user: user, p_note: note || null })
export const revokeAuthorization = (admin: Admin, orderId: string, reason: string, user: string) => rpc<Record<string, any>>(admin, "production_revoke_authorization", { p_sales_order_id: orderId, p_reason: reason, p_user: user })
export const releaseException = (admin: Admin, orderId: string, reason: string, user: string) => rpc<Record<string, any>>(admin, "production_release_exception", { p_sales_order_id: orderId, p_component: "pagamento", p_reason: reason, p_user: user })
export const generateDocumentation = (admin: Admin, orderId: string, user: string) => rpc<number>(admin, "vehicle_documentation_generate", { p_sales_order_id: orderId, p_user: user })
export const salesSettingsGet = (admin: Admin) => rpc<Record<string, any>>(admin, "sales_settings_get")
export const salesSettingsUpdate = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<Record<string, any>>(admin, "sales_settings_update", { p: input, p_user: user })
