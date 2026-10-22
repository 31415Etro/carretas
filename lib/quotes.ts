// Regras do módulo Orçamentos: totais, margem, validade, situações, versões e parcelas.
// Funções puras (testáveis).

export const quoteTypes = ["Produto", "Serviço", "Misto"] as const
export const quoteStatuses = ["Rascunho", "Enviado", "Em negociação", "Aprovado", "Recusado", "Expirado", "Convertido", "Cancelado", "Substituído"] as const
export type QuoteStatus = (typeof quoteStatuses)[number]

export type QuoteLine = {
  lineType: "Produto" | "Serviço"
  quantity: number
  unitPrice: number
  unitCost: number
  discountPercent: number
}

export type QuoteExtras = { discountAmount: number; freightAmount: number; expensesAmount: number; taxPercent: number }

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export const lineTotal = (line: Pick<QuoteLine, "quantity" | "unitPrice" | "discountPercent">) =>
  round2(Number(line.quantity || 0) * Number(line.unitPrice || 0) * (1 - Number(line.discountPercent || 0) / 100))

/**
 * Totais do orçamento: subtotal dos itens (já com desconto por item), desconto global,
 * frete/despesas, impostos a destacar (% sobre o valor líquido) e margem estimada
 * (valor líquido dos itens menos o custo congelado dos itens).
 */
export function quoteTotals(lines: QuoteLine[], extras: QuoteExtras) {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineTotal(line), 0))
  const discount = round2(Math.min(Math.max(Number(extras.discountAmount) || 0, 0), subtotal))
  const net = round2(subtotal - discount)
  const taxes = round2((net * (Number(extras.taxPercent) || 0)) / 100)
  const total = round2(net + (Number(extras.freightAmount) || 0) + (Number(extras.expensesAmount) || 0) + taxes)
  const cost = round2(lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0))
  const margin = round2(net - cost)
  return { subtotal, discount, net, taxes, total, cost, margin, marginPercent: net > 0 ? round2((margin / net) * 100) : null }
}

/** O tipo informado precisa bater com os itens: Produto, Serviço ou Misto (os dois). */
export function typeMatchesLines(type: string, lines: Array<Pick<QuoteLine, "lineType">>) {
  const products = lines.some((line) => line.lineType === "Produto")
  const services = lines.some((line) => line.lineType === "Serviço")
  if (type === "Produto") return products && !services
  if (type === "Serviço") return services && !products
  if (type === "Misto") return products && services
  return false
}

export type QuoteInput = {
  clientId: string
  salespersonId: string
  issueDate: string
  validUntil: string
  quoteType: string
  paymentConditionId: string
  discountAmount: number
  freightAmount: number
  expensesAmount: number
  taxPercent: number
  warrantyDays: number
  lines: Array<QuoteLine & { description: string; catalogId: string }>
}

/** Mensagem de erro ou "" quando o orçamento pode ser salvo. */
export function validateQuote(input: QuoteInput) {
  if (!input.clientId) return "Informe o cliente."
  if (!input.salespersonId) return "Informe o vendedor responsável."
  if (!input.issueDate) return "Informe a data de emissão."
  if (!input.validUntil) return "Informe o prazo de validade."
  if (input.validUntil < input.issueDate) return "A validade não pode ser anterior à emissão."
  if (!(quoteTypes as readonly string[]).includes(input.quoteType)) return "Informe o tipo: produto, serviço ou misto."
  if (!input.lines.length) return "Adicione ao menos um produto ou serviço."
  if (input.lines.some((line) => !line.catalogId)) return "Todos os itens devem vir do catálogo de produtos/serviços."
  if (input.lines.some((line) => !line.description.trim())) return "Todos os itens precisam de descrição."
  if (input.lines.some((line) => !(Number(line.quantity) > 0))) return "A quantidade de cada item deve ser maior que zero."
  if (input.lines.some((line) => !(Number(line.unitPrice) >= 0))) return "O preço unitário não pode ser negativo."
  if (input.lines.some((line) => !(Number(line.discountPercent) >= 0 && Number(line.discountPercent) <= 100))) return "O desconto por item deve ficar entre 0% e 100%."
  if (!typeMatchesLines(input.quoteType, input.lines)) return input.quoteType === "Misto" ? "Orçamento misto precisa ter produto e serviço." : `Orçamento do tipo ${input.quoteType.toLowerCase()} só pode ter itens de ${input.quoteType.toLowerCase()}.`
  const totals = quoteTotals(input.lines, input)
  if (Number(input.discountAmount) < 0) return "O desconto não pode ser negativo."
  if (Number(input.discountAmount) > totals.subtotal) return "O desconto global é maior que o subtotal."
  if ([input.freightAmount, input.expensesAmount].some((value) => Number(value) < 0)) return "Frete e despesas não podem ser negativos."
  if (!(Number(input.taxPercent) >= 0 && Number(input.taxPercent) <= 100)) return "Imposto deve ficar entre 0% e 100%."
  if (!input.paymentConditionId) return "Informe a condição de pagamento."
  if (Number(input.warrantyDays) < 0) return "A garantia não pode ser negativa."
  return ""
}

