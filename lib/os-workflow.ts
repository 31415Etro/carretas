// Fluxo da Ordem de Serviço (ERP Carretas): situações, transições e valores.

export const osFlow = ["Aberta", "Em análise", "Aguardando orçamento", "Aguardando aprovação", "Aguardando peças", "Em execução", "Em conferência", "Concluída", "Entregue"] as const
export const osSideStatuses = ["Suspensa", "Cancelada"] as const
export const osStatuses = [...osFlow, ...osSideStatuses] as const
export type OsStatus = (typeof osStatuses)[number]

export const osKinds = ["Manutenção preventiva", "Manutenção corretiva", "Reparo", "Instalação", "Fabricação", "Montagem", "Reforma", "Garantia", "Inspeção / vistoria", "Outro"]
export const osPriorities = ["Baixa", "Media", "Alta", "Urgente"]

/** Situações que contam como serviço terminado (inclui as do sistema anterior). */
export const finishedStatuses = new Set(["Concluída", "Entregue", "Finalizada", "Finalizada parcialmente"])
export const cancelledStatuses = new Set(["Cancelada"])
/** Situações do fluxo anterior, mantidas para OS já gravadas e tratadas como "Aberta" no fluxo novo. */
const legacyOpen = new Set(["Criada", "Agendada", "A caminho", "Em execucao", "Pausada", "Aguardando material", "Aguardando retorno"])

export function flowIndex(status: string) {
  return (osFlow as readonly string[]).indexOf(legacyOpen.has(status) ? "Aberta" : status)
}

export type TransitionInput = {
  from: string
  to: string
  reason?: string
  suspendedFrom?: string
  technicianId?: string
  executedServices: number
  servicesSummary?: string
}

/** Mensagem de erro ou "" se a mudança de situação é permitida. */
export function validateTransition(input: TransitionInput) {
  const { from, to } = input
  if (!(osStatuses as readonly string[]).includes(to)) return `Situação inválida: ${to}.`
  if (from === to) return "A OS já está nesta situação."
  if (from === "Entregue") return "OS entregue não muda de situação."
  if (from === "Cancelada") return "OS cancelada não pode ser reaberta."
  if ((to === "Cancelada" || to === "Suspensa") && !String(input.reason || "").trim()) return `Informe o motivo para ${to === "Cancelada" ? "cancelar" : "suspender"}.`
  if (to === "Cancelada") return from === "Concluída" ? "OS concluída não pode ser cancelada; reabra para execução antes." : ""
  if (to === "Suspensa") return from === "Concluída" ? "OS concluída não pode ser suspensa." : ""
  if (from === "Suspensa") return input.suspendedFrom && to !== input.suspendedFrom && flowIndex(to) > flowIndex(input.suspendedFrom) + 1
    ? `Ao retomar, volte para ${input.suspendedFrom} ou uma etapa anterior.`
    : checkConclusion(input)
  const fromIndex = flowIndex(from)
  const toIndex = flowIndex(to)
  if (fromIndex < 0) return `Situação atual desconhecida: ${from}.`
  if (to === "Entregue" && from !== "Concluída") return "Só é possível entregar uma OS concluída."
  if (from === "Concluída" && !["Entregue", "Em execução", "Em conferência"].includes(to)) return "OS concluída só pode ser entregue ou reaberta para execução/conferência."
  if (from === "Concluída" && to !== "Entregue" && !String(input.reason || "").trim()) return "Informe o motivo para reabrir a OS concluída."
  if (toIndex < fromIndex - 1 && from !== "Concluída") return "Só é possível voltar uma etapa por vez."
  return checkConclusion(input)
}

function checkConclusion(input: TransitionInput) {
  if (input.to !== "Concluída") return ""
  if (!input.technicianId) return "Defina o responsável técnico antes de concluir."
  if (!input.executedServices && !String(input.servicesSummary || "").trim()) return "Registre os serviços executados antes de concluir."
  return ""
}

/** Próximas situações oferecidas na tela. */
export function nextStatuses(status: string, suspendedFrom?: string): OsStatus[] {
  if (status === "Entregue" || status === "Cancelada") return []
  if (status === "Suspensa") return osFlow.filter((item) => !suspendedFrom || flowIndex(item) <= flowIndex(suspendedFrom)) as unknown as OsStatus[]
  if (status === "Concluída") return ["Entregue", "Em conferência", "Em execução"]
  const index = Math.max(flowIndex(status), 0)
  const forward = osFlow.filter((_, position) => position > index && position < osFlow.indexOf("Entregue")) as unknown as OsStatus[]
  const back = index > 0 ? [osFlow[index - 1]] : []
  return [...forward, ...back, "Suspensa", "Cancelada"] as OsStatus[]
}

export type OsServiceLine = { quantity: number; unitPrice: number; executed?: boolean }
export type OsMaterialLine = { quantity: number; unitPrice: number; unitCost: number }
export type OsTimeEntry = { hours: number; hourlyCost: number }

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

/** Valores da OS: mão de obra (serviços), materiais, desconto, total, custo e margem. */
export function osTotals(services: OsServiceLine[], materials: OsMaterialLine[], timeEntries: OsTimeEntry[], discount: number) {
  const labor = round2(services.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0))
  const materialsValue = round2(materials.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0))
  const total = round2(Math.max(0, labor + materialsValue - Number(discount || 0)))
  const hours = round2(timeEntries.reduce((sum, item) => sum + Number(item.hours || 0), 0))
  const laborCost = round2(timeEntries.reduce((sum, item) => sum + Number(item.hours || 0) * Number(item.hourlyCost || 0), 0))
  const materialsCost = round2(materials.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0))
  const cost = round2(laborCost + materialsCost)
  return { labor, materials: materialsValue, discount: round2(discount), total, hours, laborCost, materialsCost, cost, margin: round2(total - cost), marginPercent: total > 0 ? round2(((total - cost) / total) * 100) : null }
}

export function validateDiscount(discount: number, subtotal: number, authorizedBy: string) {
  if (discount < 0) return "Desconto não pode ser negativo."
  if (discount > subtotal) return "Desconto maior que o valor da OS."
  if (discount > 0 && !authorizedBy.trim()) return "Informe quem autorizou o desconto."
  return ""
}
