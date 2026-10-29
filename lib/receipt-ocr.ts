// Leitura de notinhas de despesa (cupom de restaurante, posto, estacionamento, pedágio...) a partir do texto lido por OCR
// no navegador (mesmo motor usado para DANFE, veja lib/ocr-client.ts). Funções puras (testáveis).

export type ReceiptCategory = "Alimentacao" | "Combustivel" | "Hospedagem" | "Transporte" | "Estacionamento" | "Pedagio" | "Outros"

export type ParsedReceipt = {
  amount: number
  establishment: string
  occurredAt: string // yyyy-mm-dd
  category: ReceiptCategory
  warnings: string[]
  /** O valor fecha numa conta do próprio cupom (pago - troco), não só na leitura de uma linha. */
  verified?: boolean
}

const moneyPattern = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?: \d{3})+,\d{2}|\d+\.\d{2})(?![\d])/g
const toMoney = (value: string) => {
  const normalized = value.includes(",") ? value.replace(/[. ]/g, "").replace(",", ".") : value
  return Math.round(Number(normalized) * 100) / 100
}
const fullYear = (year: string) => (year.length === 2 ? `20${year}` : year)
const validDate = (iso: string) => {
  const time = Date.parse(`${iso}T12:00:00Z`)
  return Number.isFinite(time) && Number(iso.slice(0, 4)) >= 2015 && Number(iso.slice(0, 4)) <= 2100
}

/** Conserta os defeitos comuns do OCR em valores: "45 , 90", "45, 90", "1O,50", "R$45.9O", "R$ 12 50" sem separador. */
function cleanLine(line: string) {
  return line
    .replace(/(?<=\d)[OoQ](?=[\d,.]|$|\s)|(?<=[,.])[OoQ](?=\d)/g, "0")
    .replace(/(?<=\d)[lI|](?=[\d,.])|(?<=[,.])[lI|](?=\d)/g, "1")
    .replace(/(\d)\s*,\s*(\d{2})(?!\d)/g, "$1,$2")
    .replace(/R\$\s*(\d{1,4})\s(\d{2})(?!\d)/gi, "R$ $1,$2")
}
const moneyIn = (line: string) => Array.from(cleanLine(line).matchAll(moneyPattern), (match) => toMoney(match[1])).filter((value) => value > 0 && value < 10_000_000)

/** "TOTAL", "A PAGAR"...: o valor da compra. Linhas de itens, tributos, troco e subtotal não contam. */
const TOTAL_LABELS = /(?<![A-Z])(TOTAL\s*(A\s*PAGAR|GERAL|L[ÍI]QUIDO|DA\s*COMPRA|DO\s*PEDIDO|DA\s*NOTA|DO\s*CUPOM|DA\s*VENDA|R\s*\$)?|VAL(OR)?\.?\s*TOTAL|V[LI]R?\.?\s*TOTAL|VALOR\s*A\s*PAGAR|A\s*PAGAR|VALOR\s*DA\s*NOTA|VALOR\s*DA\s*COMPRA|VALOR\s*L[ÍI]QUIDO|T\s*O\s*T\s*A\s*L)(?![A-Z])/i
const PAID_LABELS = /VALOR\s*PAGO|PAGAMENTO|CART[ÃA]O|CR[ÉE]DITO|D[ÉE]BITO|PIX|DINHEIRO|RECEBIDO/i
const NOT_TOTAL = /SUB\s*-?\s*TOTAL|ITENS|QTD|QUANT|TRIBUT|IMPOSTO|ICMS|TROCO|DESCONTO|ACR[ÉE]SC|GORJETA|CPF|CNPJ|PIS|COFINS|LEI\s*12/i

