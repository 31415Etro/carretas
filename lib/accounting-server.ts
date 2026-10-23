import type { createAdminClient } from "@/lib/supabase/server"
import { parseAccountingXml } from "@/lib/accounting-invoice"

type Admin = ReturnType<typeof createAdminClient>
export const ACCOUNTING_MIGRATION_HINT = "A Contabilidade ainda não está liberada no banco: rode o script scripts/231_contabilidade_notas.sql no Supabase."
const missing = (message: string) => /accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)

/** Importa um XML: a mesma nota (chave de acesso, ou número + emitente) não entra duas vezes. */
export async function importAccountingXml(admin: Admin, input: { xml: string; fileName: string; operation: "Entrada" | "Saída"; responsible: string }) {
  const parsed = parseAccountingXml(input.xml)
  const dedupeKey = parsed.accessKey ? `chave:${parsed.accessKey}` : `nota:${parsed.kind}:${parsed.issuer.document || ""}:${parsed.series}:${parsed.number}`
  const { totals, issuer, recipient } = parsed
  const { fields, ...data } = parsed
  const row = {
    dedupe_key: dedupeKey, operation: input.operation, kind: parsed.kind, model: parsed.model || null, access_key: parsed.accessKey || null, number: parsed.number || null, series: parsed.series || null,
    issued_at: parsed.issuedAt ? new Date(parsed.issuedAt).toISOString() : null, nature: parsed.nature || null,
    issuer_document: issuer.document || null, issuer_name: issuer.name || null, issuer_state: issuer.state || null,
    recipient_document: recipient.document || null, recipient_name: recipient.name || null, recipient_state: recipient.state || null,
    total_products: totals.products, total_invoice: totals.invoice, total_icms_base: totals.icmsBase, total_icms: totals.icms, total_icms_st: totals.icmsSt, total_ipi: totals.ipi,
    total_pis: totals.pis, total_cofins: totals.cofins, total_iss: totals.iss, total_freight: totals.freight, total_discount: totals.discount, total_taxes: totals.totalTaxes,
    data, fields, xml: input.xml, file_name: input.fileName, created_by: input.responsible,
  }
  const found = await admin.from("accounting_invoices").select("id").eq("dedupe_key", dedupeKey).maybeSingle()
  if (found.error) throw new Error(missing(found.error.message) ? ACCOUNTING_MIGRATION_HINT : found.error.message)
  if (found.data) return { status: "duplicada" as const, id: found.data.id as string, number: parsed.number }
  const saved = await admin.from("accounting_invoices").insert(row).select("id").single()
  if (saved.error) throw new Error(missing(saved.error.message) ? ACCOUNTING_MIGRATION_HINT : saved.error.message)
  return { status: "importada" as const, id: saved.data.id as string, number: parsed.number }
}
