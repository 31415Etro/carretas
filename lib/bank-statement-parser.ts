export type BankStatementType = "Entrada" | "Saida"

export interface BankStatementItem {
  sourceKey: string
  date: string
  description: string
  amount: number
  type: BankStatementType
  rawLine: string
}

export interface BankStatementResult {
  bank: "Sicoob" | "Ailos"
  accountName: string
  accountNumber: string
  periodStart: string
  periodEnd: string
  items: BankStatementItem[]
  ignoredCount: number
  warnings: string[]
}

function comparable(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
}

function amount(value = "") {
  return Number(value.replace(/\s/g, "").replace(/\./g, "").replace(",", "."))
}

function isoDate(value: string, fallbackYear: string) {
  const parts = value.split("/")
  const [day, month, suppliedYear] = parts
  return `${suppliedYear || fallbackYear}-${month}-${day}`
}

function parsePeriod(text: string) {
  const match = text.match(/PER[IÍ]ODO\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:A|-|AT[EÉ])\s*(\d{2}\/\d{2}\/\d{4})/i)
  if (match) return {
    periodStart: isoDate(match[1], ""),
    periodEnd: isoDate(match[2], ""),
    year: match[2].slice(-4),
  }
  const monthNames: Record<string, string> = {
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
    julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
  }
  const written = comparable(text).toLowerCase().match(/(\d{2}) de ([a-z]+) (\d{4})\s+a\s+(\d{2}) de ([a-z]+) (\d{4})/i)
  if (written) {
    const startMonth = monthNames[comparable(written[2]).toLowerCase()]
    const endMonth = monthNames[comparable(written[5]).toLowerCase()]
    if (startMonth && endMonth) return {
      periodStart: `${written[3]}-${startMonth}-${written[1]}`,
      periodEnd: `${written[6]}-${endMonth}-${written[4]}`,
      year: written[6],
    }
  }
  return { periodStart: "", periodEnd: "", year: String(new Date().getFullYear()) }
}

function stableKey(parts: Array<string | number>) {
  const input = parts.map((part) => comparable(String(part))).join("|")
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `bank-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function uniqueItems(items: BankStatementItem[]) {
  const occurrences = new Map<string, number>()
  return items.map((item) => {
    const count = (occurrences.get(item.sourceKey) || 0) + 1
    occurrences.set(item.sourceKey, count)
    return count === 1 ? item : { ...item, sourceKey: `${item.sourceKey}-${count}` }
  })
}

function parseSicoob(text: string): BankStatementResult {
  const period = parsePeriod(text)
  const account = text.match(/CONTA\s*:?\s*([\d.\-]+)\s*\/\s*([^\n]+)/i)
  const items: BankStatementItem[] = []
  let ignoredCount = 0

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, " ").trim()
    const match = line.match(/^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.+?)\s+((?:\d{1,3}\.)*\d{1,3},\d{2})\s*([CD])$/i)
    if (!match) continue
    const description = match[2].trim()
    const normalized = comparable(description)
    if (/SALDO|RESGATE RDC|RDC AUTOMATICO|APLICACAO RDC/.test(normalized)) {
      ignoredCount += 1
      continue
    }
    const value = amount(match[3])
    const type: BankStatementType = match[4].toUpperCase() === "C" ? "Entrada" : "Saida"
    const date = isoDate(match[1], period.year)
    items.push({
      sourceKey: stableKey(["Sicoob", account?.[1] || "", date, type, value.toFixed(2), description]),
      date,
      description,
      amount: value,
      type,
      rawLine: line,
    })
  }

  return {
    bank: "Sicoob",
    accountNumber: account?.[1]?.trim() || "",
    accountName: account?.[2]?.trim() || "",
    ...period,
    items: uniqueItems(items),
    ignoredCount,
    warnings: items.length ? [] : ["Nenhuma movimentacao Sicoob foi reconhecida no PDF."],
  }
}

function inferAilosType(description: string, value: number, balance: number, previousBalance: number | null): BankStatementType {
  if (previousBalance !== null) {
    const variation = Number((balance - previousBalance).toFixed(2))
    if (Math.abs(Math.abs(variation) - value) <= 0.03) return variation >= 0 ? "Entrada" : "Saida"
  }
  return /^(CR\.|CREDITO)|RECEB|DEVOLUCAO|ESTORNO/.test(comparable(description)) ? "Entrada" : "Saida"
}

function parseAilos(text: string): BankStatementResult {
  const period = parsePeriod(text)
  const account = text.match(/CONTA(?:\s+CORRENTE)?\s*:?\s*([\d.\-]+)/i)
  const accountName = text.match(/(?:COOPERADO|TITULAR)\s*:?\s*([^\n]+)/i)?.[1]?.trim()
    || text.match(/\n([^\n]+)\nDocumento\s*:/i)?.[1]?.trim()
    || ""
  const openingBalance = text.match(/SALDO ANTERIOR\s+-?\s*(-?(?:\d{1,3}\.)*\d{1,3},\d{2})/i)
  let previousBalance: number | null = openingBalance ? amount(openingBalance[1]) : null
  const items: BankStatementItem[] = []

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, " ").trim()
    const match = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+((?:\d{1,3}\.)*\d{1,3},\d{2})\s+(-?(?:\d{1,3}\.)*\d{1,3},\d{2})$/)
    if (!match) continue
    const description = match[2].trim()
    const value = amount(match[3])
    const balance = amount(match[4])
    const type = inferAilosType(description, value, balance, previousBalance)
    const date = isoDate(match[1], period.year)
    items.push({
      sourceKey: stableKey(["Ailos", account?.[1] || "", date, type, value.toFixed(2), description]),
      date,
      description,
      amount: value,
      type,
      rawLine: line,
    })
    previousBalance = balance
  }

  return {
    bank: "Ailos",
    accountNumber: account?.[1]?.trim() || "",
    accountName,
    ...period,
    items: uniqueItems(items),
    ignoredCount: 0,
    warnings: items.length ? [] : ["Nenhuma movimentacao Ailos foi reconhecida no PDF."],
  }
}

export function parseBankStatement(text: string): BankStatementResult {
  const normalized = comparable(text)
  if (normalized.includes("SICOOB")) return parseSicoob(text)
  if (normalized.includes("AILOS") || normalized.includes("VIACREDI")) return parseAilos(text)
  throw new Error("Banco nao reconhecido. Atualmente sao aceitos extratos Sicoob e Ailos/Viacredi.")
}
