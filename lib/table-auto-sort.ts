// Ordenação automática das tabelas (DataTable): lê o texto de cada célula das linhas recebidas e ordena por coluna ao clicar no título.
// Funções puras (sem React) para testar; a extração do texto das linhas (React) fica em components/operations/shared.tsx.

export type SortDir = "asc" | "desc"

const EMPTY = new Set(["", "-", "—", "–", "n/a"])
const norm = (value: string) => value.replace(/\s+/g, " ").trim()

/** Número em formato brasileiro ("R$ 1.234,56", "12,5%", "-3", "1.234") -> número; senão null. */
export function parseNumber(value: string): number | null {
  const text = norm(value).replace(/^R\$\s*/i, "").replace(/\s*%$/, "").replace(/^\(([^)]+)\)$/, "-$1")
  if (!/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$|^[-+]?\d+(,\d+)?$|^[-+]?\d+\.\d+$/.test(text)) return null
  const dotThousands = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) || text.includes(",")
  const number = Number(dotThousands ? text.replace(/\./g, "").replace(",", ".") : text)
  return Number.isFinite(number) ? number : null
}

/** Data "dd/mm/aaaa" (com hora opcional) ou "aaaa-mm-dd" -> instante em ms; senão null. */
export function parseDate(value: string): number | null {
  const text = norm(value)
  let match = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,]+(\d{2}):(\d{2}))?/.exec(text)
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0))
  match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text)
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0))
  return null
}

/** Número de chassi (VIN): 17 letras/números. Colunas de chassi ordenam só pelos 4 últimos caracteres. */
export const isVin = (value: string) => /^[A-Z0-9]{17}$/i.test(norm(value))
export const vinTail = (value: string) => norm(value).slice(-4)

export const isEmptyCell = (value: string) => EMPTY.has(norm(value).toLowerCase())

/** Ordena as linhas (cada uma com o texto das suas células) pela coluna: data, número ou texto, conforme o conteúdo da coluna. Vazios ficam no fim. */
export function sortRows<T>(rows: T[], cellsOf: (row: T) => string[], column: number, dir: SortDir): T[] {
  const values = rows.map((row) => norm(cellsOf(row)[column] ?? ""))
  const filled = values.filter((value) => !isEmptyCell(value))
  const allDates = filled.length > 0 && filled.every((value) => parseDate(value) !== null)
  const allNumbers = !allDates && filled.length > 0 && filled.every((value) => parseNumber(value) !== null)
  const allVins = !allDates && !allNumbers && filled.length > 0 && filled.filter(isVin).length / filled.length >= 0.5
  const key = (value: string): number | string => (allVins && isVin(value) ? vinTail(value) : allDates ? (parseDate(value) as number) : allNumbers ? (parseNumber(value) as number) : value)
  const sign = dir === "asc" ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: values[index] }))
    .sort((left, right) => {
      const leftEmpty = isEmptyCell(left.value), rightEmpty = isEmptyCell(right.value)
      if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty ? left.index - right.index : leftEmpty ? 1 : -1
      if (allVins && isVin(left.value) !== isVin(right.value)) return isVin(left.value) ? -1 : 1 // "lote sem chassi" e afins ficam depois dos chassis
      const a = key(left.value), b = key(right.value)
      const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true })
      return result === 0 ? left.index - right.index : result * sign
    })
    .map((item) => item.row)
}

/** Colunas que não fazem sentido ordenar (botões de ação, ícones). */
export const isActionHeader = (header: string) => /^(a[cç][oõ]es?|op[cç][oõ]es|detalhes?|)$/i.test(norm(header))
