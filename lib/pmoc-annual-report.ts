import type { OperationalState, PmocPlan } from "./operational-storage"
import { compareAlphaNumeric } from "./utils"

export const PMOC_REPORT_PERIODICITIES = [1, 2, 3, 6] as const
export const PMOC_LEGAL_REFERENCE = "Base legal: Lei Federal nº 13.589, de 4 de janeiro de 2018; Portaria do Ministério da Saúde nº 3.523, de 28 de agosto de 1998; Resolução RE/ANVISA nº 9, de 16 de janeiro de 2003."
export const PMOC_CONTRACTOR = {
  name: "M & C CLIMATIZAÇÃO LTDA",
  document: "19.826.201/0001-70",
}
export const PMOC_TECHNICAL_RESPONSIBLE = {
  name: "OSNI RICARDO DE ALMEIDA SERAFIM",
  document: "541.509.659-00",
  registration: "CREA/SC 034926-8",
}
export type PmocReportPeriodicity = (typeof PMOC_REPORT_PERIODICITIES)[number]
export type PmocReportMonthStatus = "OK" | "PENDENTE" | "PROGRAMADO" | "N/A"

export interface PmocAnnualReportFilters {
  clientId: string
  year: number
  periodicities?: number[]
  referenceDate?: string
  referenceMonth?: string
  monthsBack?: number
}

export interface PmocAnnualReportService {
  serviceName: string
  specification: string
  periodicityMonths: PmocReportPeriodicity
  months: PmocReportMonthStatus[]
}

export interface PmocAnnualReportEquipment {
  id: string
  name: string
  tag: string
  environment: string
  capacity: string
  serialNumber: string
  brandModel: string
  services: PmocAnnualReportService[]
}

export interface PmocAnnualReportPlan {
  id: string
  name: string
  startDate: string
  endDate: string
  equipment: PmocAnnualReportEquipment[]
}

export interface PmocAnnualReportClient {
  id: string
  name: string
  document: string
  address: string
  phone: string
  responsibleName: string
  plans: PmocAnnualReportPlan[]
}

export interface PmocAnnualReport {
  company: OperationalState["companySettings"]
  year: number
  periodLabel: string
  generatedAt: string
  months: Array<{ year: number; number: number; label: string }>
  monthsBack: number
  periodicities: PmocReportPeriodicity[]
  clients: PmocAnnualReportClient[]
}

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

const PMOC_ACTIVITY_PERIODICITIES = new Map<string, PmocReportPeriodicity>([
  ["inspecao visual geral do equipamento", 1],
  ["limpeza dos filtros de ar", 1],
  ["limpeza da serpentina do evaporador", 3],
  ["limpeza da serpentina do condensador quando aplicavel", 6],
  ["limpeza da serpentina do condendador quando aplicavel", 6],
  ["limpeza da bandeja de condensado", 3],
  ["limpeza da bandeja do condensado", 3],
  ["limpeza e desobstrucao da tubulacao de drenagem", 3],
  ["verificacao do funcionamento dos ventiladores", 1],
  ["verificacao do funcionamento do compressor", 1],
  ["verificacao das conexoes eletricas", 3],
  ["aperto dos terminais eletricos quando necessario", 3],
  ["medicao da tensao eletrica", 3],
  ["medicao da corrente eletrica", 3],
  ["verificacao da pressao do gas refrigerante quando aplicavel", 3],
  ["verificacao de vazamentos de fluido refrigerante", 3],
  ["verificacao do isolamento termico das tubulacoes", 6],
  ["verificacao do funcionamento do termostato ou controlador", 6],
  ["medicao da temperatura de insuflamento e retorno", 6],
  ["verificacao de ruidos e vibracoes anormais", 3],
  ["teste geral de funcionamento do equipamento", 1],
  ["registro das condicoes encontradas e das acoes executadas", 1],
])

function normalizePeriodicity(value: unknown): PmocReportPeriodicity {
  const months = Number(value)
  return PMOC_REPORT_PERIODICITIES.includes(months as PmocReportPeriodicity) ? months as PmocReportPeriodicity : 1
}

function checklistIdsFromNotes(notes?: string) {
  const line = String(notes || "").split("\n").find((item) => item.startsWith("__pmoc_checklist_ids:"))
  return line ? line.replace("__pmoc_checklist_ids:", "").split(",").map((item) => item.trim()).filter(Boolean) : []
}

