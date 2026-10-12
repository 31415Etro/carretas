// Regras do módulo Contratos: validação, situação, competências de cobrança, reajuste,
// cronograma de OS e alertas de vencimento. Funções puras (testáveis).

export const contractTypes = ["Prestação de serviços", "Fornecimento", "Manutenção recorrente", "Comercial / venda", "Outro"] as const
export const contractStatuses = ["Rascunho", "Aguardando assinatura", "Vigente", "Suspenso", "Encerrado", "Rescindido", "Cancelado"] as const
export const contractDirections = [
  { value: "Receita", label: "Receita — a empresa é a contratada e o cliente é o contratante" },
  { value: "Despesa", label: "Despesa — a empresa é a contratante e o fornecedor é a contratada" },
] as const
export const billingPeriodicities = { Mensal: 1, Bimestral: 2, Trimestral: 3, Semestral: 6, Anual: 12 } as const
export const adjustmentIndexes = ["Nenhum", "IPCA", "IGP-M", "INPC", "Percentual fixo", "Outro"] as const
export const amendmentKinds = ["Aditivo de valor", "Aditivo de prazo", "Reajuste", "Renovação", "Alteração de escopo", "Outro"] as const
export const documentKinds = ["Contrato assinado", "Aditivo", "Evidência de aceite", "Rescisão", "Outro"] as const
export const osPeriodicities = ["Semanal", "Quinzenal", "Mensal", "Bimestral", "Trimestral", "Semestral", "Anual"] as const
export const finalStatuses = new Set(["Encerrado", "Rescindido", "Cancelado"])

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export type ContractInput = {
  contractType: string
  direction: string
  title: string
  clientId: string
  supplierId: string
  signedDate: string
  startDate: string
  endDate: string
  indefinite: boolean
  totalValue: number
  recurringValue: number
  billingPeriodicity: string
  dueDay: number
  paymentMethod: string
  adjustmentIndex: string
  adjustmentPercent: number
  noticeDays: number
  autoRenew: boolean
  renewalMonths: number
  scope: string
  sla: string
  responsibleName: string
  status: string
}

export const isRecurring = (input: Pick<ContractInput, "contractType" | "recurringValue">) => input.contractType === "Manutenção recorrente" || Number(input.recurringValue) > 0

/** Mensagem de erro ou "" quando o contrato pode ser salvo. */
export function validateContract(input: ContractInput, today = new Date().toISOString().slice(0, 10)) {
  if (!(contractTypes as readonly string[]).includes(input.contractType)) return "Informe o tipo de contrato."
  if (input.direction !== "Receita" && input.direction !== "Despesa") return "Informe se é contrato de receita (cliente) ou de despesa (fornecedor)."
  if (!input.title.trim()) return "Informe o título / objeto."
  if (input.direction === "Receita" && !input.clientId) return "Informe o contratante (cliente)."
  if (input.direction === "Despesa" && !input.supplierId) return "Informe a contratada (fornecedor)."
  if (!input.startDate) return "Informe o início da vigência."
  if (!input.indefinite && !input.endDate) return "Informe o término ou marque o contrato como prazo indeterminado."
  if (input.endDate && input.endDate < input.startDate) return "O término não pode ser anterior ao início."
  if (input.signedDate && input.signedDate > today) return "A data de assinatura não pode ser futura."
  if (!(Number(input.totalValue) > 0)) return "Informe o valor total."
  if (!input.paymentMethod.trim()) return "Informe a forma de pagamento."
  if (!input.scope.trim()) return "Descreva o escopo contratado."
  if (!input.responsibleName.trim()) return "Informe o responsável interno."
  if (!(contractStatuses as readonly string[]).includes(input.status)) return "Informe o status contratual."
  if (isRecurring(input)) {
    if (!(Number(input.recurringValue) > 0)) return "Contrato recorrente exige o valor mensal/recorrente."
    if (!(input.billingPeriodicity in billingPeriodicities)) return "Informe a periodicidade de cobrança."
    if (!(Number(input.dueDay) >= 1 && Number(input.dueDay) <= 31)) return "Informe o dia de vencimento (1 a 31)."
  }
  if (input.contractType === "Manutenção recorrente" && !input.sla.trim()) return "Contrato de manutenção exige o SLA / nível de serviço."
  if (input.adjustmentIndex === "Percentual fixo" && !(Number(input.adjustmentPercent) > 0)) return "Informe o percentual fixo de reajuste."
  if (!(adjustmentIndexes as readonly string[]).includes(input.adjustmentIndex)) return "Índice de reajuste inválido."
  if (Number(input.noticeDays) < 0) return "O aviso prévio não pode ser negativo."
  if (input.autoRenew && !(Number(input.renewalMonths) > 0)) return "Renovação automática exige o prazo da renovação em meses."
  return ""
}

