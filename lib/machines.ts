// Máquinas e Equipamentos: regras puras (sem banco, sem React), usadas na tela, na API e nos testes.
// Valores em dinheiro são calculados em centavos inteiros para evitar erro de ponto flutuante.

export const machineStatuses = ["Em operacao", "Em manutencao", "Parada", "Nao informado"] as const
export type MachineStatus = (typeof machineStatuses)[number]
/** Estados que uma pessoa pode escolher ao alterar o status (o neutro só existe até a primeira informação). */
export const selectableStatuses = ["Em operacao", "Em manutencao", "Parada"] as const

export const adminStatuses = ["Ativo", "Inativo", "Baixado"] as const
export type AdminStatus = (typeof adminStatuses)[number]

export const statusMeta: Record<MachineStatus, { label: string; short: string; color: string; soft: string; text: string; icon: "play" | "wrench" | "octagon" | "help" }> = {
  "Em operacao": { label: "Em operação", short: "Operando", color: "#16a34a", soft: "#dcfce7", text: "#166534", icon: "play" },
  "Em manutencao": { label: "Em manutenção", short: "Manutenção", color: "#d97706", soft: "#fef3c7", text: "#92400e", icon: "wrench" },
  Parada: { label: "Parada", short: "Parada", color: "#dc2626", soft: "#fee2e2", text: "#991b1b", icon: "octagon" },
  "Nao informado": { label: "Sem status informado", short: "Sem status", color: "#64748b", soft: "#f1f5f9", text: "#475569", icon: "help" },
}

/** Motivo de parada é registrado à parte: máquina parada por falta de produção não é máquina quebrada. */
export const statusReasons: Record<(typeof selectableStatuses)[number], Array<{ code: string; label: string }>> = {
  "Em operacao": [
    { code: "inicio_producao", label: "Início de produção" }, { code: "retorno_manutencao", label: "Retorno de manutenção" },
    { code: "liberacao_seguranca", label: "Liberação após bloqueio de segurança" }, { code: "outro", label: "Outro" },
  ],
  "Em manutencao": [
    { code: "manutencao_preventiva", label: "Manutenção preventiva" }, { code: "manutencao_corretiva", label: "Manutenção corretiva" },
    { code: "inspecao", label: "Inspeção" }, { code: "outro", label: "Outro" },
  ],
  Parada: [
    { code: "fim_turno", label: "Fim do turno" }, { code: "sem_producao", label: "Sem demanda de produção" }, { code: "falta_operador", label: "Falta de operador" },
    { code: "aguardando_material", label: "Aguardando material" }, { code: "falha_mecanica", label: "Falha mecânica" }, { code: "falha_eletrica", label: "Falha elétrica" },
    { code: "risco_seguranca", label: "Risco de segurança" }, { code: "outro", label: "Outro" },
  ],
}
/** Motivos que indicam quebra/falha (contam como indisponibilidade técnica, ao contrário de parada por produção). */
export const failureReasonCodes = new Set(["falha_mecanica", "falha_eletrica", "risco_seguranca"])

export const orderTypes = ["Preventiva", "Corretiva", "Preditiva", "Inspecao"] as const
export const orderStatuses = ["Aberta", "Aguardando aprovacao", "Em execucao", "Aguardando pecas", "Suspensa", "Concluida", "Cancelada"] as const
export const orderPriorities = ["Baixa", "Media", "Alta", "Urgente"] as const
export const orderLabels: Record<string, string> = { Inspecao: "Inspeção", "Aguardando aprovacao": "Aguardando aprovação", "Em execucao": "Em execução", "Aguardando pecas": "Aguardando peças", Concluida: "Concluída", Media: "Média" }
export const orderLabel = (value: string) => orderLabels[value] || value
export const openOrderStatuses = ["Aberta", "Aguardando aprovacao", "Em execucao", "Aguardando pecas", "Suspensa"]
export const isOpenOrder = (status: string) => openOrderStatuses.includes(status)

export const documentTypes = ["Manual", "Nota fiscal", "Garantia", "Certificado", "Laudo", "Foto", "Relatório", "Outro"]
export const planTypes = ["Preventiva", "Preditiva", "Inspecao"] as const

