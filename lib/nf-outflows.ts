import { invoiceTitles } from "./nfe-parser.ts"

export type StoredInvoice = {
  dedupe_key: string
  number: string | null
  series: string | null
  issued_at: string | null
  total_amount: number | string | null
  installments: Array<{ number: string; dueDate: string; amount: number }> | null
  counterpart_name: string | null
  counterpart_document: string | null
  issuer_name: string | null
}

/** Dia no horário de Brasília (yyyy-mm-dd) de um instante ISO. */
export const brazilDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })

/**
 * Lançamentos de SAÍDA (Entradas e Saídas) para uma nota recebida: um por parcela, no dia do vencimento.
 * Vencimento antes do mês corrente = Realizado; do mês corrente em diante = Previsto (aparece no "previsto" do Resultado do período).
 * A chave da nota fica na primeira linha de `notes`, o que impede lançar a mesma nota duas vezes.
 */
export function outflowRows(invoice: StoredInvoice, firstOfMonth: string, dreAccountId: string | null) {
  const issued = invoice.issued_at ? brazilDay(invoice.issued_at) : ""
  const parcels = invoiceTitles({ installments: invoice.installments || [], total: Number(invoice.total_amount || 0), issuedAt: issued })
  const number = `${invoice.number || ""}${invoice.series ? `/${invoice.series}` : ""}`
  const name = invoice.counterpart_name || invoice.issuer_name || invoice.counterpart_document || ""
  return parcels.map((parcel) => {
    const realized = parcel.dueDate < firstOfMonth
    return {
      type: "saida", description: `NF ${number} - ${name}${parcel.count > 1 ? ` (${parcel.number}/${parcel.count})` : ""}`, dre_account_id: dreAccountId,
      supplier_name: name, competence_date: issued || parcel.dueDate, due_date: parcel.dueDate, realized_date: realized ? parcel.dueDate : null,
      expected_amount: parcel.amount, realized_amount: realized ? parcel.amount : 0, status: realized ? "Realizado" : "Previsto", origin: "Importacao NF",
      notes: `Importacao NF | ${invoice.dedupe_key}${parcel.count > 1 ? ` | ${parcel.number}/${parcel.count}` : ""}\nNF ${number} recebida de ${name} (${invoice.counterpart_document || ""})`,
    }
  })
}
