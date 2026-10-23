// Indicadores de análise da Contabilidade (cards e quebras) a partir das notas importadas. Funções puras.
import type { AccountingInvoice } from "./accounting-invoice.ts"

export type AnalysisRow = {
  operation: string; number: string | null; issued_at: string | null; issuer_name: string | null; issuer_document: string | null; issuer_state: string | null
  total_invoice: number; total_products: number; total_icms: number; total_icms_st: number; total_ipi: number; total_pis: number; total_cofins: number; total_iss: number
  total_freight: number; total_discount: number; total_taxes: number
  data: Pick<AccountingInvoice, "items" | "issuer" | "totals">
}

type Bucket = { key: string; label: string; notes: number; total: number; taxes: number; icms: number }
const n = (value: unknown) => Number(value || 0)
const round = (value: number) => Math.round(value * 100) / 100

function bump(map: Map<string, Bucket>, key: string, label: string, notes: number, total: number, taxes: number, icms: number) {
  const bucket = map.get(key) || { key, label, notes: 0, total: 0, taxes: 0, icms: 0 }
  bucket.notes += notes; bucket.total += total; bucket.taxes += taxes; bucket.icms += icms
  map.set(key, bucket)
}
const finish = (map: Map<string, Bucket>, limit = 15, by: "total" | "taxes" = "total") =>
  [...map.values()].map((bucket) => ({ ...bucket, total: round(bucket.total), taxes: round(bucket.taxes), icms: round(bucket.icms) })).sort((a, b) => b[by] - a[by]).slice(0, limit)

export function analyzeInvoices(rows: AnalysisRow[]) {
  const sum = { notes: rows.length, total: 0, products: 0, freight: 0, discount: 0, icms: 0, icmsSt: 0, ipi: 0, pis: 0, cofins: 0, iss: 0, importTax: 0, approxTaxes: 0 }
  const months = new Map<string, Bucket>(), suppliers = new Map<string, Bucket>(), states = new Map<string, Bucket>(), cfops = new Map<string, Bucket>(), ncms = new Map<string, Bucket>()
  const materials = new Map<string, { code: string; description: string; ncm: string; unit: string; quantity: number; total: number; icms: number; ipi: number; pis: number; cofins: number; notes: number; suppliers: Set<string> }>()
  let withoutTaxNotes = 0, withoutTaxTotal = 0, simplesNotes = 0, simplesTotal = 0, stNotes = 0, biggest: { number: string; supplier: string; total: number } | null = null
  const regimes = new Map<string, Bucket>()

  for (const row of rows) {
    const taxes = n(row.total_icms) + n(row.total_icms_st) + n(row.total_ipi) + n(row.total_pis) + n(row.total_cofins) + n(row.total_iss) + n(row.data?.totals?.importTax)
    sum.total += n(row.total_invoice); sum.products += n(row.total_products); sum.freight += n(row.total_freight); sum.discount += n(row.total_discount)
    sum.icms += n(row.total_icms); sum.icmsSt += n(row.total_icms_st); sum.ipi += n(row.total_ipi); sum.pis += n(row.total_pis); sum.cofins += n(row.total_cofins); sum.iss += n(row.total_iss)
    sum.importTax += n(row.data?.totals?.importTax); sum.approxTaxes += n(row.total_taxes)
    const month = row.issued_at ? new Date(row.issued_at).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7) : "sem-data"
    bump(months, month, month, 1, n(row.total_invoice), taxes, n(row.total_icms))
    const supplier = row.issuer_document || row.issuer_name || "-"
    bump(suppliers, supplier, row.issuer_name || supplier, 1, n(row.total_invoice), taxes, n(row.total_icms))
    bump(states, row.issuer_state || "?", row.issuer_state || "Sem UF", 1, n(row.total_invoice), taxes, n(row.total_icms))
    if (taxes === 0) { withoutTaxNotes++; withoutTaxTotal += n(row.total_invoice) }
    if (n(row.total_icms_st) > 0) stNotes++
    const regime = String(row.data?.issuer?.taxRegime || "")
    const regimeLabel = regime === "1" ? "Simples Nacional" : regime === "2" ? "Simples (excesso de sublimite)" : regime === "3" ? "Regime normal" : "Não informado"
    bump(regimes, regime || "-", regimeLabel, 1, n(row.total_invoice), taxes, n(row.total_icms))
    if (regime === "1" || regime === "2") { simplesNotes++; simplesTotal += n(row.total_invoice) }
    if (!biggest || n(row.total_invoice) > biggest.total) biggest = { number: row.number || "-", supplier: row.issuer_name || "-", total: n(row.total_invoice) }
    for (const item of row.data?.items || []) {
      const itemTaxes = item.icms.amount + item.icmsSt.amount + item.ipi.amount + item.pis.amount + item.cofins.amount
      bump(cfops, item.cfop || "-", item.cfop || "Sem CFOP", 1, item.total, itemTaxes, item.icms.amount)
      bump(ncms, item.ncm || "-", item.ncm || "Sem NCM", 1, item.total, itemTaxes, item.icms.amount)
      const key = `${item.code}|${item.description.toLowerCase()}`
      const material = materials.get(key) || { code: item.code, description: item.description, ncm: item.ncm, unit: item.unit, quantity: 0, total: 0, icms: 0, ipi: 0, pis: 0, cofins: 0, notes: 0, suppliers: new Set<string>() }
      material.quantity += item.quantity; material.total += item.total; material.icms += item.icms.amount; material.ipi += item.ipi.amount; material.pis += item.pis.amount; material.cofins += item.cofins.amount; material.notes += 1
      if (row.issuer_name) material.suppliers.add(row.issuer_name)
      materials.set(key, material)
    }
  }
  const taxesTotal = sum.icms + sum.icmsSt + sum.ipi + sum.pis + sum.cofins + sum.iss + sum.importTax
  const potentialCredit = sum.icms + sum.ipi + sum.pis + sum.cofins
  const monthRows = [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).map((bucket) => ({ ...bucket, total: round(bucket.total), taxes: round(bucket.taxes), icms: round(bucket.icms) }))
  return {
    totals: Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, key === "notes" ? value : round(value)])) as typeof sum,
    taxesTotal: round(taxesTotal),
    taxBurden: sum.total ? round((taxesTotal / sum.total) * 100) : 0,
    potentialCredit: round(potentialCredit),
    averageTicket: rows.length ? round(sum.total / rows.length) : 0,
    withoutTax: { notes: withoutTaxNotes, total: round(withoutTaxTotal) },
    simples: { notes: simplesNotes, total: round(simplesTotal), share: sum.total ? round((simplesTotal / sum.total) * 100) : 0 },
    substitution: { notes: stNotes },
    biggest,
    months: monthRows,
    suppliers: finish(suppliers, 15),
    suppliersByTaxes: finish(suppliers, 10, "taxes"),
    states: finish(states, 30),
    cfops: finish(cfops, 15),
    ncms: finish(ncms, 15),
    regimes: finish(regimes, 10),
    materials: [...materials.values()].map((row) => ({ ...row, suppliers: [...row.suppliers].slice(0, 5), quantity: round(row.quantity), total: round(row.total), icms: round(row.icms), ipi: round(row.ipi), pis: round(row.pis), cofins: round(row.cofins), averagePrice: row.quantity ? round(row.total / row.quantity) : 0 })).sort((a, b) => b.total - a.total).slice(0, 500),
  }
}
export type AccountingAnalysis = ReturnType<typeof analyzeInvoices>