/** Mudanças de situação. Vigente exige assinatura (data e documento/evidência). */
export function validateContractTransition(from: string, to: string, ctx: { signedDate?: string; hasSignature: boolean; reason?: string }) {
  if (finalStatuses.has(from)) return `Contrato ${from.toLowerCase()} não muda de situação.`
  if (from === to) return "O contrato já está nesta situação."
  const allowed: Record<string, string[]> = {
    Rascunho: ["Aguardando assinatura", "Vigente", "Cancelado"],
    "Aguardando assinatura": ["Vigente", "Rascunho", "Cancelado"],
    Vigente: ["Suspenso", "Encerrado", "Rescindido"],
    Suspenso: ["Vigente", "Encerrado", "Rescindido"],
  }
  if (!allowed[from]?.includes(to)) return `Não é possível passar de ${from} para ${to}.`
  if (to === "Vigente") {
    if (!ctx.signedDate) return "Informe a data de assinatura para tornar o contrato vigente."
    if (!ctx.hasSignature) return "Anexe o contrato assinado ou a evidência de aceite antes de tornar o contrato vigente."
  }
  if (["Suspenso", "Rescindido", "Cancelado"].includes(to) && !String(ctx.reason || "").trim()) return `Informe o motivo para ${to === "Suspenso" ? "suspender" : to === "Rescindido" ? "rescindir" : "cancelar"}.`
  return ""
}

// ---------------- Datas