function monthIndex(year: number, month: number) {
  return year * 12 + month - 1
}

function monthFromIndex(index: number) {
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  return { year, month }
}

function reportReference(filters: PmocAnnualReportFilters) {
  const raw = String(filters.referenceMonth || filters.referenceDate || `${filters.year}-12`).slice(0, 7)
  const [rawYear, rawMonth] = raw.split("-").map(Number)
  const year = rawYear || filters.year
  const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : 12
  return { year, month, index: monthIndex(year, month) }
}

function reportWindow(filters: PmocAnnualReportFilters) {
  const reference = reportReference(filters)
  const monthsBack = Math.min(48, Math.max(0, Math.floor(Number(filters.monthsBack ?? 11))))
  return Array.from({ length: monthsBack + 1 }, (_, offset) => {
    const value = monthFromIndex(reference.index - monthsBack + offset)
    return { year: value.year, number: value.month, label: MONTH_LABELS[value.month - 1] }
  })
}

function planMonthRange(plan: PmocPlan) {
  const start = String(plan.startDate || `${plan.startYear}-${String(plan.startMonth).padStart(2, "0")}-01`)
  const end = String(plan.endDate || `${plan.startYear}-12-31`)
  const [startYear, startMonth] = start.split("-").map(Number)
  const [endYear, endMonth] = end.split("-").map(Number)
  return {
    start: monthIndex(startYear || plan.startYear, startMonth || plan.startMonth),
    end: monthIndex(endYear || plan.startYear, endMonth || 12),
  }
}

function reportMonthStatus(
  periodicity: PmocReportPeriodicity,
  year: number,
  month: number,
  referenceIndex: number,
): PmocReportMonthStatus {
  const current = monthIndex(year, month)
  const monthsBeforeReference = referenceIndex - current
  if (monthsBeforeReference < 0 || monthsBeforeReference % periodicity !== 0) return "N/A"
  return "OK"
}

function normalizedActivityName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function taskPeriodicity(taskName: string, fallback: PmocReportPeriodicity) {
  const explicitPeriodicity = String(taskName || "").trim().match(/(?:^|\s)(1|2|3|6)\s*(?:mes(?:es)?)?$/i)
  if (explicitPeriodicity) return normalizePeriodicity(explicitPeriodicity[1])
  return PMOC_ACTIVITY_PERIODICITIES.get(normalizedActivityName(taskName)) || fallback
}

function clientAddress(client: OperationalState["clients"][number]) {
  return [client.street, client.number, client.complement, client.district, client.city, client.state].filter(Boolean).join(", ") || "Não informado"
}