/** Situação efetiva: rascunho ou enviado com a validade vencida vira "Expirado". */
export function effectiveStatus(status: string, validUntil: string, today = new Date().toISOString().slice(0, 10)) {
  return (status === "Rascunho" || status === "Enviado" || status === "Em negociação") && validUntil && validUntil < today ? "Expirado" : status
}

/** Quem pode virar o quê. Aprovado/Recusado/Enviado partem de Enviado; Convertido só pela conversão. */
export function validateQuoteTransition(from: string, to: string, extra: { acceptedBy?: string; reason?: string; validUntil?: string }, today = new Date().toISOString().slice(0, 10)) {
  const status = effectiveStatus(from, extra.validUntil || "", today)
  if (to === "Em negociação") {
    if (status === "Expirado") return "Orçamento expirado: crie uma nova versão com nova validade."
    if (status !== "Enviado") return "Só um orçamento enviado pode ir para negociação."
    return ""
  }
  if (to === "Enviado") {
    if (status !== "Rascunho" && status !== "Enviado" && status !== "Em negociação") return status === "Expirado" ? "Orçamento expirado: crie uma nova versão com nova validade." : `Orçamento ${status.toLowerCase()} não pode ser enviado.`
    return ""
  }
  if (to === "Aprovado") {
    if (status === "Expirado") return "Orçamento expirado: crie uma nova versão com nova validade antes de aprovar."
    if (status !== "Enviado" && status !== "Rascunho" && status !== "Em negociação") return `Orçamento ${status.toLowerCase()} não pode ser aprovado.`
    if (!String(extra.acceptedBy || "").trim()) return "Informe o responsável pelo aceite."
    return ""
  }
  if (to === "Recusado") {
    if (status !== "Enviado" && status !== "Em negociação") return "Só é possível registrar recusa de um orçamento enviado ou em negociação."
    if (!String(extra.reason || "").trim()) return "Informe o motivo da recusa."
    return ""
  }
  if (to === "Cancelado") {
    if (["Convertido", "Cancelado", "Substituído"].includes(status)) return `Orçamento ${status.toLowerCase()} não pode ser cancelado.`
    if (!String(extra.reason || "").trim()) return "Informe o motivo do cancelamento."
    return ""
  }
  return "Mudança de situação não permitida."
}

/** Rascunho edita no lugar; depois de enviado, qualquer alteração gera nova versão. */
export const editableInPlace = (status: string) => status === "Rascunho"
export const canCreateVersion = (status: string) => ["Enviado", "Em negociação", "Aprovado", "Recusado", "Expirado"].includes(status)

export type PaymentRule = { installments: number; firstDueDays: number; intervalDays: number }

function addDays(base: string, days: number) {
  const date = new Date(`${base}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function addMonths(base: string, months: number) {
  const [year, month, day] = base.split("-").map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

/** Parcelas pela condição de pagamento (intervalo de 30 dias = mês a mês); a última absorve os centavos. */
export function buildInstallments(total: number, rule: PaymentRule, baseDate: string) {
  const count = Math.max(1, Math.round(rule.installments || 1))
  const cents = Math.round((Number(total) || 0) * 100)
  const first = addDays(baseDate, Math.max(0, rule.firstDueDays || 0))
  const parcels: Array<{ number: number; dueDate: string; amount: number }> = []
  let allocated = 0
  for (let index = 0; index < count; index++) {
    const amount = index === count - 1 ? cents - allocated : Math.floor(cents / count)
    allocated += amount
    parcels.push({ number: index + 1, dueDate: rule.intervalDays === 30 ? addMonths(first, index) : addDays(first, (rule.intervalDays || 0) * index), amount: amount / 100 })
  }
  return parcels
}

/** Resumo legível do que mudou entre duas versões/edições. */
export function describeChanges(before: { total: number; items: number; validUntil: string; discount: number; paymentConditionName: string }, after: { total: number; items: number; validUntil: string; discount: number; paymentConditionName: string }) {
  const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const parts: string[] = []
  if (before.total !== after.total) parts.push(`total de ${brl(before.total)} para ${brl(after.total)}`)
  if (before.items !== after.items) parts.push(`itens de ${before.items} para ${after.items}`)
  if (before.discount !== after.discount) parts.push(`desconto global de ${brl(before.discount)} para ${brl(after.discount)}`)
  if (before.validUntil !== after.validUntil) parts.push(`validade de ${before.validUntil} para ${after.validUntil}`)
  if (before.paymentConditionName !== after.paymentConditionName) parts.push(`condição de pagamento de "${before.paymentConditionName || "-"}" para "${after.paymentConditionName || "-"}"`)
  return parts.length ? `Alterado: ${parts.join("; ")}.` : "Alterado (detalhes dos itens)."
}

/** Texto padrão para e-mail/WhatsApp. */
export function shareMessage(input: { companyName: string; clientName: string; quoteNumber: string; version: number; total: number; validUntil: string }) {
  const brl = Number(input.total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const validity = input.validUntil.split("-").reverse().join("/")
  return `Olá, ${input.clientName}! Segue o orçamento ${input.quoteNumber}${input.version > 1 ? ` (versão ${input.version})` : ""} da ${input.companyName}, no valor de ${brl}, válido até ${validity}. Qualquer dúvida estamos à disposição.`
}