// ===== Biblioteca de ilustrações =====
export const illustrationLibrary: Array<{ key: string; label: string; keywords: string[] }> = [
  { key: "solda_mig", label: "Máquina de solda MIG/MAG", keywords: ["solda", "mig", "mag", "tig", "eletrodo"] },
  { key: "compressor", label: "Compressor industrial", keywords: ["compressor", "ar comprimido"] },
  { key: "furadeira", label: "Furadeira de bancada", keywords: ["furadeira", "furo", "perfuratriz"] },
  { key: "esmerilhadeira", label: "Esmerilhadeira", keywords: ["esmeril", "lixadeira", "politriz"] },
  { key: "serra", label: "Serra industrial", keywords: ["serra", "fita", "policorte"] },
  { key: "corte", label: "Máquina de corte", keywords: ["corte", "plasma", "guilhotina", "laser", "oxicorte"] },
  { key: "dobradeira", label: "Dobradeira / prensa", keywords: ["dobra", "prensa", "calandra"] },
  { key: "pintura", label: "Equipamento de pintura", keywords: ["pintura", "pistola", "cabine", "estufa"] },
  { key: "generica", label: "Equipamento genérico", keywords: [] },
]
export const illustrationKeys = illustrationLibrary.map((item) => item.key)
export const normalizeIllustration = (key?: string) => (key && illustrationKeys.includes(key) ? key : "generica")

const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
/** Sugere a ilustração pelo nome/categoria/tipo. Sem correspondência clara: genérica (nunca um desenho que possa enganar). */
export function suggestIllustration(...texts: Array<string | undefined>) {
  const haystack = plain(texts.filter(Boolean).join(" "))
  if (!haystack) return "generica"
  const found = illustrationLibrary.find((item) => item.keywords.some((word) => haystack.includes(plain(word))))
  return found?.key || "generica"
}

// ===== Dinheiro (centavos) =====
export const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100)
export const fromCents = (cents: number) => Math.round(cents) / 100
export const sumMoney = (...values: unknown[]) => fromCents(values.reduce<number>((total, value) => total + toCents(value), 0))

// ===== Datas (YYYY-MM-DD, em UTC para não variar com fuso) =====
const pad = (value: number) => String(value).padStart(2, "0")
export const isoDate = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
export const parseDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "")
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
}
export function addDays(value: string, days: number) {
  const date = parseDate(value)
  if (!date) return ""
  date.setUTCDate(date.getUTCDate() + days)
  return isoDate(date)
}
/** Soma meses sem estourar o fim do mês (31/01 + 1 mês = 28/02 ou 29/02). */
export function addMonths(value: string, months: number) {
  const date = parseDate(value)
  if (!date) return ""
  const day = date.getUTCDate()
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return isoDate(target)
}
export const daysBetween = (from: string, to: string) => {
  const a = parseDate(from)
  const b = parseDate(to)
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86400000) : 0
}
/** Meses completos entre duas datas. */
export function monthsBetween(from: string, to: string) {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a || !b || b < a) return 0
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) months -= 1
  return Math.max(0, months)
}

/** "2 d 3 h", "45 min": tempo decorrido para exibir no card. */
export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 1) return "menos de 1 min"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim()
  const days = Math.floor(hours / 24)
  return `${days} d ${hours % 24 ? `${hours % 24} h` : ""}`.trim()
}

// ===== Códigos =====
export const formatMachineCode = (prefix: string, kind: "MAQ" | "EQP", sequence: number) => `${prefix || "ND"}-${kind}-${String(sequence).padStart(6, "0")}`
export const formatOrderNumber = (year: number, sequence: number) => `OM-${year}-${String(sequence).padStart(6, "0")}`
export const machineCodePattern = /^[A-Z0-9]{1,10}-(MAQ|EQP)-\d{6,}$/

// ===== QR Code =====
export const qrTokenPattern = /^[A-Za-z0-9_-]{24,64}$/
export function buildQrUrl(baseUrl: string, token: string) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(base)) throw new Error("Informe a URL base do sistema (https://...) para gerar o QR Code.")
  if (!qrTokenPattern.test(token)) throw new Error("Identificador de QR Code inválido.")
  return `${base}/maquinas/q/${token}`
}

