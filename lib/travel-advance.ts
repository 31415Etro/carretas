// Antecipação de reembolso para viagem: orçamento de gasto para um funcionário, prestado por um link público (sem login) onde ele
// sobe fotos das notinhas. Funções puras (testáveis); a parte com banco fica em lib/travel-advance-server.ts.

export type AdvanceStatus = "Aberto" | "Finalizado" | "Concluido" | "Cancelado"
export type ReceiptStatus = "Enviado" | "Aprovado" | "Contestado"
export type SettlementAction = "devolver" | "desconto_folha"

export type TravelAdvanceReceipt = {
  id: string
  amount: number
  status: ReceiptStatus
}

export type TravelAdvanceSummary = {
  budget: number
  spent: number
  remaining: number
  overspent: boolean
  overspentAmount: number
}

/** Quanto já foi gasto e quanto falta/sobra do orçamento. Notas contestadas continuam contando (o valor foi gasto; a contestação é sobre o registro, não o saldo). */
export function summarizeAdvance(budget: number, receipts: Array<{ amount: number }>): TravelAdvanceSummary {
  const spent = Math.round(receipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0) * 100) / 100
  const remaining = Math.round((budget - spent) * 100) / 100
  return { budget, spent, remaining, overspent: remaining < 0, overspentAmount: remaining < 0 ? Math.round(-remaining * 100) / 100 : 0 }
}

/** O funcionário pode finalizar? Se estourou o orçamento, precisa justificar o que saiu do próprio bolso. */
export function canFinalize(summary: TravelAdvanceSummary, ownPocketJustification: string) {
  if (!summary.overspent) return { ok: true as const }
  if (!ownPocketJustification.trim()) return { ok: false as const, reason: "Você gastou mais do que o valor disponibilizado: explique o que pagou do seu bolso antes de finalizar." }
  return { ok: true as const }
}

/** Depois de finalizar, se sobrou saldo o funcionário precisa dizer o que fazer com ele. */
export function needsSettlementChoice(summary: TravelAdvanceSummary, settlementAction: SettlementAction | null) {
  return summary.remaining > 0.004 && !settlementAction
}

/** O antecipação de reembolso para viagem está pronto para o financeiro marcar como concluído? Nenhuma nota pendente nem contestada, e (se sobrou saldo) a devolução já foi resolvida. */
export function isFullyReviewed(receipts: Array<{ status: ReceiptStatus }>) {
  return receipts.length > 0 && receipts.every((receipt) => receipt.status === "Aprovado")
}

export function hasContested(receipts: Array<{ status: ReceiptStatus }>) {
  return receipts.some((receipt) => receipt.status === "Contestado")
}

/** Dias restantes até o prazo do link (negativo = vencido). */
export function daysUntil(endDate: string, today = new Date().toISOString().slice(0, 10)) {
  return Math.round((Date.parse(`${endDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000)
}

/** O link ainda aceita novas notinhas? Só enquanto Aberto e dentro do prazo. */
export function canUpload(status: AdvanceStatus, endDate: string, today?: string) {
  return status === "Aberto" && daysUntil(endDate, today) >= 0
}

/** Quem pode EXCLUIR uma antecipação (apagar de vez, com notinhas e lançamento): só os usuários Vitor e Pietro. */
export const ADVANCE_DELETE_EMAILS = ["vitorfilho1976@gmail.com", "pmalvesi61@gmail.com"]
export const canDeleteAdvance = (email?: string | null) => ADVANCE_DELETE_EMAILS.includes(String(email || "").trim().toLowerCase())

/** Cancelar vale até a antecipação ser concluída: aberta (funcionário ainda prestando contas) ou finalizada (aguardando revisão). */
export const canCancelAdvance = (status: string) => status === "Aberto" || status === "Finalizado"

export function statusLabel(status: AdvanceStatus) {
  return { Aberto: "Em andamento", Finalizado: "Aguardando aprovação", Concluido: "Concluído", Cancelado: "Cancelado" }[status]
}

export function receiptStatusLabel(status: ReceiptStatus) {
  return { Enviado: "Enviado", Aprovado: "Aprovado", Contestado: "Contestado" }[status]
}

export const CATEGORY_LABEL: Record<string, string> = {
  Alimentacao: "Alimentação", Combustivel: "Combustível", Hospedagem: "Hospedagem", Transporte: "Transporte", Estacionamento: "Estacionamento", Pedagio: "Pedágio", Outros: "Outros",
}

/** Categorias que podem ganhar um teto dentro do orçamento (mesma ordem em toda a tela). */
export const BUDGETABLE_CATEGORIES = ["Hospedagem", "Alimentacao", "Combustivel", "Transporte", "Estacionamento", "Pedagio", "Outros"] as const
export type CategoryBudgets = Partial<Record<string, number>>

export type CategorySummary = { category: string; budget: number; spent: number; remaining: number; overspent: boolean }

/** Soma dos sub-orçamentos preenchidos: não pode passar do valor total (o resto fica "não dividido", sem teto). */
export function validateCategoryBudgets(total: number, budgets: CategoryBudgets) {
  const sum = Math.round(Object.values(budgets).reduce((acc: number, value) => acc + Number(value || 0), 0) * 100) / 100
  if (sum > total + 0.004) return { ok: false as const, reason: `A soma dos sub-orçamentos (${sum}) passa do valor total do orçamento (${total}).`, sum }
  return { ok: true as const, sum }
}

/** Gasto por categoria, só para as que o financeiro deu um teto: é informativo (não bloqueia o envio de notinhas nem a finalização). */
export function summarizeCategories(budgets: CategoryBudgets, receipts: Array<{ category: string; amount: number }>): CategorySummary[] {
  return BUDGETABLE_CATEGORIES.filter((category) => Number(budgets[category] || 0) > 0).map((category) => {
    const budget = Number(budgets[category] || 0)
    const spent = Math.round(receipts.filter((receipt) => receipt.category === category).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0) * 100) / 100
    const remaining = Math.round((budget - spent) * 100) / 100
    return { category, budget, spent, remaining, overspent: remaining < 0 }
  })
}
