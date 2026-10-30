// Leitura da planilha "Controle de pgtos": da aba Fábrica até o fim, cada linha com número de chassi vira uma venda (vendedor, valor, NF, consumidor, baixa).
// Linhas de "Total" e linhas sem chassi não são lançamentos e ficam de fora. Funções puras para testar; a leitura do arquivo fica no script de importação.

export type SaleLine = {
  vin: string; sheet: string; kind: "fabrica" | "externo"; seller: string; date: string | null; invoice: string; description: string
  consumer: string; value: number | null; paid: number | null; payment: string
}

const VIN = /\b(980[A-Z0-9]{14})\b/i
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim())
const plain = (value: unknown) => text(value).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/** "R$ 7,000.00" já vem como número da planilha; texto brasileiro ("1.234,56") também é aceito. */
export function money(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  const raw = text(value).replace(/^R\$\s*/i, "")
  if (!/^-?[\d.,]+$/.test(raw)) return null
  const normalized = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "")
  const number = Number(normalized)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null
}

/** Data da célula (Date do Excel ou "dd/mm/aaaa") -> "aaaa-mm-dd". */
export function dateOf(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime() - 3 * 3600_000).toISOString().slice(0, 10) // a planilha guarda meia-noite de Brasília
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

/** Texto depois do chassi, sem parênteses: "980NDFZ1ETD000133 (1400X2,20 COM BAÚ)" -> "1400X2,20 COM BAÚ". */
export function describeAfterVin(value: string, vin: string): string {
  const rest = text(value).replace(new RegExp(vin, "i"), "").trim()
  return rest.replace(/^[\s(:-]+/, "").replace(/[\s)]+$/, "").trim()
}

const titleCase = (value: string) => text(value).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase())

/** Vendedor da fábrica: "ANDERSON " -> "Anderson". Tiago e Thiago são pessoas diferentes. */
export const sellerName = (value: string) => titleCase(value)

type Column = { date: number; invoice: number; seller: number; description: number; consumer: number; value: number; paid: number; payment: number }

function columnsOf(header: unknown[]): Column | null {
  const find = (test: (name: string) => boolean) => header.findIndex((cell) => test(plain(cell)))
  const description = find((name) => name.startsWith("DESCRI"))
  if (description < 0) return null
  return {
    description,
    date: find((name) => name === "DATA"), invoice: find((name) => name === "NF"), seller: find((name) => name === "VENDEDOR"),
    consumer: find((name) => name.startsWith("CONSUMIDOR") || name === "CLIENTE"), value: find((name) => name === "VALOR"), paid: find((name) => name === "VALOR PAGO"), payment: find((name) => name.startsWith("BAIXA")),
  }
}

/** Linhas de uma aba -> uma venda por chassi. `kind` é "fabrica" na aba Fábrica (tem a coluna VENDEDOR) e "externo" nas demais (o vendedor é o nome da aba). */
export function parseSheet(name: string, rows: unknown[][], kind: "fabrica" | "externo"): { sales: SaleLine[]; skipped: number } {
  const headerIndex = rows.findIndex((row, index) => index < 6 && columnsOf(row))
  if (headerIndex < 0) return { sales: [], skipped: 0 }
  const columns = columnsOf(rows[headerIndex]) as Column
  const sales: SaleLine[] = []
  let skipped = 0
  for (const row of rows.slice(headerIndex + 1)) {
    const cell = (index: number) => (index >= 0 ? row[index] : null)
    const description = text(cell(columns.description))
    if (/^total\b/i.test(description) || /^total\b/i.test(text(cell(columns.invoice)))) continue // linha de total não é lançamento
    const match = description.match(VIN) || row.map(text).join(" ").match(VIN)
    if (!match) { if (description) skipped += 1; continue }
    const vin = match[1].toUpperCase()
    sales.push({
      vin, sheet: text(name), kind, seller: kind === "fabrica" ? sellerName(text(cell(columns.seller))) : text(name),
      date: dateOf(cell(columns.date)), invoice: text(cell(columns.invoice)).replace(/\.0$/, ""), description: describeAfterVin(description.match(VIN) ? description : text(row.join(" ")), vin),
      consumer: titleCase(text(cell(columns.consumer))), value: money(cell(columns.value)), paid: money(cell(columns.paid)), payment: text(cell(columns.payment)),
    })
  }
  return { sales, skipped }
}

export type SaleInfo = {
  vin: string; seller: string; externalSeller: string; saleValue: number | null; externalValue: number | null; paidValue: number | null; saleDate: string | null
  saleInvoice: string; consumer: string; payment: string; description: string; lines: number
}

/** Une as linhas do mesmo chassi: a aba Fábrica vale para vendedor, consumidor, data, NF e valor; a aba do vendedor externo traz o vendedor externo, o valor e a baixa. */
export function mergeSales(lines: SaleLine[]): SaleInfo[] {
  const byVin = new Map<string, SaleInfo>()
  for (const line of lines) {
    const info = byVin.get(line.vin) || { vin: line.vin, seller: "", externalSeller: "", saleValue: null, externalValue: null, paidValue: null, saleDate: null, saleInvoice: "", consumer: "", payment: "", description: "", lines: 0 }
    info.lines += 1
    if (line.kind === "fabrica") {
      info.seller ||= line.seller; info.consumer ||= line.consumer
      if (info.saleValue === null) info.saleValue = line.value
      info.saleDate ||= line.date; info.saleInvoice ||= line.invoice
    } else {
      info.externalSeller ||= line.seller
      if (info.externalValue === null) info.externalValue = line.value
      info.saleDate ||= line.date; info.saleInvoice ||= line.invoice
    }
    if (info.paidValue === null) info.paidValue = line.paid
    info.payment ||= line.payment
    info.description ||= line.description
    byVin.set(line.vin, info)
  }
  return [...byVin.values()]
}

/** Modelo e ano pelo número do chassi (980ND + linha + eixos ... + letra do ano). */
export function modelFromVin(vin: string): { model: string; family: string; axles: number; year: string } {
  const match = vin.match(/^980N[DS]([A-Z]{2,3})(\d)/)
  const years: Record<string, string> = { R: "2024", S: "2025", T: "2026", V: "2027" }
  const year = years[vin.charAt(9)] || ""
  if (!match) return { model: "", family: "", axles: 0, year }
  const family = match[1], axles = family === "JET" ? 0 : Number(match[2])
  return { model: axles ? `${family} ${axles}E` : family, family, axles, year }
}