// ===== Depreciação =====
export type DepreciationInput = {
  acquisitionValue: number; freightCost?: number; installationCost?: number; otherCosts?: number; residualValue?: number
  usefulLifeMonths?: number | null; startDate?: string | null; method?: "Linear" | "Nenhum"; adjustments?: number; asOf: string
}
export type DepreciationResult = { baseValue: number; depreciable: number; monthly: number; monthsElapsed: number; accumulated: number; bookValue: number; fullyDepreciated: boolean; applicable: boolean }

/** Depreciação linear contábil: (custo total - residual) / vida útil, por mês completo, com ajustes manuais. Não é valor de mercado. */
export function depreciation(input: DepreciationInput): DepreciationResult {
  const base = toCents(input.acquisitionValue) + toCents(input.freightCost) + toCents(input.installationCost) + toCents(input.otherCosts)
  const residual = Math.min(toCents(input.residualValue), base)
  const depreciable = base - residual
  const life = Number(input.usefulLifeMonths) || 0
  const applicable = (input.method || "Linear") === "Linear" && life > 0 && Boolean(input.startDate) && base > 0
  if (!applicable) return { baseValue: fromCents(base), depreciable: fromCents(depreciable), monthly: 0, monthsElapsed: 0, accumulated: 0, bookValue: fromCents(base), fullyDepreciated: false, applicable: false }
  const months = Math.min(monthsBetween(String(input.startDate), input.asOf), life)
  const linear = Math.round((depreciable * months) / life)
  const accumulated = Math.min(depreciable, Math.max(0, linear + toCents(input.adjustments)))
  return {
    baseValue: fromCents(base), depreciable: fromCents(depreciable), monthly: fromCents(Math.round(depreciable / life)), monthsElapsed: months,
    accumulated: fromCents(accumulated), bookValue: fromCents(base - accumulated), fullyDepreciated: months >= life || accumulated >= depreciable, applicable: true,
  }
}