export function addDays(base: string, days: number) {
  const date = new Date(`${base}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Soma meses mantendo o dia (limitado ao último dia do mês de destino). */
export function addMonths(base: string, months: number) {
  const [year, month, day] = base.split("-").map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

const clampDay = (year: number, monthIndex: number, day: number) => {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last))).toISOString().slice(0, 10)
}

/** Vencimento do período: dia de vencimento no mês do início; se cair antes do início, no mês seguinte. */
export function dueDateFor(periodStart: string, dueDay: number) {
  const [year, month] = periodStart.split("-").map(Number)
  const sameMonth = clampDay(year, month - 1, dueDay)
  return sameMonth >= periodStart ? sameMonth : clampDay(year, month, dueDay)
}

export type ValueStep = { from: string; value: number }

/** Valor vigente na competência: último degrau (aditivo/reajuste) com início até a competência. */
export function valueAt(competence: string, initialValue: number, steps: ValueStep[]) {
  const applicable = steps.filter((step) => step.from <= competence).sort((a, b) => a.from.localeCompare(b.from))
  return round2(applicable.length ? applicable[applicable.length - 1].value : initialValue)
}

export type BillingContract = {
  status: string
  startDate: string
  endDate: string
  billingStartDate: string
  billingPeriodicity: string
  dueDay: number
  billingAdvanceDays: number
  initialRecurringValue: number
}

/**
 * Competências a cobrar: períodos (a partir do início, pela periodicidade) cujo vencimento cai até
 * `hoje + antecedência`, que começam até o término e ainda não foram lançadas. Só contratos vigentes.
 */
export function pendingCompetences(contract: BillingContract, steps: ValueStep[], alreadyBilled: string[], today: string) {
  if (contract.status !== "Vigente") return []
  const months = billingPeriodicities[contract.billingPeriodicity as keyof typeof billingPeriodicities]
  if (!months || !contract.startDate || !(contract.dueDay >= 1)) return []
  const firstBillable = contract.billingStartDate && contract.billingStartDate > contract.startDate ? contract.billingStartDate : contract.startDate
  const limit = addDays(today, contract.billingAdvanceDays)
  const done = new Set(alreadyBilled)
  const result: Array<{ competence: string; periodEnd: string; dueDate: string; amount: number }> = []
  for (let index = 0; index < 1200; index++) {
    const start = addMonths(contract.startDate, index * months)
    if (contract.endDate && start > contract.endDate) break
    const due = dueDateFor(start, contract.dueDay)
    if (due > limit) break
    if (start < firstBillable || done.has(start)) continue
    const nextStart = addMonths(contract.startDate, (index + 1) * months)
    const periodEnd = addDays(nextStart, -1)
    const amount = valueAt(start, contract.initialRecurringValue, steps)
    if (amount > 0) result.push({ competence: start, periodEnd: contract.endDate && periodEnd > contract.endDate ? contract.endDate : periodEnd, dueDate: due, amount })
  }
  return result
}

/** Reajuste por percentual: novo valor recorrente. */
export const adjustedValue = (current: number, percent: number) => round2(Number(current) * (1 + Number(percent) / 100))

/** Próximo reajuste: 12 meses após o último reajuste (ou o início). */
export const nextAdjustment = (reference: string) => addMonths(reference, 12)

// ---------------- Cronograma de OS

const osStep: Record<string, { days?: number; months?: number }> = {
  Semanal: { days: 7 }, Quinzenal: { days: 15 }, Mensal: { months: 1 }, Bimestral: { months: 2 }, Trimestral: { months: 3 }, Semestral: { months: 6 }, Anual: { months: 12 },
}

export function advanceRun(date: string, periodicity: string) {
  const step = osStep[periodicity]
  if (!step) return date
  return step.days ? addDays(date, step.days) : addMonths(date, step.months!)
}

export type OsPlanLike = { periodicity: string; nextRunDate: string; leadDays: number; active: boolean }

/** Datas de OS a abrir agora: execução prevista menos antecedência já chegou e o contrato ainda vale. */
export function dueRuns(plan: OsPlanLike, contract: { status: string; endDate: string }, today: string, max = 12) {
  if (!plan.active || contract.status !== "Vigente") return []
  const runs: string[] = []
  let date = plan.nextRunDate
  while (runs.length < max && addDays(date, -plan.leadDays) <= today) {
    if (contract.endDate && date > contract.endDate) break
    runs.push(date)
    date = advanceRun(date, plan.periodicity)
  }
  return runs
}

// ---------------- Alertas

export type AlertContract = {
  id: string
  number: string
  title: string
  status: string
  endDate: string
  noticeDays: number
  autoRenew: boolean
  nextAdjustmentDate: string
  responsibleName: string
  responsibleEmail: string
  hasSignature: boolean
}
export type AlertObligation = { contractId: string; kind: string; title: string; dueDate: string; status: string }
export type ContractAlert = { key: string; contractId: string; contractNumber: string; title: string; kind: string; message: string; dueDate: string; overdue: boolean; responsibleName: string; responsibleEmail: string }

/** Reajuste (60 dias), prazo de aviso/renovação (30), encerramento (30), obrigações e documentos pendentes (15) e vigente sem assinatura. */
export function contractAlerts(contracts: AlertContract[], obligations: AlertObligation[], today: string): ContractAlert[] {
  const alerts: ContractAlert[] = []
  for (const contract of contracts) {
    if (finalStatuses.has(contract.status)) continue
    const base = { contractId: contract.id, contractNumber: contract.number, title: contract.title, responsibleName: contract.responsibleName, responsibleEmail: contract.responsibleEmail }
    if (contract.status === "Vigente" && !contract.hasSignature) alerts.push({ ...base, key: "sem-assinatura", kind: "Documento pendente", message: "Contrato vigente sem o contrato assinado ou evidência de aceite anexados.", dueDate: "", overdue: true })
    if (contract.status === "Vigente" && contract.nextAdjustmentDate && contract.nextAdjustmentDate <= addDays(today, 60)) {
      alerts.push({ ...base, key: `reajuste:${contract.nextAdjustmentDate}`, kind: "Reajuste", message: `Reajuste previsto para ${contract.nextAdjustmentDate.split("-").reverse().join("/")}.`, dueDate: contract.nextAdjustmentDate, overdue: contract.nextAdjustmentDate < today })
    }
    if (contract.status === "Vigente" && contract.endDate) {
      const noticeDate = addDays(contract.endDate, -contract.noticeDays)
      if (contract.noticeDays > 0 && noticeDate <= addDays(today, 30) && contract.endDate >= today) {
        alerts.push({ ...base, key: `aviso:${contract.endDate}`, kind: "Renovação / aviso prévio", message: `${contract.autoRenew ? "Renova automaticamente" : "Encerra"} em ${contract.endDate.split("-").reverse().join("/")}; prazo de aviso prévio (${contract.noticeDays} dias) ${noticeDate < today ? "venceu" : `vence em ${noticeDate.split("-").reverse().join("/")}`}.`, dueDate: noticeDate, overdue: noticeDate < today })
      }
      if (contract.endDate <= addDays(today, 30)) {
        alerts.push({ ...base, key: `encerramento:${contract.endDate}`, kind: "Encerramento", message: contract.endDate < today ? `Vigência terminou em ${contract.endDate.split("-").reverse().join("/")}: encerre, renove ou aplique aditivo.` : `Vigência termina em ${contract.endDate.split("-").reverse().join("/")}.`, dueDate: contract.endDate, overdue: contract.endDate < today })
      }
    }
  }
  const byId = new Map(contracts.map((contract) => [contract.id, contract]))
  for (const item of obligations) {
    const contract = byId.get(item.contractId)
    if (!contract || finalStatuses.has(contract.status) || item.status !== "Pendente" || !item.dueDate || item.dueDate > addDays(today, 15)) continue
    alerts.push({ key: `obrigacao:${item.title}:${item.dueDate}`, contractId: contract.id, contractNumber: contract.number, title: contract.title, kind: item.kind === "Documento" ? "Documento pendente" : "Obrigação", message: `${item.title} — ${item.dueDate < today ? "venceu" : "vence"} em ${item.dueDate.split("-").reverse().join("/")}.`, dueDate: item.dueDate, overdue: item.dueDate < today, responsibleName: contract.responsibleName, responsibleEmail: contract.responsibleEmail })
  }
  return alerts.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
}
