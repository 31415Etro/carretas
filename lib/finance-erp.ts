import type { AccountSourceType, AccountsPayable, AccountsReceivable, FinancialState, PayableStatus, ReceivableStatus } from "@/lib/financial-storage"

export const paymentMethodOptions = ["Pix", "Boleto", "Transferencia", "Dinheiro", "Cartao de credito", "Cartao de debito", "Cheque", "Debito automatico"]

export const accountSourceTypeOptions: AccountSourceType[] = ["Manual", "OS", "Contrato", "Venda", "Compra"]

export const bankAccountTypeOptions = [
  { value: "Corrente", label: "Conta corrente" },
  { value: "Poupanca", label: "Poupança" },
  { value: "Pagamento", label: "Conta de pagamento" },
  { value: "Investimento", label: "Investimento" },
  { value: "Caixa", label: "Caixa (dinheiro)" },
]

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

/** Valor que liquida a conta: original + juros + multa - desconto. */
export function accountSettlementAmount(item: Pick<AccountsPayable, "expectedAmount" | "interestAmount" | "fineAmount" | "discountAmount">) {
  return round2(Number(item.expectedAmount || 0) + Number(item.interestAmount || 0) + Number(item.fineAmount || 0) - Number(item.discountAmount || 0))
}

type AutoStatusInput = { dueDate: string; settledAmount: number; settlementAmount: number; cancelled: boolean; today?: string }

function autoStatus({ dueDate, settledAmount, settlementAmount, cancelled, today = new Date().toISOString().slice(0, 10) }: AutoStatusInput) {
  if (cancelled) return "cancelado" as const
  if (settlementAmount > 0 && settledAmount >= settlementAmount - 0.005) return "quitado" as const
  if (settledAmount > 0) return "parcial" as const
  if (dueDate && dueDate < today) return "vencido" as const
  return "aberto" as const
}

/** Status calculado pelo sistema: aberto, pago, parcial, vencido ou cancelado. */
export function payableAutoStatus(item: AccountsPayable, today?: string): PayableStatus {
  const status = autoStatus({ dueDate: item.dueDate, settledAmount: Number(item.paidAmount || 0), settlementAmount: accountSettlementAmount(item), cancelled: item.status === "Cancelada", today })
  return ({ cancelado: "Cancelada", quitado: "Paga", parcial: "Parcialmente paga", vencido: "Vencida", aberto: "Aberta" } as const)[status]
}

export function receivableAutoStatus(item: AccountsReceivable, today?: string): ReceivableStatus {
  const status = autoStatus({ dueDate: item.dueDate, settledAmount: Number(item.receivedAmount || 0), settlementAmount: accountSettlementAmount(item), cancelled: item.status === "Cancelada", today })
  return ({ cancelado: "Cancelada", quitado: "Recebida", parcial: "Parcialmente recebida", vencido: "Vencida", aberto: "Aberta" } as const)[status]
}

export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function addMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number)
  const target = new Date(Date.UTC(year, (month || 1) - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day || 1, lastDay))
  return target.toISOString().slice(0, 10)
}

export type InstallmentPlan = { number: number; count: number; dueDate: string; amount: number }

/**
 * Divide o valor total em parcelas. Intervalo de 30 dias vira "mesmo dia nos meses
 * seguintes"; outros intervalos são contados em dias. A diferença de centavos fica
 * na última parcela para a soma bater com o total.
 */
export function buildInstallments(total: number, count: number, firstDueDate: string, intervalDays: number): InstallmentPlan[] {
  const installments = Math.max(1, Math.floor(count || 1))
  const amountCents = Math.round((Number(total) || 0) * 100)
  const baseCents = Math.floor(amountCents / installments)
  return Array.from({ length: installments }, (_, index) => {
    const cents = index === installments - 1 ? amountCents - baseCents * (installments - 1) : baseCents
    const dueDate = index === 0 ? firstDueDate : intervalDays === 30 ? addMonths(firstDueDate, index) : addDays(firstDueDate, intervalDays * index)
    return { number: index + 1, count: installments, dueDate, amount: cents / 100 }
  })
}

export function installmentLabel(item: { installmentNumber?: number; installmentCount?: number }) {
  if (!item.installmentCount || item.installmentCount <= 1) return "-"
  return `${String(item.installmentNumber || 1).padStart(2, "0")}/${String(item.installmentCount).padStart(2, "0")}`
}

/** Saldo atual = saldo inicial + entradas realizadas - saídas realizadas na conta. */
export function bankAccountBalance(state: FinancialState, bankAccountId: string) {
  const account = state.bankAccounts.find((item) => item.id === bankAccountId)
  if (!account) return 0
  const since = account.initialBalanceDate || ""
  return round2(state.transactions.reduce((balance, item) => {
    if (item.bankAccountId !== bankAccountId || item.status !== "Realizado") return balance
    if (since && item.realizedDate && item.realizedDate < since) return balance
    const amount = Number(item.realizedAmount || 0)
    return item.type === "Entrada" ? balance + amount : balance - amount
  }, Number(account.initialBalance || 0)))
}

export type DueAlert = { kind: "pagar" | "receber"; id: string; description: string; party: string; dueDate: string; openAmount: number; overdue: boolean }

/** Contas em aberto vencidas ou que vencem nos próximos `days` dias. */
export function dueAlerts(state: FinancialState, clientName: (id: string) => string, days = 7, today = new Date().toISOString().slice(0, 10)): DueAlert[] {
  const limit = addDays(today, days)
  const alerts: DueAlert[] = []
  state.accountsPayable.forEach((item) => {
    if (["Paga", "Cancelada"].includes(payableAutoStatus(item, today)) || !item.dueDate || item.dueDate > limit) return
    alerts.push({ kind: "pagar", id: item.id, description: item.description, party: item.supplierName, dueDate: item.dueDate, openAmount: round2(accountSettlementAmount(item) - Number(item.paidAmount || 0)), overdue: item.dueDate < today })
  })
  state.accountsReceivable.forEach((item) => {
    if (["Recebida", "Cancelada"].includes(receivableAutoStatus(item, today)) || !item.dueDate || item.dueDate > limit) return
    alerts.push({ kind: "receber", id: item.id, description: item.description, party: clientName(item.clientId), dueDate: item.dueDate, openAmount: round2(accountSettlementAmount(item) - Number(item.receivedAmount || 0)), overdue: item.dueDate < today })
  })
  return alerts.sort((left, right) => left.dueDate.localeCompare(right.dueDate))
}