/** Evolução do valor contábil (um ponto por ano da vida útil + hoje). */
export function bookValueCurve(input: Omit<DepreciationInput, "asOf">, today: string) {
  const points: Array<{ date: string; bookValue: number; accumulated: number }> = []
  if (!input.startDate || !input.usefulLifeMonths) return points
  const years = Math.ceil(input.usefulLifeMonths / 12)
  for (let year = 0; year <= years; year += 1) {
    const date = year === years ? addMonths(input.startDate, input.usefulLifeMonths) : addMonths(input.startDate, year * 12)
    const result = depreciation({ ...input, asOf: date })
    points.push({ date, bookValue: result.bookValue, accumulated: result.accumulated })
  }
  const now = depreciation({ ...input, asOf: today })
  points.push({ date: today, bookValue: now.bookValue, accumulated: now.accumulated })
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

// ===== Planos preventivos =====
export type PlanRule = {
  intervalDays?: number | null; intervalMonths?: number | null; intervalHours?: number | null; fixedDate?: string | null
  combineRule?: "Primeiro" | "Todos"; lastDoneDate?: string | null; lastDoneHours?: number | null; baseDate?: string | null; baseHours?: number | null
}

/** Calcula o próximo vencimento (data e/ou horímetro) a partir da última execução (ou da data-base do plano). */
export function computeNextDue(plan: PlanRule): { dueDate: string; dueHours: number | null } {
  const from = plan.lastDoneDate || plan.baseDate || ""
  const dates: string[] = []
  if (from && plan.intervalDays) dates.push(addDays(from, plan.intervalDays))
  if (from && plan.intervalMonths) dates.push(addMonths(from, plan.intervalMonths))
  if (plan.fixedDate && (!plan.lastDoneDate || plan.fixedDate > plan.lastDoneDate)) dates.push(plan.fixedDate)
  const valid = dates.filter(Boolean).sort()
  const dueDate = valid.length ? ((plan.combineRule || "Primeiro") === "Todos" ? valid[valid.length - 1] : valid[0]) : ""
  const hoursFrom = plan.lastDoneHours ?? plan.baseHours
  const dueHours = plan.intervalHours && hoursFrom != null ? Math.round((Number(hoursFrom) + Number(plan.intervalHours)) * 10) / 10 : null
  return { dueDate, dueHours }
}

export type DueState = "Vencida" | "Proxima" | "Em dia" | "Sem prazo"
export function dueState(due: { dueDate?: string | null; dueHours?: number | null }, today: string, hourMeter: number, opts: { soonDays?: number; soonHours?: number; combineRule?: "Primeiro" | "Todos" } = {}): DueState {
  const soonDays = opts.soonDays ?? 15
  const soonHours = opts.soonHours ?? 20
  const checks: DueState[] = []
  if (due.dueDate) checks.push(due.dueDate < today ? "Vencida" : daysBetween(today, due.dueDate) <= soonDays ? "Proxima" : "Em dia")
  if (due.dueHours != null) checks.push(hourMeter >= due.dueHours ? "Vencida" : due.dueHours - hourMeter <= soonHours ? "Proxima" : "Em dia")
  if (!checks.length) return "Sem prazo"
  if (opts.combineRule === "Todos") {
    if (checks.every((state) => state === "Vencida")) return "Vencida"
    if (checks.some((state) => state === "Vencida" || state === "Proxima")) return "Proxima"
    return "Em dia"
  }
  if (checks.includes("Vencida")) return "Vencida"
  if (checks.includes("Proxima")) return "Proxima"
  return "Em dia"
}

// ===== Status operacional (pré-validação; o banco repete as regras na função machine_change_status) =====
export type StatusCheckInput = {
  adminStatus: AdminStatus; current: MachineStatus; safetyLocked: boolean; to: MachineStatus
  blockingOpenOrders: number; canReleaseSafety: boolean; reason: string
}
export function checkStatusChange(input: StatusCheckInput): string {
  if (!selectableStatuses.includes(input.to as never)) return "Escolha Em operação, Em manutenção ou Parada."
  if (input.adminStatus !== "Ativo") return `Máquina ${input.adminStatus.toLowerCase()}: o status operacional não pode ser alterado.`
  if (input.to === input.current) return "A máquina já está com este status."
  if (!input.reason.trim()) return "Informe o motivo da alteração."
  if (input.to === "Em operacao") {
    if (input.safetyLocked && !input.canReleaseSafety) return "Máquina bloqueada por segurança: só uma liberação autorizada pode colocá-la em operação."
    if (input.blockingOpenOrders > 0) return "Há ordem de manutenção em aberto que impede o uso. Conclua ou cancele a ordem antes de liberar."
  }
  return ""
}

// ===== Manutenção: custos, histórico e indicadores =====
export type OrderLike = {
  status?: string; origin?: string; maintenanceType?: string; performedAt?: string | null; completedAt?: string | null; createdAt?: string | null
  laborCost?: number; partsCost?: number; otherCost?: number; downtimeHours?: number
}
export const orderCost = (order: Pick<OrderLike, "laborCost" | "partsCost" | "otherCost">) => sumMoney(order.laborCost, order.partsCost, order.otherCost)
/** Data efetiva da intervenção: a data real da execução (não a do lançamento no ERP). */
export const effectiveDate = (order: OrderLike) => String(order.performedAt || order.completedAt || "").slice(0, 10)
/** Só conta o que foi concluído e tem data efetiva (ocorrências abertas e canceladas ficam de fora). */
export const isValidDone = (order: OrderLike) => order.status === "Concluida" && order.origin !== "Ocorrencia" && Boolean(effectiveDate(order))
export function lastMaintenanceDate(orders: OrderLike[]) {
  const dates = orders.filter(isValidDone).map(effectiveDate).sort()
  return dates.length ? dates[dates.length - 1] : ""
}
export function totalMaintenanceCost(orders: OrderLike[]) {
  return sumMoney(...orders.filter(isValidDone).map(orderCost))
}
export function costInPeriod(orders: OrderLike[], start: string, end: string) {
  return sumMoney(...orders.filter(isValidDone).filter((order) => effectiveDate(order) >= start && effectiveDate(order) <= end).map(orderCost))
}
/** Custo de manutenção acumulado alto frente ao custo de aquisição (limite em %). */
export function isHighMaintenanceCost(totalMaintenance: number, acquisitionTotal: number, percentLimit: number) {
  if (acquisitionTotal <= 0 || percentLimit <= 0) return false
  return toCents(totalMaintenance) * 100 >= toCents(acquisitionTotal) * percentLimit
}
export function failureCount(orders: OrderLike[], start: string, end: string) {
  return orders.filter((order) => order.maintenanceType === "Corretiva" && order.status !== "Cancelada" && order.origin !== "Ocorrencia" && (effectiveDate(order) || String(order.createdAt || "").slice(0, 10)) >= start && (effectiveDate(order) || String(order.createdAt || "").slice(0, 10)) <= end).length
}

export type StatusHistoryLike = { toStatus: string; startedAt: string; endedAt?: string | null; reasonCode?: string }
/** Horas de indisponibilidade (parada + em manutenção) dentro do período, cortando os trechos nas bordas. */
export function unavailableHours(history: StatusHistoryLike[], startIso: string, endIso: string, nowIso = new Date().toISOString()) {
  const from = Date.parse(startIso)
  const to = Math.min(Date.parse(endIso), Date.parse(nowIso))
  let ms = 0
  for (const row of history) {
    if (row.toStatus !== "Parada" && row.toStatus !== "Em manutencao") continue
    const begin = Math.max(Date.parse(row.startedAt), from)
    const finish = Math.min(row.endedAt ? Date.parse(row.endedAt) : to, to)
    if (finish > begin) ms += finish - begin
  }
  return Math.round((ms / 3600000) * 10) / 10
}

// ===== Horímetro =====
export function validateMeterReading(current: number, reading: number, isCorrection: boolean, note = "") {
  if (!Number.isFinite(reading) || reading < 0) return "Informe uma leitura de horímetro válida."
  if (reading < current && !isCorrection) return `A leitura (${reading} h) é menor que o horímetro atual (${current} h). Se foi um erro de lançamento, marque como correção e justifique.`
  if (reading < current && isCorrection && !note.trim()) return "Informe a justificativa da correção do horímetro."
  return ""
}

// ===== Validações de cadastro =====
export function validateMachine(item: { name?: string; codeKind?: string; manufactureYear?: unknown; acquisitionValue?: unknown; residualValue?: unknown; usefulLifeMonths?: unknown; acquisitionDate?: string; marketValue?: unknown }, today: string) {
  if (!String(item.name || "").trim()) return "Informe o nome da máquina."
  if (item.codeKind && item.codeKind !== "MAQ" && item.codeKind !== "EQP") return "Tipo de código inválido."
  const year = Number(item.manufactureYear) || 0
  if (year && (year < 1900 || year > Number(today.slice(0, 4)) + 1)) return "Ano de fabricação inválido."
  if (Number(item.acquisitionValue) < 0 || Number(item.residualValue) < 0 || Number(item.marketValue) < 0) return "Valores não podem ser negativos."
  if (toCents(item.residualValue) > toCents(item.acquisitionValue) && Number(item.acquisitionValue) > 0) return "O valor residual não pode ser maior que o valor de aquisição."
  if (item.usefulLifeMonths != null && item.usefulLifeMonths !== "" && !(Number(item.usefulLifeMonths) > 0)) return "A vida útil deve ser maior que zero."
  if (item.acquisitionDate && item.acquisitionDate > today) return "A data de aquisição não pode estar no futuro."
  return ""
}

export function validateOrder(item: { description?: string; performedAt?: string; origin?: string; laborHours?: unknown; laborCost?: unknown; partsCost?: unknown; otherCost?: unknown; downtimeHours?: unknown }, today: string) {
  if (!String(item.description || "").trim()) return "Descreva o serviço."
  for (const value of [item.laborHours, item.laborCost, item.partsCost, item.otherCost, item.downtimeHours]) if (Number(value) < 0) return "Custos e horas não podem ser negativos."
  if (item.origin === "Historico") {
    if (!item.performedAt) return "Informe a data em que a manutenção ocorreu."
    if (item.performedAt > today) return "A data da manutenção anterior não pode estar no futuro."
  }
  return ""
}

export type FileKind = { ok: boolean; error?: string }
export const machineFileTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
export const machineFileLimit = 20 * 1024 * 1024
export function validateMachineFile(type: string, size: number): FileKind {
  if (!machineFileTypes.includes(type)) return { ok: false, error: "Envie JPG, PNG, WEBP ou PDF." }
  if (size > machineFileLimit) return { ok: false, error: "Arquivo acima de 20 MB." }
  return { ok: true }
}
