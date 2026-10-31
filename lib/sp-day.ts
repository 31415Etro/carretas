const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
const known = new Map<string, string>()

/**
 * Dia (AAAA-MM-DD) no horário de Brasília. Substitui `new Date(x).toLocaleDateString("sv-SE", { timeZone })`, que recria o formatador a cada chamada
 * e levava segundos em listas de milhares de notas; aqui o formatador é um só e o resultado de cada data fica guardado.
 */
export function spDay(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === "") return ""
  const isText = typeof value === "string"
  if (isText) { const hit = known.get(value); if (hit !== undefined) return hit }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const result = formatter.format(date)
  if (isText) { if (known.size > 50_000) known.clear(); known.set(value, result) }
  return result
}
