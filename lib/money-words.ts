// Valor por extenso em português (R$), como no pedido comercial: "seis mil trezentos e oitenta reais".
const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
const tens = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]

function below1000(n: number): string {
  if (n === 0) return ""
  if (n === 100) return "cem"
  const parts: string[] = []
  if (n >= 100) parts.push(hundreds[Math.floor(n / 100)])
  const rest = n % 100
  if (rest > 0) parts.push(rest < 20 ? units[rest] : tens[Math.floor(rest / 10)] + (rest % 10 ? ` e ${units[rest % 10]}` : ""))
  return parts.join(" e ")
}

function integerWords(n: number): string {
  if (n === 0) return "zero"
  const groups: Array<[number, string, string]> = [[1e9, "bilhão", "bilhões"], [1e6, "milhão", "milhões"], [1e3, "mil", "mil"]]
  const parts: string[] = []
  let rest = n
  for (const [size, one, many] of groups) {
    const count = Math.floor(rest / size)
    if (count > 0) { parts.push(size === 1e3 && count === 1 ? "mil" : `${below1000(count)} ${count === 1 ? one : many}`); rest -= count * size }
  }
  if (rest > 0) parts.push(below1000(rest))
  // "e" entre os grupos só antes de um último grupo "redondo" (centenas exatas ou menor que 100): "mil e quinhentos", "mil trezentos e oitenta"
  if (parts.length === 1) return parts[0]
  const last = rest > 0 ? rest : 0
  const joinLast = last > 0 && (last < 100 || last % 100 === 0)
  return joinLast ? `${parts.slice(0, -1).join(" ")} e ${parts[parts.length - 1]}` : parts.join(" ")
}

export function moneyInWords(value: number) {
  const cents = Math.round(Math.abs(Number(value) || 0) * 100)
  const reais = Math.floor(cents / 100), centavos = cents % 100
  const out: string[] = []
  if (reais > 0 || centavos === 0) out.push(`${integerWords(reais)} ${reais === 1 ? "real" : reais !== 0 && reais % 1e6 === 0 ? "de reais" : "reais"}`)
  if (centavos > 0) out.push(`${integerWords(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`)
  return out.join(" e ")
}
