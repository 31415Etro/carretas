// Chassis das notas de venda da ND Carretas. A NF-e não usa o campo próprio de veículo: o número vem no fim da descrição do item,
// depois do código do produto. Ex.: "MARCA MOD R/ND CARRETAS FZ 1E ANO 2026/MOD 2026 PBT 0,75 t CAP 0,55 t COR PRATA COD (600043) 980NDFZ1ETD000233".

export type ChassisRow = {
  chassis: string; model: string; color: string; year: string; productCode: string; description: string
  invoiceId: string; number: string; series: string; issuedAt: string | null; accessKey: string; nature: string
  clientName: string; clientDocument: string; itemTotal: number; invoiceTotal: number
  companyId: string; companyName: string; intercompany: boolean
}

/** Só letras e números, em maiúsculas. */
const clean = (value: string) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
export const digits = (value: string) => String(value || "").replace(/\D/g, "")

/** Número de chassi dentro de um texto: o que vem logo depois de "COD (000000)" ou, na falta dele, um código no padrão 980ND... */
export function extractChassis(text: string): string | null {
  const value = String(text || "")
  const afterCode = value.match(/COD\s*\(\s*\d+\s*\)\s*([A-Za-z0-9]{8,20})\b/i)
  if (afterCode) return clean(afterCode[1])
  const plain = value.match(/\b(980[A-Z0-9]{9,16})\b/i)
  return plain ? clean(plain[1]) : null
}

/** Modelo, cor, ano e código do produto escritos na descrição do item. */
export function describeTrailer(description: string) {
  const text = String(description || "")
  const model = text.match(/ND\s+CARRETAS\s+(.+?)\s+ANO\b/i)?.[1] || ""
  return {
    model: model.replace(/\s+/g, " ").replace(/[^A-Za-z0-9]+$/, "").trim().toUpperCase(),
    color: (text.match(/\bCOR\s+([A-ZÀ-Úa-zà-ú]+)/i)?.[1] || "").toUpperCase(),
    year: text.match(/\bANO\s+(\d{4})/i)?.[1] || "",
    productCode: text.match(/COD\s*\(\s*(\d+)\s*\)/i)?.[1] || "",
  }
}

type InvoiceRow = {
  id: string; number: string | null; series: string | null; issued_at: string | null; access_key: string | null; nature: string | null
  recipient_name: string | null; recipient_document: string | null; total_invoice: number | string | null
  items: Array<{ description?: string; total?: number | string }> | null
}

/** Uma linha por chassi encontrado nos itens da nota. `companyDocuments` são os CNPJs das empresas do grupo (venda entre empresas não é venda ao cliente). */
export function chassisFromInvoice(invoice: InvoiceRow, company: { id: string; name: string }, companyDocuments: string[] = []): ChassisRow[] {
  const rows: ChassisRow[] = []
  for (const item of invoice.items || []) {
    const chassis = extractChassis(item.description || "")
    if (!chassis) continue
    const trailer = describeTrailer(item.description || "")
    const document = digits(invoice.recipient_document || "")
    rows.push({
      chassis, ...trailer, description: String(item.description || ""), invoiceId: invoice.id, number: String(invoice.number || ""), series: String(invoice.series || ""), issuedAt: invoice.issued_at,
      accessKey: String(invoice.access_key || ""), nature: String(invoice.nature || ""), clientName: String(invoice.recipient_name || ""), clientDocument: document,
      itemTotal: Number(item.total || 0), invoiceTotal: Number(invoice.total_invoice || 0), companyId: company.id, companyName: company.name, intercompany: companyDocuments.includes(document),
    })
  }
  return rows
}

type Filters = { q?: string; clientDocument?: string; clientName?: string; includeIntercompany?: boolean }

/** Busca por número do chassi (inteiro ou parte), número da nota, ou por cliente (CNPJ/CPF ou, sem documento, o nome). */
export function filterChassis(rows: ChassisRow[], filters: Filters) {
  const term = clean(filters.q || "")
  const termText = String(filters.q || "").trim().toLowerCase()
  const document = digits(filters.clientDocument || "")
  const name = String(filters.clientName || "").trim().toLowerCase()
  return rows.filter((row) => {
    if (!filters.includeIntercompany && !term && !document && !name && row.intercompany) return false
    if (term && !(row.chassis.includes(term) || row.number === termText || (digits(filters.q || "").length >= 20 && row.accessKey.includes(digits(filters.q || ""))) || row.clientName.toLowerCase().includes(termText))) return false
    if (document) { if (row.clientDocument !== document) return false } else if (name && !row.clientName.toLowerCase().includes(name)) return false
    return true
  })
}

const month = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7) : "sem-data")
type Count = { label: string; chassis: number; total: number }
function bump(map: Map<string, Count>, key: string, row: ChassisRow) {
  const entry = map.get(key) || { label: key, chassis: 0, total: 0 }
  entry.chassis += 1; entry.total += row.itemTotal
  map.set(key, entry)
}

