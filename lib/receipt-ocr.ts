// Leitura de notinhas de despesa (cupom de restaurante, posto, estacionamento, pedágio...) a partir do texto lido por OCR
// no navegador (mesmo motor usado para DANFE, veja lib/ocr-client.ts). Funções puras (testáveis).

export type ReceiptCategory = "Alimentacao" | "Combustivel" | "Hospedagem" | "Transporte" | "Estacionamento" | "Pedagio" | "Outros"

export type ParsedReceipt = {
  amount: number
  establishment: string
  occurredAt: string // yyyy-mm-dd
  category: ReceiptCategory
  warnings: string[]
}

const moneyPattern = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})(?![\d])/g
const toMoney = (value: string) => {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value
  return Math.round(Number(normalized) * 100) / 100
}
const brToIso = (value: string) => `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}`
const validDate = (iso: string) => {
  const time = Date.parse(`${iso}T12:00:00Z`)
  return Number.isFinite(time) && Number(iso.slice(0, 4)) >= 2015 && Number(iso.slice(0, 4)) <= 2100
}

const TOTAL_LABELS = /TOTAL\s*(A\s*PAGAR|GERAL|L[ÍI]QUIDO|DA\s*COMPRA|DO\s*PEDIDO)?|VALOR\s*TOTAL|VALOR\s*PAGO|VALOR\s*A\s*PAGAR/i
const SUBTOTAL_LABEL = /SUB\s*-?\s*TOTAL/i

/** Palavras-chave por categoria (comparação sem acento e sem diferença de maiúsculas; palavra inteira ou começo de palavra). */
const KEYWORDS: Record<Exclude<ReceiptCategory, "Outros">, string[]> = {
  Combustivel: ["posto", "combustivel", "combustiveis", "gasolina", "etanol", "alcool", "diesel", "gnv", "arla", "petrobras", "ipiranga", "shell", "raizen", "br mania", "auto posto", "autoposto", "abastecimento", "bomba", "litros", "lubrificante"],
  Alimentacao: ["restaurante", "lanchonete", "padaria", "panificadora", "churrascaria", "pizzaria", "hamburgueria", "hamburguer", "cafe", "cafeteria", "bar", "boteco", "mercado", "supermercado", "mercearia", "acougue", "sorveteria", "confeitaria", "doceria", "lanches", "lanche", "marmita", "marmitaria", "ifood", "self service", "buffet", "refeicao", "almoco", "janta", "jantar", "prato", "bebida", "refrigerante", "suco", "cerveja", "agua mineral", "pao", "salgado", "coca cola", "couvert", "garcom", "taxa de servico", "servico 10", "mesa"],
  Hospedagem: ["hotel", "pousada", "hostel", "hospedagem", "booking", "airbnb", "motel", "resort", "diaria", "apart hotel", "flat"],
  Transporte: ["uber", "taxi", "onibus", "rodoviaria", "passagem", "locadora", "localiza", "movida", "unidas", "aeroporto", "latam", "gol linhas", "azul linhas", "cabify", "bilhete", "corrida", "embarque", "frete"],
  Estacionamento: ["estacionamento", "estapar", "zona azul", "parking", "garagem", "vaga", "manobrista"],
  Pedagio: ["pedagio", "sem parar", "conectcar", "veloe", "praca de pedagio", "autopista", "ecovias", "arteris", "rodovia", "concessionaria", "tag "],
}

const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "")
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const KEYWORD_PATTERNS = (Object.entries(KEYWORDS) as Array<[Exclude<ReceiptCategory, "Outros">, string[]]>).map(([category, words]) => ({
  category,
  patterns: words.map((word) => new RegExp(`(?<![a-z0-9])${escapeRegex(stripAccents(word).trim()).replace(/ /g, "\\s+")}`)),
}))

/** Quantas palavras-chave de cada categoria aparecem no trecho. */
function scoreText(text: string, weight: number, scores: Map<ReceiptCategory, number>) {
  const flat = stripAccents(text.toLowerCase())
  for (const { category, patterns } of KEYWORD_PATTERNS) {
    const hits = patterns.filter((pattern) => pattern.test(flat)).length
    if (hits) scores.set(category, (scores.get(category) || 0) + hits * weight)
  }
}

/**
 * Categoria pelo texto do cupom: pontua cada categoria pelas palavras-chave achadas (o nome do estabelecimento, nas primeiras
 * linhas, pesa mais que o resto) e fica com a de maior pontuação; "Outros" só quando nada bate.
 */
export function categorizeReceipt(text: string): ReceiptCategory {
  const scores = new Map<ReceiptCategory, number>()
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  scoreText(lines.slice(0, 4).join("\n"), 3, scores)
  scoreText(text, 1, scores)
  let best: ReceiptCategory = "Outros", bestScore = 0
  for (const [category, score] of scores) if (score > bestScore) { best = category; bestScore = score }
  return best
}

/** Linha mais provável de ser o nome do estabelecimento: perto do topo, com letras, sem ser cabeçalho fiscal comum. */
function guessEstablishment(lines: string[]): string {
  const skip = /CNPJ|CPF|RECIBO|CUPOM|NOTA FISCAL|DOCUMENTO|ENDERE|AVENIDA|^RUA\b|TELEFONE|DATA|HORA|VALOR|TOTAL|ITEM|QTDE|C[ÓO]DIGO/i
  for (const line of lines.slice(0, 8)) {
    const cleaned = line.replace(/[^A-Za-zÀ-ÿ0-9&.\-/' ]/g, " ").replace(/\s+/g, " ").trim()
    if (cleaned.length >= 4 && /[A-Za-zÀ-ÿ]{3,}/.test(cleaned) && !skip.test(cleaned) && !/^\d+$/.test(cleaned)) return cleaned.slice(0, 80)
  }
  return ""
}

/** Lê uma notinha a partir do texto do OCR: valor, estabelecimento, data e categoria sugerida. */
export function parseReceiptText(rawText: string): ParsedReceipt {
  const warnings: string[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  const flat = lines.join("\n")

  const totalIndex = lines.findIndex((line) => TOTAL_LABELS.test(line) && !SUBTOTAL_LABEL.test(line))
  let amount = 0
  if (totalIndex >= 0) {
    for (const line of lines.slice(totalIndex, totalIndex + 2)) {
      const values = Array.from(line.matchAll(moneyPattern), (match) => toMoney(match[1])).filter((value) => value > 0)
      if (values.length) { amount = values[values.length - 1]; break }
    }
  }
  if (!amount) {
    // sem rótulo de total legível: assume que o maior valor monetário do cupom é o total (o troco e os itens são menores)
    const values = Array.from(flat.matchAll(moneyPattern), (match) => toMoney(match[1])).filter((value) => value > 0)
    amount = values.reduce((max, value) => Math.max(max, value), 0)
    if (amount) warnings.push("Não achei o rótulo \"total\": usei o maior valor do cupom. Confira.")
  }
  if (!amount) warnings.push("Não consegui ler o valor. Preencha manualmente.")

  const dates = Array.from(flat.matchAll(/(?<![\d/])(\d{2}\/\d{2}\/\d{4})(?![\d/])/g), (match) => brToIso(match[1])).filter(validDate)
  const today = new Date().toISOString().slice(0, 10)
  const occurredAt = dates[0] || today
  if (!dates.length) warnings.push("Não consegui ler a data: usei a data de hoje. Confira.")

  const establishment = guessEstablishment(lines)
  if (!establishment) warnings.push("Não consegui identificar o estabelecimento.")

  return { amount, establishment, occurredAt, category: categorizeReceipt(rawText), warnings }
}
