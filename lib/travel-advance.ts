// Orçamento de viagem: orçamento de gasto para um funcionário, prestado por um link público (sem login) onde ele
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

/** O orçamento de viagem está pronto para o financeiro marcar como concluído? Nenhuma nota pendente nem contestada, e (se sobrou saldo) a devolução já foi resolvida. */
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

export function statusLabel(status: AdvanceStatus) {
  return { Aberto: "Em andamento", Finalizado: "Aguardando aprovação", Concluido: "Concluído", Cancelado: "Cancelado" }[status]
}

export function receiptStatusLabel(status: ReceiptStatus) {
  return { Enviado: "Enviado", Aprovado: "Aprovado", Contestado: "Contestado" }[status]
}

export const CATEGORY_LABEL: Record<string, string> = {
  Alimentacao: "Alimentação", Combustivel: "Combustível", Hospedagem: "Hospedagem", Transporte: "Transporte", Estacionamento: "Estacionamento", Pedagio: "Pedágio", Outros: "Outros",
}