/** Palavras-chave por categoria (comparação sem acento e sem diferença de maiúsculas; palavra inteira ou começo de palavra). */
const KEYWORDS: Record<Exclude<ReceiptCategory, "Outros">, string[]> = {
  Combustivel: ["posto", "combustivel", "combustiveis", "gasolina", "etanol", "alcool", "diesel", "gnv", "arla", "petrobras", "ipiranga", "shell", "raizen", "br mania", "auto posto", "autoposto", "abastecimento", "bomba", "litros", "lubrificante"],
  Alimentacao: ["restaurante", "lanchonete", "padaria", "panificadora", "churrascaria", "pizzaria", "hamburgueria", "hamburguer", "cafe", "cafeteria", "bar", "boteco", "mercado", "supermercado", "mercearia", "acougue", "sorveteria", "confeitaria", "doceria", "lanches", "lanche", "marmita", "marmitaria", "ifood", "self service", "buffet", "refeicao", "almoco", "janta", "jantar", "prato", "bebida", "refrigerante", "suco", "cerveja", "agua mineral", "pao", "salgado", "coca cola", "couvert", "garcom", "taxa de servico", "servico 10", "mesa", "energetico", "red bull", "chiclete", "bauru", "sanduiche", "bala", "chocolate", "biscoito", "conveniencia"],
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

/** Nome do OCR com maiúsculas trocadas ("vIA MAIS REDE DE posTOS"): se a maioria das letras é maiúscula, o nome todo vira maiúsculo. */
const tidyName = (name: string) => { const letters = name.replace(/[^A-Za-zÀ-ÿ]/g, ""); return letters.length && (letters.match(/[A-ZÀ-Þ]/g) || []).length / letters.length >= 0.5 ? name.toUpperCase() : name }

/** Linha mais provável de ser o nome do estabelecimento: perto do topo, com letras, sem ser cabeçalho fiscal comum. */
function guessEstablishment(lines: string[]): string {
  const skip = /CNPJ|CPF|RECIBO|CUPOM|NOTA FISCAL|DOCUMENTO|AUXILIAR|DANFE|SIMPLIFICADO|ELETR|ENDERE|AVENIDA|^RUA\b|^ROD\b|^AV\b|^BR\s*\d|TELEFONE|DATA|HORA|VALOR|TOTAL|ITEM|QTDE|C[ÓO]DIGO/i
  for (const line of lines.slice(0, 10)) {
    // "CNPJ: 09.273.885/0021-10 VIA MAIS REDE DE POSTOS S.A.": o nome vem depois do número do CNPJ
    const afterCnpj = line.replace(/^.*?CNPJ\W*[\d.\/\-\s]{14,22}/i, "")
    const cleaned = (afterCnpj !== line ? afterCnpj : line).replace(/[^A-Za-zÀ-ÿ0-9&.\-/' ]/g, " ").replace(/\s+/g, " ").trim()
    if (afterCnpj !== line && cleaned.length >= 4 && /[A-Za-zÀ-ÿ]{3,}/.test(cleaned)) return tidyName(cleaned).slice(0, 80)
    if (cleaned.length >= 4 && /[A-Za-zÀ-ÿ]{3,}/.test(cleaned) && !skip.test(cleaned) && !/^\d+$/.test(cleaned)) return cleaned.slice(0, 80)
  }
  return ""
}

/** Lê uma notinha a partir do texto do OCR: valor, estabelecimento, data e categoria sugerida. */
export function parseReceiptText(rawText: string): ParsedReceipt {
  const warnings: string[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  const flat = lines.join("\n")

  let amount = 0
  // 0) conferência cruzada do cupom fiscal: total, valor pago e troco fecham (pago - troco = total); com isso o total é certo mesmo com o rótulo ilegível
  const everyValue = lines.flatMap(moneyIn)
  const unique = [...new Set(everyValue)]
  const crossed = new Set<number>()
  for (const paid of unique) for (const change of unique) {
    const total = Math.round((paid - change) * 100) / 100
    if (change > 0 && total > 0 && unique.includes(total)) crossed.add(total)
  }
  // pago - troco e total são simétricos (600 - 6,49 = 593,51 e 600 - 593,51 = 6,49): fica o que tem um valor de item quase igual (a soma dos itens), ou o maior
  const near = (value: number) => unique.some((other) => other !== value && Math.abs(other - value) <= 0.05)
  const crossedList = [...crossed]
  const crossedTotal = crossedList.length === 1 ? crossedList[0] : crossedList.find(near) ?? (crossedList.length ? Math.max(...crossedList) : 0)
  // 1) rótulo de total: o valor vem na mesma linha ou nas 3 seguintes (layout em coluna); vale o maior entre os totais achados
  const totals: number[] = []
  lines.forEach((line, index) => {
    if (!TOTAL_LABELS.test(line) || NOT_TOTAL.test(line)) return
    for (const candidate of lines.slice(index, index + 4)) {
      if (candidate !== line && (NOT_TOTAL.test(candidate) || TOTAL_LABELS.test(candidate))) break
      const values = moneyIn(candidate)
      if (values.length) { totals.push(values[values.length - 1]); break }
    }
  })
  if (totals.length) amount = Math.max(...totals)
  if (crossedTotal && amount !== crossedTotal && !crossed.has(amount)) amount = crossedTotal // a conferência pago - troco vale mais que a leitura de uma linha (se o rótulo já bate com ela, fica o rótulo)
  // 2) sem total legível: valor pago/cartão/pix (o dinheiro pode ser maior que a compra, por isso só como segunda opção)
  if (!amount && crossedTotal) amount = crossedTotal
  // troco lido: o OCR erra um dígito do total com facilidade, mas pago e troco costumam vir certos. Se algum valor do cupom menos o troco
  // fica a menos de 3% do total lido (e é diferente), o resultado da conta é o total certo (593,91 lido, 600,00 - 6,49 = 593,51).
  let verified = Boolean(amount && crossed.has(amount))
  const change = lines.flatMap((line, index) => (/TROCO/i.test(line) ? [moneyIn(line)[0] ?? moneyIn(lines[index + 1] || "")[0]] : [])).find((value) => value > 0) || 0
  if (change > 0 && amount > 0) {
    const fixed = unique.map((paid) => Math.round((paid - change) * 100) / 100).filter((total) => total > 0 && Math.abs(total - amount) / amount <= 0.03)
    if (fixed.includes(amount)) verified = true
    else if (fixed.length) { const read = amount; amount = fixed.sort((a, b) => Math.abs(a - read) - Math.abs(b - read))[0]; verified = true } // vários candidatos: o mais perto do total lido
  }
  if (!amount) {
    const paid: number[] = []
    lines.forEach((line, index) => { if (PAID_LABELS.test(line) && !/TROCO/i.test(line)) { const values = moneyIn(`${line} ${lines[index + 1] || ""}`); if (values.length) paid.push(values[values.length - 1]) } })
    if (paid.length) { amount = Math.min(...paid); warnings.push("Não achei o rótulo \"total\": usei o valor pago. Confira.") }
  }
  // 3) o maior valor monetário do cupom (itens, troco e tributos são menores)
  if (!amount) {
    const values = lines.filter((line) => !/TROCO|TRIBUT|CPF|CNPJ|TELEFONE|FONE/i.test(line)).flatMap(moneyIn)
    amount = values.reduce((max, value) => Math.max(max, value), 0)
    if (amount) warnings.push("Não achei o rótulo \"total\": usei o maior valor do cupom. Confira.")
  }
  if (!amount) warnings.push("Não consegui ler o valor. Preencha manualmente.")

  const dates = [
    ...Array.from(flat.matchAll(/(?<![\d/])(\d{2})[/.\-](\d{2})[/.\-](\d{4}|\d{2})(?![\d/])/g), (match) => `${fullYear(match[3])}-${match[2]}-${match[1]}`),
    ...Array.from(flat.matchAll(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g), (match) => `${match[1]}-${match[2]}-${match[3]}`),
  ].filter(validDate)
  const today = new Date().toISOString().slice(0, 10)
  const occurredAt = dates.find((iso) => iso <= today) || dates[0] || today
  if (!dates.length) warnings.push("Não consegui ler a data: usei a data de hoje. Confira.")

  const establishment = guessEstablishment(lines)
  if (!establishment) warnings.push("Não consegui identificar o estabelecimento.")

  return { amount, establishment, occurredAt, category: categorizeReceipt(rawText), warnings, verified }
}

/**
 * Escolhe a melhor leitura entre várias tentativas de OCR da mesma foto. "Segura" quando o valor fecha numa conta do cupom (pago - troco)
 * ou quando duas tentativas diferentes chegam ao mesmo valor. Sem isso, devolve a leitura com o valor mais votado (e sure = false).
 */
export function pickReceiptText(texts: string[]): { text: string; sure: boolean } {
  const parsed = texts.map((text) => ({ text, ...parseReceiptText(text) }))
  const labeled = parsed.filter((item) => item.amount > 0 && !item.warnings.some((warning) => /r[óo]tulo/i.test(warning)))
  const verified = labeled.find((item) => item.verified && item.establishment) || labeled.find((item) => item.verified)
  if (verified) return { text: verified.text, sure: true }
  const votes = new Map<number, number>()
  for (const item of labeled) votes.set(item.amount, (votes.get(item.amount) || 0) + 1)
  const [best, count] = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [0, 0]
  const chosen = labeled.find((item) => item.amount === best && item.establishment) || labeled.find((item) => item.amount === best)
  if (chosen) return { text: chosen.text, sure: count >= 2 }
  const any = parsed.find((item) => item.amount > 0)
  return { text: any ? any.text : texts.join("\n"), sure: false }
}
