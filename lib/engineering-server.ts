import type { createAdminClient } from "@/lib/supabase/server"
import { parseExpression } from "@/lib/expression"
import { FZ1E_PRESET } from "@/lib/engineering-presets"

type Admin = ReturnType<typeof createAdminClient>
export class EngError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}
export const ENG_MIGRATION_HINT = "A engenharia paramétrica ainda não está instalada no banco. Rode o script 225 no SQL Editor do Supabase (primeiro no staging)."
export function engError(error: unknown, fallback = "Erro ao processar a engenharia.") {
  if (error instanceof EngError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (/Could not find the function|does not exist|schema cache|eng_|product_configur/i.test(message) && /function|schema cache|relation/i.test(message)) return new EngError(ENG_MIGRATION_HINT, 503)
  if (/não encontrad/i.test(message)) return new EngError(message, 404)
  if (/outra empresa/i.test(message)) return new EngError(message, 403)
  return new EngError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}
const expr = (text: string, what: string) => {
  const parsed = parseExpression(text)
  if (!parsed.ok) throw new EngError(`${what}: ${parsed.error}`)
  return parsed
}

// ---------------------------------------------------------------- Cadastro técnico
export const overview = (admin: Admin, productId: string) => rpc<Record<string, any>>(admin, "eng_product_overview", { p_product: productId })
export const revisionSave = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<Record<string, any>>(admin, "eng_revision_save", { p: input, p_user: user })
export const revisionCopy = (admin: Admin, id: string, label: string | undefined, user: string) => rpc<string>(admin, "eng_revision_copy", { p_revision: id, p_label: label || null, p_user: user })
export const documentAdd = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<string>(admin, "eng_document_add", { p: input, p_user: user })
export const documentAttach = (admin: Admin, id: string, path: string) => rpc(admin, "eng_document_attach", { p_document: id, p_path: path })
export const parameterSave = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<string>(admin, "eng_parameter_save", { p: input, p_user: user })
export const optionSave = (admin: Admin, input: Record<string, unknown>) => rpc<string>(admin, "eng_option_save", { p: input })
export const templateSave = (admin: Admin, input: Record<string, unknown>) => rpc<string>(admin, "eng_template_save", { p: input })
export const ruleSave = (admin: Admin, input: Record<string, any>) => {
  const parsed = expr(String(input.expr_text || ""), "Condição da regra")
  return rpc<string>(admin, "eng_rule_save", { p: { ...input, expr: parsed.ast } })
}
export function formulaSave(admin: Admin, input: Record<string, any>, user: string) {
  const parsed = expr(String(input.expr_text || ""), "Fórmula")
  let cut = input.cut_rule
  if (cut && typeof cut === "object" && Array.isArray(cut.pieces)) {
    cut = { ...cut, pieces: cut.pieces.map((piece: Record<string, any>) => ({ label: piece.label, length: expr(String(piece.length_text || ""), `Medida da peça "${piece.label}"`).ast, count: expr(String(piece.count_text || "1"), `Quantidade da peça "${piece.label}"`).ast })) }
  } else cut = null
  return rpc<string>(admin, "eng_formula_save", { p: { ...input, expr: parsed.ast, cut_rule: cut }, p_user: user })
}
export const formulaApprove = (admin: Admin, id: string, user: string) => rpc(admin, "eng_formula_approve", { p_formula: id, p_user: user })
export const issueResolve = (admin: Admin, input: Record<string, unknown>, user: string) => rpc(admin, "eng_issue_resolve", { p: input, p_user: user })
export const revisionSubmit = (admin: Admin, id: string, user: string) => rpc<Record<string, any>>(admin, "eng_revision_submit", { p_revision: id, p_user: user })
export const revisionBackToDraft = (admin: Admin, id: string) => rpc(admin, "eng_revision_back_to_draft", { p_revision: id })
export const revisionValidate = (admin: Admin, id: string, user: string) => rpc<Record<string, any>>(admin, "eng_revision_validate", { p_revision: id, p_user: user })
export const detectIssues = (admin: Admin, id: string, user: string) => rpc<number>(admin, "eng_revision_detect_issues", { p_revision: id, p_user: user })

/** Carrega o modelo piloto FZ 1E num produto: revisão em rascunho com os documentos e as fontes de cada limite; os conflitos viram pendências. */
export async function applyFz1ePreset(admin: Admin, productId: string, user: string) {
  const existing = await overview(admin, productId)
  if ((existing.revisions as Array<Record<string, any>>).some((revision) => revision.revision === FZ1E_PRESET.revision.revision)) throw new EngError("Este produto já tem a revisão R1: carregue o modelo piloto só em produto sem engenharia.")
  const revision = await revisionSave(admin, { product_id: productId, ...FZ1E_PRESET.revision }, user)
  const ids: Record<string, string> = {}
  for (const document of FZ1E_PRESET.documents) ids[document.key] = await documentAdd(admin, { revision_id: revision.id, kind: document.kind, name: document.name, document_number: document.document_number, issuer: document.issuer, issued_at: document.issued_at, valid_until: document.valid_until, notes: document.notes }, user)
  let position = 0
  for (const parameter of FZ1E_PRESET.parameters) {
    await parameterSave(admin, { revision_id: revision.id, key: parameter.key, label: parameter.label, unit: parameter.unit, scope: parameter.scope, configurable: parameter.configurable, position: position++,
      sources: parameter.sources.map((source) => ({ document_id: ids[source.doc], min: source.min, max: source.max, fixed: source.fixed, note: source.note })) }, user)
  }
  await templateSave(admin, { revision_id: revision.id, template_key: FZ1E_PRESET.template.template_key, grade: FZ1E_PRESET.template.grade, source_document_id: ids.desenho, notes: FZ1E_PRESET.template.notes })
  const issues = await detectIssues(admin, revision.id, user)
  return { revision_id: revision.id as string, issues_opened: issues, missing: FZ1E_PRESET.missing }
}

// ---------------------------------------------------------------- Configurador
export const configuratorSpec = (admin: Admin, productId: string) => rpc<Record<string, any>>(admin, "product_configurator_spec", { p_product: productId })
export const configure = (admin: Admin, input: Record<string, unknown>) => rpc<Record<string, any>>(admin, "product_configure", { p: input })
export const configurationSave = (admin: Admin, input: Record<string, unknown>, user: string) => rpc<Record<string, any>>(admin, "product_configuration_save", { p: input, p_user: user })
export const configurationGet = (admin: Admin, id: string) => rpc<Record<string, any> | null>(admin, "product_configuration_get", { p_config: id })
export const reviewRequest = (admin: Admin, id: string, reason: string, user: string) => rpc<string>(admin, "product_configuration_request_review", { p_config: id, p_reason: reason, p_user: user })
export const reviewDecide = (admin: Admin, id: string, decision: string, note: string, user: string) => rpc<Record<string, any>>(admin, "product_configuration_decide_review", { p_review: id, p_decision: decision, p_note: note, p_user: user })
export const reconfigureItem = (admin: Admin, itemId: string, configId: string, reason: string, user: string) => rpc<Record<string, any>>(admin, "sales_item_reconfigure", { p_item: itemId, p_new_config: configId, p_reason: reason, p_user: user })
export const productionSheet = (admin: Admin, orderId: string) => rpc<Record<string, any>>(admin, "production_order_sheet", { p_order: orderId })
export const ackConfigReview = (admin: Admin, docId: string, note: string, user: string) => rpc(admin, "vehicle_doc_ack_config_review", { p_doc: docId, p_note: note, p_user: user })
