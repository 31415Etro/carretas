import { randomUUID, timingSafeEqual } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { cleanDocument } from "@/lib/commercial"
import { importInvoice } from "@/lib/nf-import-server"
import { generatesTitle, planSync, type SyncResult } from "@/lib/nf-sync"
import { outflowRows, type StoredInvoice } from "@/lib/nf-outflows"
import { parseInvoiceXml } from "@/lib/nfe-parser"

type Admin = ReturnType<typeof createAdminClient>
export const SYNC_RESPONSIBLE = "Importação automática (NFeMail)"

/** O agendador local se identifica com NF_SYNC_SECRET. Sem o segredo configurado, a rota fica fechada. */
export function validSyncSecret(request: Request) {
  const expected = process.env.NF_SYNC_SECRET || ""
  if (expected.length < 24) return false
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const left = Buffer.from(given)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Empresa do sistema pelo CNPJ (só dígitos). */
export async function companyByCnpj(admin: Admin, cnpj: string) {
  const { data, error } = await admin.from("system_companies").select("id,name,cnpj")
  if (error) throw error
  const digits = cleanDocument(cnpj)
  return (data || []).find((company) => cleanDocument(String(company.cnpj || "")) === digits) || null
}

/** Lê um XML, decide o que fazer e importa (sem repetir: a chave de acesso é única em imported_invoices). */
export async function syncXml(admin: Admin, companyId: string, companyCnpj: string, fileName: string, xml: string, dryRun = false): Promise<SyncResult> {
  try {
    const invoice = parseInvoiceXml(xml)
    const plan = planSync(invoice, companyCnpj)
    const base = { file: fileName, number: invoice.number, total: invoice.total }
    if (plan.action === "ignorar") return { ...base, status: "ignorada", detail: plan.reason }
    if (dryRun) return { ...base, status: "importada", detail: "simulação", kind: plan.role === "destinatario" ? "pagar" : "receber" }
    const file = new File([xml], fileName, { type: "text/xml" })
    const result = await importInvoice(admin, { file, fileName }, plan.role, companyId, plan.registerAs, SYNC_RESPONSIBLE, plan.launch, `${new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7)}-01`)
    return { ...base, status: "importada", kind: plan.launch ? (plan.role === "destinatario" ? "pagar" : "receber") : undefined, counterpart: result.counterpartName, detail: result.titles ? `${result.titles.count} título(s)` : plan.note || result.titlesNote }
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Erro ao importar."
    if (/já foi importada/i.test(message)) return { file: fileName, status: "duplicada" }
    return { file: fileName, status: "erro", detail: message.slice(0, 300) }
  }
}

/**
 * Lança em Entradas e Saídas (como Saída) as notas RECEBIDAS já importadas, para o Resultado do período e a DRE as enxergarem.
 * Idempotente: nota/parcela já lançada (mesma chave em `notes`) é pulada. Usa o cliente da empresa (a empresa vai certa na gravação).
 */
export async function lancarSaidas(admin: Admin) {
  const readAll = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const out: T[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await build(offset, offset + 999)
      if (error) throw new Error(error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) return out
    }
  }
  const invoices = await readAll<StoredInvoice & { items: Array<{ cfop: string; ncm: string; total: number }> | null }>((from, to) => admin.from("imported_invoices").select("dedupe_key,number,series,issued_at,total_amount,installments,counterpart_name,counterpart_document,issuer_name,items").eq("my_role", "Destinatário").order("created_at").range(from, to))
  const existing = new Set((await readAll<{ notes: string | null }>((from, to) => admin.from("financial_transactions").select("notes").eq("origin", "Importacao NF").eq("type", "saida").order("created_at").range(from, to))).map((row) => String(row.notes || "").split("\n")[0]))
  // notas já conciliadas com a planilha (linha da planilha marcada "Conciliado NF | chave"): não lança de novo
  const conciliated = new Set(
    (await readAll<{ notes: string | null }>((from, to) => admin.from("financial_transactions").select("notes").eq("type", "saida").ilike("notes", "%Conciliado NF |%").order("created_at").range(from, to)))
      .flatMap((row) => Array.from(String(row.notes || "").matchAll(/Conciliado NF \|\s*([^\s|]+)/g), (match) => match[1])),
  )
  // parcelas conciliadas uma a uma ("Conciliado NF parcela | chave | n/m"; nota de parcela única = 1/1)
  const conciliatedParcels = new Set(
    (await readAll<{ notes: string | null }>((from, to) => admin.from("financial_transactions").select("notes").eq("type", "saida").ilike("notes", "%Conciliado NF parcela |%").order("created_at").range(from, to)))
      .flatMap((row) => Array.from(String(row.notes || "").matchAll(/Conciliado NF parcela \|\s*([^\s|]+)\s*\|\s*(\d+\/\d+)/g), (match) => `${match[1]}|${match[2] === "1/1" ? "" : match[2]}`)),
  )
  const parcelToken = (notes: string) => {
    const parts = notes.split("\n")[0].split("|")
    return `${parts[1]?.trim() || ""}|${parts[2]?.trim() || ""}`
  }
  const { data: dre } = await admin.from("dre_accounts").select("id").eq("name", "Sem classificacao").limit(1)
  const dreId = dre?.[0]?.id ? String(dre[0].id) : null
  const firstOfMonth = `${new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7)}-01`
  // remessa, retorno, demonstração, conserto, transferência e devolução (CFOP sem cobrança) não são compra a pagar: não viram saída
  const billable = invoices.filter((invoice) => generatesTitle({ items: (invoice.items || []).map((item) => ({ ...item, code: "", description: "", unit: "", quantity: 0, unitPrice: 0 })), payment: undefined, installments: invoice.installments || [] }))
  const rows = billable.flatMap((invoice) => outflowRows(invoice, firstOfMonth, dreId)).filter((row) => !existing.has(row.notes.split("\n")[0]) && !conciliated.has(row.notes.split("\n")[0].split("|")[1]?.trim() || "") && !conciliatedParcels.has(parcelToken(row.notes)))
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin.from("financial_transactions").insert(rows.slice(index, index + 200).map((row) => ({ ...row, id: randomUUID() })))
    if (error) throw new Error(error.message)
  }
  return { notas: invoices.length, lancamentos: rows.length, total: Math.round(rows.reduce((sum, row) => sum + row.expected_amount, 0) * 100) / 100 }
}