export function buildPmocAnnualReport(state: OperationalState, filters: PmocAnnualReportFilters): PmocAnnualReport {
  const requestedPeriodicities = filters.periodicities || [...PMOC_REPORT_PERIODICITIES]
  const periodicities = Array.from(new Set(requestedPeriodicities.map(normalizePeriodicity))).filter((item) => requestedPeriodicities.includes(item))
  const allowedPeriodicities = periodicities.length ? periodicities : [...PMOC_REPORT_PERIODICITIES]
  const reference = reportReference(filters)
  const months = reportWindow(filters)
  const selectedPlans = (state.pmocPlans || []).filter((plan) => {
    if (filters.clientId !== "all" && plan.clientId !== filters.clientId) return false
    const range = planMonthRange(plan)
    return range.start <= reference.index && range.end >= reference.index
  })

  const clientsById = new Map(state.clients.map((item) => [item.id, item]))
  const environmentsById = new Map((state.clientEnvironments || []).map((item) => [item.id, item]))
  const sectorsById = new Map((state.pmocSectors || []).map((item) => [item.id, item]))
  const serviceTypesById = new Map(state.serviceTypes.map((item) => [item.id, item]))
  const equipmentByPlan = new Map<string, OperationalState["pmocEquipment"]>()
  const linksByEquipment = new Map<string, OperationalState["pmocEquipmentServices"]>()
  const tasksByService = new Map<string, OperationalState["serviceTypeChecklistItems"]>()
  const plansByClient = new Map<string, PmocPlan[]>()
  const addGrouped = <T,>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) || []), value])

  selectedPlans.forEach((plan) => addGrouped(plansByClient, plan.clientId, plan))
  ;(state.pmocEquipment || []).forEach((item) => {
    if (item.status === "Ativo") addGrouped(equipmentByPlan, item.planId, item)
  })
  ;(state.pmocEquipmentServices || []).forEach((item) => addGrouped(linksByEquipment, `${item.planId}|${item.equipmentId}`, item))
  state.serviceTypeChecklistItems.forEach((item) => addGrouped(tasksByService, item.serviceTypeId, item))
  tasksByService.forEach((items) => items.sort((left, right) => left.order - right.order))

  const clients = Array.from(plansByClient.entries()).map(([clientId, clientPlanItems]) => {
    const client = clientsById.get(clientId)
    if (!client) return null
    const clientPlans = clientPlanItems.map((plan) => {
      const selectedChecklistIds = new Set(checklistIdsFromNotes(plan.notes))
      const equipment = (equipmentByPlan.get(plan.id) || []).map((item) => {
        const environment = environmentsById.get(item.clientEnvironmentId || "")
        const sector = sectorsById.get(item.sectorId)
        const environmentLabel = environment
          ? [environment.name, environment.floor, environment.location].filter(Boolean).join(" - ")
          : item.location || sector?.name || "Não informado"
        const links = Array.from(new Map((linksByEquipment.get(`${plan.id}|${item.id}`) || []).map((link) => [link.serviceTypeId, link])).values())
        const services = links.flatMap((link) => {
          const serviceType = serviceTypesById.get(link.serviceTypeId)
          if (!serviceType) return []
          const servicePeriodicity = normalizePeriodicity(serviceType.periodicityMonths)
          const allTasks = (tasksByService.get(serviceType.id) || []).filter((task) => !selectedChecklistIds.size || selectedChecklistIds.has(task.id))
          const tasks = allTasks.length ? allTasks : [{ taskName: serviceType.name }]
          return tasks.flatMap((task) => {
            const periodicityMonths = taskPeriodicity(task.taskName, servicePeriodicity)
            if (!allowedPeriodicities.includes(periodicityMonths)) return []
            return [{
              serviceName: serviceType.name,
              specification: task.taskName,
              periodicityMonths,
              months: months.map((reportMonth) => reportMonthStatus(periodicityMonths, reportMonth.year, reportMonth.number, reference.index)),
            }]
          })
        })
        return {
          id: item.id,
          name: item.name || "Equipamento",
          tag: item.tag || "-",
          environment: environmentLabel,
          capacity: item.capacity || "-",
          serialNumber: item.serialNumber || "-",
          brandModel: [item.brand, item.model].filter(Boolean).join(" / ") || "-",
          services,
        }
      }).filter((item) => item.services.length).sort((left, right) => compareAlphaNumeric([left.environment, left.tag, left.name].join(" | "), [right.environment, right.tag, right.name].join(" | ")))
      return { id: plan.id, name: plan.name, startDate: plan.startDate, endDate: plan.endDate, equipment }
    }).filter((plan) => plan.equipment.length).sort((left, right) => compareAlphaNumeric(left.name, right.name))
    if (!clientPlans.length) return null
    return {
      id: client.id,
      name: client.name,
      document: client.document || "Não informado",
      address: clientAddress(client),
      phone: client.phone || client.mobile || "Não informado",
      responsibleName: client.responsibleName || "Não informado",
      plans: clientPlans,
    }
  }).filter(Boolean) as PmocAnnualReportClient[]

  clients.sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }))
  return {
    company: state.companySettings,
    year: reference.year,
    periodLabel: `${MONTH_LABELS[months[0].number - 1]}/${months[0].year} a ${MONTH_LABELS[months[months.length - 1].number - 1]}/${months[months.length - 1].year}`,
    generatedAt: new Date().toISOString(),
    months,
    monthsBack: months.length - 1,
    periodicities: allowedPeriodicities,
    clients,
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function displayDate(value: string) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "Não informado"
}

function statusClass(status: PmocReportMonthStatus) {
  if (status === "OK") return "status-ok"
  if (status === "PENDENTE") return "status-pending"
  if (status === "PROGRAMADO") return "status-planned"
  return "status-na"
}

function periodicityLabel(months: number) {
  return `${months} ${months === 1 ? "MÊS" : "MESES"}`
}

