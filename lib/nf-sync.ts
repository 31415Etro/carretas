import { cleanDocument } from "./commercial.ts"
import type { MyRole, ParsedInvoice } from "./nfe-parser.ts"

export type SyncPlan =
  | { action: "importar"; role: MyRole; registerAs: "" | "cliente" | "fornecedor"; launch: boolean; note: string }
  | { action: "ignorar"; reason: string }

/** CFOPs (3 últimos dígitos) de operações sem cobrança: remessas, retornos, demonstração, conserto, transferência, devolução. */
const NON_FINANCIAL = new Set([
  ...Array.from({ length: 25 }, (_, index) => String(901 + index)), // 901–925: remessa/retorno (industrialização, conserto, locação, demonstração…)
  "949", "201", "202", "208", "209", "410", "411", "412", "413", "503", "553", "556",
  ...Array.from({ length: 9 }, (_, index) => String(151 + index)), // 151–159: transferência
])

const cfopSuffix = (cfop: string) => String(cfop || "").replace(/\D/g, "").slice(-3)

/** A nota gera conta a pagar/receber? Não gera quando todas as linhas são operações sem cobrança ou o pagamento é "sem pagamento" (tPag 90) sem duplicatas. */
export function generatesTitle(invoice: Pick<ParsedInvoice, "items" | "payment" | "installments">) {
  if (invoice.installments.length) return true
  if (invoice.payment === "90") return false
  const cfops = invoice.items.map((item) => cfopSuffix(item.cfop)).filter(Boolean)
  return !cfops.length || cfops.some((cfop) => !NON_FINANCIAL.has(cfop))
}

/**
 * Decide o que fazer com um XML baixado do portal, pelos CNPJs da própria nota (e não pelo filtro "entrada/saída" do portal,
 * que inclui notas de entrada emitidas pela própria empresa).
 *  - destinatário = empresa  -> recebida  -> Contas a Pagar, fornecedor cadastrado
 *  - emitente = empresa (saída) -> emitida -> Contas a Receber, cliente cadastrado
 * Devoluções/complementares, entradas próprias, notas entre as duas pontas iguais e notas sem cobrança não geram título.
 */
export function planSync(invoice: ParsedInvoice, companyCnpj: string): SyncPlan {
  const mine = cleanDocument(companyCnpj)
  const issuer = cleanDocument(invoice.issuer?.document || "")
  const recipient = cleanDocument(invoice.recipient?.document || "")
  if (invoice.kind !== "NF-e" && invoice.kind !== "NFS-e") return { action: "ignorar", reason: "Cupom fiscal (NFC-e): não importado." }
  if (issuer && issuer === recipient) return { action: "ignorar", reason: "Emitente e destinatário são o mesmo CNPJ." }
  const isRecipient = Boolean(mine) && recipient === mine
  const isIssuer = Boolean(mine) && issuer === mine
  if (!isRecipient && !isIssuer) return { action: "ignorar", reason: "A nota não é nem emitida nem destinada ao CNPJ da empresa." }
  if (invoice.purpose && invoice.purpose !== "1") return { action: "ignorar", reason: `Nota de finalidade ${invoice.purpose} (complementar, ajuste ou devolução): lance manualmente se necessário.` }
  if (isIssuer && invoice.direction === "0") return { action: "ignorar", reason: "Nota de entrada emitida pela própria empresa." }
  if (isRecipient && invoice.direction === "0") return { action: "ignorar", reason: "Nota de entrada sem mercadoria recebida de terceiro." }
  const launch = generatesTitle(invoice)
  const role: MyRole = isRecipient ? "destinatario" : "remetente"
  return {
    action: "importar", role, launch,
    registerAs: launch ? (isRecipient ? "fornecedor" : "cliente") : "",
    note: launch ? "" : "Operação sem cobrança (remessa, retorno, transferência ou sem pagamento): registrada sem conta.",
  }
}

export type SyncStatus = "importada" | "duplicada" | "ignorada" | "erro"
export type SyncResult = { file: string; status: SyncStatus; detail?: string; kind?: "pagar" | "receber"; number?: string; total?: number; counterpart?: string }

export function summarize(results: SyncResult[]) {
  const count = (status: SyncStatus) => results.filter((result) => result.status === status).length
  return {
    importadas: count("importada"), duplicadas: count("duplicada"), ignoradas: count("ignorada"), erros: count("erro"),
    pagar: results.filter((result) => result.status === "importada" && result.kind === "pagar").length,
    receber: results.filter((result) => result.status === "importada" && result.kind === "receber").length,
  }
}

export type RevenueKind = "Receita de servicos" | "Venda de carretas" | "Venda de pecas e acessorios"

/** Categoria de receita (e, por ela, a linha da DRE) de uma nota emitida: industrialização = serviços; NCM 8716 (reboques) em 50% ou mais do valor = carretas; o resto = peças. */
export function revenueKind(items: Array<{ cfop: string; ncm: string; total: number }>): RevenueKind {
  const total = items.reduce((sum, item) => sum + Number(item.total || 0), 0) || 1
  const cfops = items.map((item) => cfopSuffix(item.cfop)).filter(Boolean)
  if (cfops.length && cfops.every((cfop) => cfop === "124" || cfop === "125")) return "Receita de servicos"
  const trailers = items.filter((item) => String(item.ncm || "").startsWith("8716")).reduce((sum, item) => sum + Number(item.total || 0), 0)
  return trailers / total >= 0.5 ? "Venda de carretas" : "Venda de pecas e acessorios"
}