/** Números do gráfico: chassis por mês, por modelo, por cliente e por empresa. Venda entre as empresas do grupo fica de fora (conta a venda ao cliente final). */
export function chassisChart(rows: ChassisRow[]) {
  const sales = rows.filter((row) => !row.intercompany)
  const months = new Map<string, Count>(), models = new Map<string, Count>(), clients = new Map<string, Count>(), companies = new Map<string, Count>()
  for (const row of sales) {
    bump(months, month(row.issuedAt), row)
    bump(models, row.model || "Sem modelo", row)
    bump(clients, row.clientName || "Sem cliente", row)
    bump(companies, row.companyName, row)
  }
  const sorted = (map: Map<string, Count>, limit = 12) => [...map.values()].map((entry) => ({ ...entry, total: Math.round(entry.total * 100) / 100 })).sort((a, b) => b.chassis - a.chassis || b.total - a.total).slice(0, limit)
  return {
    totalChassis: sales.length, distinctChassis: new Set(sales.map((row) => row.chassis)).size, intercompany: rows.length - sales.length,
    months: [...months.values()].sort((a, b) => a.label.localeCompare(b.label)).map((entry) => ({ ...entry, total: Math.round(entry.total * 100) / 100 })),
    models: sorted(models), clients: sorted(clients, 10), companies: sorted(companies),
  }
}

const money = (value: number) => Math.round(value * 100) / 100
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : "")

/** Quantidade emitida e valor por modelo: chassis distintos, notas, valor total, médio, menor e maior. */
export function chassisByModel(rows: ChassisRow[]) {
  const groups = new Map<string, ChassisRow[]>()
  for (const row of rows) (groups.get(row.model || "Sem modelo") || groups.set(row.model || "Sem modelo", []).get(row.model || "Sem modelo")!).push(row)
  return [...groups.entries()].map(([model, items]) => {
    const values = items.map((item) => item.itemTotal)
    const total = values.reduce((sum, value) => sum + value, 0)
    const dates = items.map((item) => dayOf(item.issuedAt)).filter(Boolean).sort()
    return {
      model, chassis: new Set(items.map((item) => item.chassis)).size, notes: new Set(items.map((item) => item.invoiceId)).size, items: items.length,
      total: money(total), average: money(total / items.length), min: money(Math.min(...values)), max: money(Math.max(...values)), first: dates[0] || "", last: dates[dates.length - 1] || "",
    }
  }).sort((a, b) => b.chassis - a.chassis || b.total - a.total)
}

/** Quantidade (e valor) por modelo em cada mês: matriz para conferir a produção/emissão mês a mês. */
export function chassisByModelMonth(rows: ChassisRow[]) {
  const months = [...new Set(rows.map((row) => month(row.issuedAt)))].sort()
  const models = [...new Set(rows.map((row) => row.model || "Sem modelo"))]
  const cell = new Map<string, { chassis: number; total: number }>()
  for (const row of rows) {
    const key = `${row.model || "Sem modelo"}|${month(row.issuedAt)}`
    const entry = cell.get(key) || { chassis: 0, total: 0 }
    entry.chassis += 1; entry.total += row.itemTotal
    cell.set(key, entry)
  }
  return {
    months,
    rows: models.map((model) => {
      const byMonth = months.map((m) => { const entry = cell.get(`${model}|${m}`); return { month: m, chassis: entry?.chassis || 0, total: money(entry?.total || 0) } })
      return { model, byMonth, chassis: byMonth.reduce((sum, c) => sum + c.chassis, 0), total: money(byMonth.reduce((sum, c) => sum + c.total, 0)) }
    }).sort((a, b) => b.chassis - a.chassis),
  }
}

/** Uma linha por chassi: quantas notas o citam, valor somado, última nota, último cliente. */
export function chassisPerChassis(rows: ChassisRow[]) {
  const groups = new Map<string, ChassisRow[]>()
  for (const row of rows) (groups.get(row.chassis) || groups.set(row.chassis, []).get(row.chassis)!).push(row)
  return [...groups.entries()].map(([chassis, items]) => {
    const ordered = [...items].sort((a, b) => String(a.issuedAt || "").localeCompare(String(b.issuedAt || "")))
    const last = ordered[ordered.length - 1]
    return {
      chassis, model: last.model, color: last.color, year: last.year, notes: new Set(items.map((item) => item.invoiceId)).size, total: money(items.reduce((sum, item) => sum + item.itemTotal, 0)),
      firstIssuedAt: ordered[0].issuedAt, lastIssuedAt: last.issuedAt, lastNumber: last.number, lastClient: last.clientName, lastCompany: last.companyName, lastValue: money(last.itemTotal),
      numbers: ordered.map((item) => item.number).join(", "),
    }
  }).sort((a, b) => String(b.lastIssuedAt || "").localeCompare(String(a.lastIssuedAt || "")) || a.chassis.localeCompare(b.chassis))
}
