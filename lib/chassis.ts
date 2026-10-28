// Chassis das notas de venda da ND Carretas. A NF-e não usa o campo próprio de veículo: o número vem no fim da descrição do item,
// depois do código do produto. Ex.: "MARCA MOD R/ND CARRETAS FZ 1E ANO 2026/MOD 2026 PBT 0,75 t CAP 0,55 t COR PRATA COD (600043) 980NDFZ1ETD000233".

export type ChassisRow = {
  chassis: string; model: string; family: string; axles: number; pbt: number; capacity: number; color: string; year: string; productCode: string; description: string
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
/** Toneladas escritas na descrição ("0,75", "0,550", "055" = 0,55): sem vírgula, 3 dígitos começando em zero valem centésimos. */
export function parseTons(value: string | undefined): number {
  const text = String(value || "").trim().replace(/[^0-9,.]/g, "")
  if (!text) return 0
  if (/^0\d{2}$/.test(text)) return Number(text) / 100
  const number = Number(text.replace(",", "."))
  if (!Number.isFinite(number)) return 0
  return number >= 10 ? number / 1000 : number
}

export function describeTrailer(description: string) {
  const text = String(description || "")
  const model = text.match(/ND\s+CARRETAS?\s+(.+?)\s+ANO\b/i)?.[1] || ""
  const cleanModel = model.replace(/\s+/g, " ").replace(/[^A-Za-z0-9]+$/, "").trim().toUpperCase()
  return {
    model: cleanModel,
    family: cleanModel.replace(/\s*\d+E$/, "").trim(),
    axles: Number(cleanModel.match(/(\d+)E$/)?.[1] || 0),
    pbt: parseTons(text.match(/PBT\s*:?\s*([0-9][0-9,.]*)/i)?.[1]),
    capacity: parseTons(text.match(/\bCAP\.?\s*:?\s*([0-9][0-9,.]*)/i)?.[1]),
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
export const issuedDay = (iso: string | null) => dayOf(iso)
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

// ------------------------------------------------------------ página Chassis: períodos, tamanho e abertura das notas

export type Granularity = "mes" | "semana"
export type GroupBy = "model" | "family"

/** Chave do período: "2026-03" (mês) ou "2026-03-02" (segunda-feira da semana). */
export function periodKey(iso: string | null, granularity: Granularity) {
  if (!iso) return "sem-data"
  const day = dayOf(iso)
  if (granularity === "mes") return day.slice(0, 7)
  const date = new Date(`${day}T12:00:00Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

const groupName = (row: ChassisRow, by: GroupBy) => (by === "family" ? row.family : row.model) || "Sem modelo"

/** Chassis (distintos) por período e por modelo/linha: dados prontos para o gráfico empilhado. */
export function chassisTimeline(rows: ChassisRow[], granularity: Granularity, by: GroupBy) {
  const periods = [...new Set(rows.map((row) => periodKey(row.issuedAt, granularity)))].sort()
  const series = [...new Set(rows.map((row) => groupName(row, by)))]
  const cells = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = `${periodKey(row.issuedAt, granularity)}|${groupName(row, by)}`
    ;(cells.get(key) || cells.set(key, new Set()).get(key)!).add(row.chassis)
  }
  const totals = new Map<string, number>()
  for (const [key, set] of cells) { const name = key.split("|")[1]; totals.set(name, (totals.get(name) || 0) + set.size) }
  const ordered = series.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0))
  return {
    periods, series: ordered,
    data: periods.map((period) => ({ period, ...Object.fromEntries(ordered.map((name) => [name, cells.get(`${period}|${name}`)?.size || 0])) } as Record<string, string | number>)),
  }
}

/** Quantidade de chassis por tamanho: capacidade de carga (t), PBT (t) ou número de eixos. */
export function chassisBySize(rows: ChassisRow[], field: "capacity" | "pbt" | "axles") {
  const groups = new Map<number, { chassis: Set<string>; total: number }>()
  for (const row of rows) {
    const value = Number(row[field] || 0)
    const entry = groups.get(value) || { chassis: new Set<string>(), total: 0 }
    entry.chassis.add(row.chassis); entry.total += row.itemTotal
    groups.set(value, entry)
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([value, entry]) => ({
    value, label: value ? (field === "axles" ? `${value} eixo${value > 1 ? "s" : ""}` : `${String(value).replace(".", ",")} t`) : "Sem informação", chassis: entry.chassis.size, total: money(entry.total),
  }))
}

export type ChassisPick = { name?: string; by?: GroupBy; period?: string; granularity?: Granularity; size?: { field: "capacity" | "pbt" | "axles"; value: number } }

/** Linhas escolhidas ao clicar no gráfico (modelo, período e/ou tamanho). */
export function pickChassis(rows: ChassisRow[], pick: ChassisPick) {
  return rows.filter((row) => {
    if (pick.name && groupName(row, pick.by || "model") !== pick.name) return false
    if (pick.period && periodKey(row.issuedAt, pick.granularity || "mes") !== pick.period) return false
    if (pick.size && Number(row[pick.size.field] || 0) !== pick.size.value) return false
    return true
  }).sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || a.number.localeCompare(b.number))
}