export function renderPmocAnnualReportHtml(report: PmocAnnualReport) {
  const clientLabel = report.clients.length === 1 ? report.clients[0].name : `${report.clients.length} CLIENTES`
  const generatedAt = escapeHtml(new Date(report.generatedAt).toLocaleString("pt-BR"))
  const reportHeading = (title: string) => `<div class="report-heading"><span>${escapeHtml(report.company.name || "M & C Climatização")} · Relatório PMOC</span><strong>${escapeHtml(title)}</strong><span>Gerado em ${generatedAt}</span></div>`
  const legalReference = `<div class="legal-reference">${escapeHtml(PMOC_LEGAL_REFERENCE)}</div>`
  const pageFooter = `<div class="page-footer"><span>${escapeHtml(report.company.name || "M & C Climatização")} · Relatório PMOC</span><span>Gerado em ${generatedAt}</span></div>`
  const identificationPages = report.clients.map((client) => {
    const equipmentRows = client.plans.flatMap((plan) => plan.equipment.map((equipment) => `
      <tr>
        <td>${escapeHtml(plan.name)}</td><td>${escapeHtml(equipment.tag)}</td><td>${escapeHtml(equipment.environment)}</td>
        <td>${escapeHtml(equipment.name)}</td><td>${escapeHtml(equipment.capacity)}</td><td>${escapeHtml(equipment.serialNumber)}</td>
      </tr>`)).join("")
    return `<section class="identification-page">
      ${reportHeading("IDENTIFICAÇÃO DO CLIENTE")}
      <div class="info-grid">
        <div><strong>Cliente:</strong> ${escapeHtml(client.name)}</div>
        <div><strong>CPF/CNPJ:</strong> ${escapeHtml(client.document)}</div>
        <div class="span-2"><strong>Endereço:</strong> ${escapeHtml(client.address)}</div>
        <div><strong>Telefone:</strong> ${escapeHtml(client.phone)}</div>
        <div><strong>Responsável:</strong> ${escapeHtml(client.responsibleName)}</div>
      </div>
      <div class="section-title">PERÍODO E PLANOS DO PMOC</div>
      <table><thead><tr><th>Plano</th><th>Início</th><th>Fim</th><th>Equipamentos</th></tr></thead><tbody>
        ${client.plans.map((plan) => `<tr><td>${escapeHtml(plan.name)}</td><td>${escapeHtml(displayDate(plan.startDate))}</td><td>${escapeHtml(displayDate(plan.endDate))}</td><td>${plan.equipment.length}</td></tr>`).join("")}
      </tbody></table>
      <div class="section-title">RELAÇÃO DOS AMBIENTES E EQUIPAMENTOS</div>
      <table class="equipment-list"><thead><tr><th>Plano</th><th>TAG</th><th>Ambiente</th><th>Equipamento</th><th>Capacidade</th><th>Nº de série</th></tr></thead><tbody>${equipmentRows}</tbody></table>
      ${legalReference}
      ${pageFooter}
    </section>`
  }).join("")

  const monthGroups = Array.from({ length: Math.ceil(report.months.length / 12) }, (_, index) => ({
    start: index * 12,
    months: report.months.slice(index * 12, index * 12 + 12),
  }))
  const equipmentPages = report.clients.flatMap((client) => client.plans.flatMap((plan) => plan.equipment.flatMap((equipment) => monthGroups.map((group) => {
    const rows = equipment.services.map((service) => `<tr>
      <td class="periodicity">${escapeHtml(periodicityLabel(service.periodicityMonths))}</td>
      <td class="service">${escapeHtml(service.serviceName)}</td>
      <td class="specification">${escapeHtml(service.specification)}</td>
      ${service.months.slice(group.start, group.start + group.months.length).map((status) => `<td class="month-status ${statusClass(status)}">${escapeHtml(status)}</td>`).join("")}
    </tr>`).join("")
    const groupLabel = `${group.months[0].label}/${group.months[0].year} a ${group.months[group.months.length - 1].label}/${group.months[group.months.length - 1].year}`
    return `<section class="equipment-page">
      ${reportHeading("CHECKLIST ANUAL DE MANUTENÇÃO PREVENTIVA")}
      <div class="client-line"><span><strong>CLIENTE:</strong> ${escapeHtml(client.name)}</span><span><strong>PERÍODO:</strong> ${escapeHtml(groupLabel)}</span><span><strong>PLANO:</strong> ${escapeHtml(plan.name)}</span></div>
      <table class="equipment-header"><thead><tr><th>EQUIPAMENTO</th><th>TAG</th><th>AMBIENTE</th><th>CAPACIDADE</th><th>Nº DE SÉRIE</th></tr></thead><tbody><tr>
        <td>${escapeHtml([equipment.name, equipment.brandModel].filter((item) => item && item !== "-").join(" - "))}</td>
        <td>${escapeHtml(equipment.tag)}</td><td>${escapeHtml(equipment.environment)}</td><td>${escapeHtml(equipment.capacity)}</td><td>${escapeHtml(equipment.serialNumber)}</td>
      </tr></tbody></table>
      <table class="checklist"><thead><tr><th>PERIODICIDADE</th><th>SERVIÇO</th><th>ESPECIFICAÇÕES</th>${group.months.map((month) => `<th>${escapeHtml(month.label)}/${String(month.year).slice(-2)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="legend"><strong>LEGENDA:</strong> <span class="status-ok">OK = atividade prevista na periodicidade</span> · <span class="status-na">N/A = não aplicável à periodicidade</span></div>
      ${legalReference}
      ${pageFooter}
    </section>`
  })))).join("")

  const signaturePage = `<section class="signature-page">
    ${reportHeading("ASSINATURAS E RESPONSABILIDADES")}
    <div class="signature-summary"><span><strong>RELATÓRIO:</strong> PMOC ${escapeHtml(report.periodLabel)}</span><span><strong>CONTRATADA:</strong> ${escapeHtml(PMOC_CONTRACTOR.name)}</span></div>
    <div class="signature-legend"><strong>LEGENDA:</strong> N/A - NÃO APLICÁVEL</div>
    <div class="signature-grid">
      <div class="signature-block">
        <div class="signature-identity"><strong>${escapeHtml(PMOC_CONTRACTOR.name)}</strong><span>CNPJ: ${escapeHtml(PMOC_CONTRACTOR.document)}</span></div>
        <div class="signature-space"></div>
        <div class="signature-line"></div>
        <strong>${escapeHtml(PMOC_CONTRACTOR.name)}</strong>
        <span>Contratada</span>
      </div>
      <div class="signature-block">
        <div class="signature-identity"><strong>${escapeHtml(PMOC_TECHNICAL_RESPONSIBLE.name)}</strong><span>CPF: ${escapeHtml(PMOC_TECHNICAL_RESPONSIBLE.document)}</span></div>
        <div class="signature-space"></div>
        <div class="signature-line"></div>
        <strong>${escapeHtml(PMOC_TECHNICAL_RESPONSIBLE.name)}</strong>
        <span>Responsável Técnico</span>
        <small>${escapeHtml(PMOC_TECHNICAL_RESPONSIBLE.registration)}</small>
      </div>
    </div>
    ${legalReference}
    ${pageFooter}
  </section>`

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>PMOC ${escapeHtml(clientLabel)} - ${escapeHtml(report.periodLabel)}</title><style>
    @page { size: A4 portrait; margin: 11mm; }
    @page equipment { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1f2937; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
    .cover { min-height: 270mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; break-after: page; }
    .brand-mark { width: 104px; height: 104px; display: grid; place-items: center; border-radius: 52px; background: linear-gradient(145deg,#1d4ed8,#38bdf8); color: white; font-size: 32px; font-weight: 800; margin-bottom: 24px; }
    .cover h1 { max-width: 620px; margin: 0; color: #111827; font-size: 27px; line-height: 1.15; }
    .cover h2 { margin: 18px 0 4px; color: #1d4ed8; font-size: 22px; }
    .cover .company { margin-top: 44px; font-size: 17px; font-weight: 700; }
    .cover .company-details { margin-top: 8px; color: #4b5563; line-height: 1.6; }
    .cover .legal-reference { width: 100%; max-width: 170mm; margin-top: 24px; }
    .identification-page { min-height: 270mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
    .equipment-page { page: equipment; min-height: 185mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
    .signature-page { page: equipment; min-height: 185mm; display: flex; flex-direction: column; page-break-before: always; break-before: page; }
    .report-heading { display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center; gap: 12px; margin-bottom: 6px; font-size: 8px; }
    .report-heading strong { text-align: center; font-size: 13px; }
    .report-heading span:last-child { text-align: right; }
    .section-title { margin: 0 0 7px; padding: 5px 8px; background: #d1d5db; color: #1f2937; font-size: 12px; font-weight: 700; text-align: center; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 14px; border: 1px solid #d1d5db; }
    .info-grid > div { min-height: 28px; padding: 7px; border-right: 1px solid #d1d5db; border-bottom: 1px solid #d1d5db; }
    .info-grid .span-2 { grid-column: span 2; }
    table { width: 100%; margin: 0 0 14px; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { padding: 5px; border: 1px solid #cbd5e1; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef2f7; font-size: 9px; }
    .client-line { display: grid; grid-template-columns: 1.1fr .8fr 1.2fr; gap: 10px; padding: 6px 8px; border: 1px solid #cbd5e1; border-bottom: 0; }
    .equipment-list { font-size: 8px; }
    .equipment-list th, .equipment-list td { padding: 4px; }
    .equipment-header th { font-size: 8px; }
    .equipment-header td { font-size: 9px; font-weight: 600; }
    .checklist { font-size: 7px; }
    .checklist th { padding: 4px 2px; font-size: 6.8px; }
    .checklist td { padding: 4px 2px; }
    .checklist th:nth-child(1), .checklist td:nth-child(1) { width: 6%; }
    .checklist th:nth-child(2), .checklist td:nth-child(2) { width: 9%; }
    .checklist th:nth-child(3), .checklist td:nth-child(3) { width: 15%; }
    .periodicity { font-weight: 700; }
    .service, .specification { text-align: left; }
    .month-status { font-size: 6.5px; font-weight: 700; }
    .status-ok { color: #166534; background: #dcfce7; }
    .status-pending { color: #9a3412; background: #ffedd5; }
    .status-planned { color: #1e40af; background: #dbeafe; }
    .status-na { color: #4b5563; background: #f3f4f6; }
    .legend { margin-top: 7px; padding: 6px; border: 1px solid #cbd5e1; font-size: 8px; }
    .legend span { padding: 2px 4px; }
    .legal-reference { margin-top: 8px; padding: 6px 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #374151; font-size: 7.5px; line-height: 1.35; text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .page-footer { display: flex; justify-content: space-between; gap: 16px; margin-top: auto; padding-top: 5mm; color: #6b7280; font-size: 7px; break-inside: avoid; page-break-inside: avoid; }
    .signature-summary { display: flex; justify-content: space-between; gap: 18px; padding: 7px 9px; border: 1px solid #cbd5e1; font-size: 9px; }
    .signature-legend { margin-top: 8mm; text-align: center; font-size: 9px; }
    .signature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20mm; align-items: end; margin: 20mm 12mm 0; }
    .signature-block { min-width: 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .signature-identity { min-height: 14mm; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; font-size: 10px; }
    .signature-identity strong { font-size: 11px; overflow-wrap: anywhere; }
    .signature-space { height: 28mm; }
    .signature-line { border-top: 1px solid #111827; margin-bottom: 6px; }
    .signature-block > strong, .signature-block > span, .signature-block > small { display: block; }
    .signature-block > strong { font-size: 11px; }
    .signature-block > span { margin-top: 3px; font-size: 10px; }
    .signature-block > small { margin-top: 3px; color: #4b5563; font-size: 8px; }
    .print-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; background: #111827; color: white; font-size: 13px; }
    .print-toolbar button { cursor: pointer; border: 0; border-radius: 6px; background: #2563eb; color: white; padding: 9px 14px; font-weight: 700; }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .print-toolbar { display: none; }
      .cover, .identification-page, .equipment-page, .signature-page { overflow: visible; }
      .signature-page { page-break-after: auto; break-after: auto; }
    }
  </style></head><body>
    <div class="print-toolbar"><span>Relatório pronto. Revise antes de imprimir.</span><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></div>
    <section class="cover"><div class="brand-mark">M&amp;C</div><h1>PLANO DE MANUTENÇÃO, OPERAÇÃO E CONTROLE - PMOC</h1><h2>RELATÓRIO ${escapeHtml(report.periodLabel)}</h2><div class="company">${escapeHtml(report.company.name || "M & C Climatização")}</div><div class="company-details">${escapeHtml(report.company.cnpj)}<br>${escapeHtml(report.company.address)}<br>${escapeHtml([report.company.phone, report.company.email].filter(Boolean).join(" · "))}<br><strong>${escapeHtml(clientLabel)}</strong></div>${legalReference}</section>
    ${identificationPages}${equipmentPages}${signaturePage}
  </body></html>`
}
