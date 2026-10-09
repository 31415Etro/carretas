import assert from "node:assert/strict"
import test from "node:test"

import type { OperationalState } from "./operational-storage.ts"
import { buildPmocAnnualReport, PMOC_LEGAL_REFERENCE, renderPmocAnnualReportHtml } from "./pmoc-annual-report.ts"

function stateFixture() {
  const now = "2026-01-01T12:00:00.000Z"
  return {
    companySettings: { name: "M & C Climatização", cnpj: "19.826.201/0001-70", phone: "(47) 3083-0207", email: "contato@mc.com.br", address: "Itajaí - SC", logoName: "", businessHours: "", reportInfo: "" },
    clients: [
      { id: "client-a", name: "Cliente Alfa", document: "11.111.111/0001-11", street: "Rua A", number: "10", complement: "", district: "Centro", city: "Itajaí", state: "SC", phone: "4700000000", mobile: "", email: "", responsibleName: "Ana" },
      { id: "client-b", name: "Cliente Beta", document: "22.222.222/0001-22", street: "Rua B", number: "20", complement: "", district: "Centro", city: "Blumenau", state: "SC", phone: "", mobile: "", email: "", responsibleName: "Beto" },
    ],
    works: [],
    clientEnvironments: [
      { id: "env-a", clientId: "client-a", name: "Sala Técnica", floor: "Térreo", location: "Bloco A" },
      { id: "env-b", clientId: "client-b", name: "Recepção", floor: "Térreo", location: "" },
    ],
    pmocPlans: [
      { id: "plan-a", clientId: "client-a", workId: "", name: "PMOC Alfa", frequency: "Mensal", startMonth: 1, startYear: 2026, startDate: "2026-01-01", endDate: "2026-12-31", status: "Ativo", notes: "__pmoc_checklist_ids:task-monthly,task-quarterly,task-semiannual", createdAt: now, updatedAt: now },
      { id: "plan-b", clientId: "client-b", workId: "", name: "PMOC Beta", frequency: "Mensal", startMonth: 1, startYear: 2026, startDate: "2026-01-01", endDate: "2026-12-31", status: "Ativo", notes: "", createdAt: now, updatedAt: now },
    ],
    pmocSectors: [
      { id: "sector-a", planId: "plan-a", name: "Sala Técnica", floor: "Térreo", notes: "", status: "Ativo", createdAt: now, updatedAt: now },
      { id: "sector-b", planId: "plan-b", name: "Recepção", floor: "Térreo", notes: "", status: "Ativo", createdAt: now, updatedAt: now },
    ],
    pmocEquipment: [
      { id: "eq-a", planId: "plan-a", sectorId: "sector-a", clientEnvironmentId: "env-a", clientEquipmentId: "", tag: "TAG-001", name: "Split", brand: "Marca", model: "X", serialNumber: "SN-123", capacity: "36.000 BTUs", location: "Sala Técnica", status: "Ativo", notes: "", createdAt: now, updatedAt: now },
      { id: "eq-b", planId: "plan-b", sectorId: "sector-b", clientEnvironmentId: "env-b", clientEquipmentId: "", tag: "TAG-002", name: "Cassete", brand: "Marca", model: "Y", serialNumber: "SN-999", capacity: "48.000 BTUs", location: "Recepção", status: "Ativo", notes: "", createdAt: now, updatedAt: now },
    ],
    serviceTypes: [
      { id: "service-monthly", name: "Limpeza mensal", periodicityMonths: 1 },
      { id: "service-quarterly", name: "Revisão trimestral", periodicityMonths: 3 },
    ],
    serviceTypeChecklistItems: [
      { id: "task-monthly", serviceTypeId: "service-monthly", taskName: "Limpeza dos filtros de ar", order: 1 },
      { id: "task-quarterly", serviceTypeId: "service-quarterly", taskName: "Verificação das conexões elétricas", order: 1 },
      { id: "task-semiannual", serviceTypeId: "service-quarterly", taskName: "Verificação do isolamento térmico das tubulações", order: 2 },
    ],
    pmocEquipmentServices: [
      { id: "link-a1", planId: "plan-a", equipmentId: "eq-a", serviceTypeId: "service-monthly", createdAt: now },
      { id: "link-a3", planId: "plan-a", equipmentId: "eq-a", serviceTypeId: "service-quarterly", createdAt: now },
      { id: "link-b1", planId: "plan-b", equipmentId: "eq-b", serviceTypeId: "service-monthly", createdAt: now },
    ],
    pmocSchedules: [
      { id: "schedule-a", planId: "plan-a", equipmentId: "eq-a", serviceTypeId: "service-quarterly", month: 1, year: 2026, scheduledDate: "2026-01-10", serviceOrderId: "order-a", status: "Concluído", createdAt: now, updatedAt: now },
    ],
    serviceOrders: [{ id: "order-a", status: "Finalizada" }],
    checklistItems: [{ id: "check-a", serviceOrderId: "order-a", taskName: "Verificar pressão", status: "Concluída" }],
  } as unknown as OperationalState
}

test("gera relatório anual de um cliente com equipamentos e periodicidades filtradas", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "client-a",
    year: 2026,
    periodicities: [3],
    referenceMonth: "2026-07",
    monthsBack: 13,
  })

  assert.equal(report.clients.length, 1)
  assert.equal(report.clients[0].name, "Cliente Alfa")
  assert.equal(report.periodLabel, "Jun/2025 a Jul/2026")
  assert.deepEqual(report.months.map((month) => `${month.label}/${month.year}`), ["Jun/2025", "Jul/2025", "Ago/2025", "Set/2025", "Out/2025", "Nov/2025", "Dez/2025", "Jan/2026", "Fev/2026", "Mar/2026", "Abr/2026", "Mai/2026", "Jun/2026", "Jul/2026"])

  const equipment = report.clients[0].plans[0].equipment[0]
  assert.deepEqual(
    { tag: equipment.tag, environment: equipment.environment, capacity: equipment.capacity, serialNumber: equipment.serialNumber },
    { tag: "TAG-001", environment: "Sala Técnica - Térreo - Bloco A", capacity: "36.000 BTUs", serialNumber: "SN-123" },
  )
  assert.equal(equipment.services.length, 1)
  assert.equal(equipment.services[0].periodicityMonths, 3)
  assert.equal(equipment.services[0].specification, "Verificação das conexões elétricas")
  assert.deepEqual(equipment.services[0].months, ["N/A", "OK", "N/A", "N/A", "OK", "N/A", "N/A", "OK", "N/A", "N/A", "OK", "N/A", "N/A", "OK"])
})

test("permite gerar o relatório consolidado de todos os clientes", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "all",
    year: 2026,
    periodicities: [1, 2, 3, 6],
    referenceMonth: "2026-07",
  })

  assert.deepEqual(report.clients.map((client) => client.name), ["Cliente Alfa", "Cliente Beta"])
})

test("dois meses retroativos incluem os dois anteriores e a competência", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "client-a",
    year: 2026,
    referenceMonth: "2026-07",
    monthsBack: 2,
  })

  assert.equal(report.periodLabel, "Mai/2026 a Jul/2026")
  const services = report.clients[0].plans[0].equipment[0].services
  const monthly = services.find((service) => service.periodicityMonths === 1)
  const quarterly = services.find((service) => service.periodicityMonths === 3)
  const semiannual = services.find((service) => service.periodicityMonths === 6)
  assert.deepEqual(monthly?.months, ["OK", "OK", "OK"])
  assert.deepEqual(quarterly?.months, ["N/A", "N/A", "OK"])
  assert.deepEqual(semiannual?.months, ["N/A", "N/A", "OK"])
})

test("permite gerar somente a competência atual", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "client-a",
    year: 2026,
    referenceMonth: "2026-07",
    monthsBack: 0,
  })

  assert.equal(report.monthsBack, 0)
  assert.equal(report.periodLabel, "Jul/2026 a Jul/2026")
  assert.deepEqual(report.months, [{ year: 2026, number: 7, label: "Jul" }])
  for (const service of report.clients[0].plans[0].equipment[0].services) {
    assert.deepEqual(service.months, ["OK"])
  }
})

test("renderiza capa, identificação, máquinas e checklist pronto para imprimir em PDF", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "client-a",
    year: 2026,
    periodicities: [1, 2, 3, 6],
    referenceMonth: "2026-07",
    monthsBack: 11,
  })
  const html = renderPmocAnnualReportHtml(report)

  for (const expected of [
    "PLANO DE MANUTENÇÃO, OPERAÇÃO E CONTROLE - PMOC",
    "IDENTIFICAÇÃO DO CLIENTE",
    "RELAÇÃO DOS AMBIENTES E EQUIPAMENTOS",
    "CHECKLIST ANUAL DE MANUTENÇÃO PREVENTIVA",
    "Ago/2025 a Jul/2026",
    "PERIODICIDADE",
    "TAG",
    "AMBIENTE",
    "CAPACIDADE",
    "Nº DE SÉRIE",
    "Verificação das conexões elétricas",
    "Jul/26",
    PMOC_LEGAL_REFERENCE,
    "ASSINATURAS E RESPONSABILIDADES",
    "M &amp; C CLIMATIZAÇÃO LTDA",
    "19.826.201/0001-70",
    "OSNI RICARDO DE ALMEIDA SERAFIM",
    "541.509.659-00",
    "CREA/SC 034926-8",
    "Responsável Técnico",
    "Contratada",
  ]) assert.match(html, new RegExp(expected))

  assert.doesNotMatch(html, /\.footer\s*\{[^}]*position:\s*fixed/)
  assert.match(html, /class="page-footer"/)
  assert.match(html, /break-inside:\s*avoid/)
  assert.match(html, /class="signature-page"/)
  assert.ok(html.lastIndexOf('class="signature-page"') > html.lastIndexOf('class="equipment-page"'))
  assert.equal((html.match(/class="signature-block"/g) || []).length, 2)
})

test("abre uma prévia e só imprime quando o usuário solicitar", () => {
  const report = buildPmocAnnualReport(stateFixture(), {
    clientId: "client-a",
    year: 2026,
    periodicities: [1, 2, 3, 6],
    referenceMonth: "2026-07",
  })
  const html = renderPmocAnnualReportHtml(report)

  assert.match(html, /Imprimir \/ Salvar PDF/)
  assert.doesNotMatch(html, /window\.onload/)
})

test("indexa cronogramas em vez de percorrer a lista para cada célula", () => {
  const base = stateFixture() as any
  const equipment = Array.from({ length: 30 }, (_, index) => ({
    ...base.pmocEquipment[0],
    id: `eq-${index}`,
    clientEnvironmentId: `env-${index}`,
  }))
  const environments = equipment.map((item, index) => ({ ...base.clientEnvironments[0], id: item.clientEnvironmentId, name: `Ambiente ${index}` }))
  const links = equipment.flatMap((item) => base.serviceTypes.map((service: any) => ({
    id: `link-${item.id}-${service.id}`,
    planId: "plan-a",
    equipmentId: item.id,
    serviceTypeId: service.id,
    createdAt: base.pmocPlans[0].createdAt,
  })))
  let scheduleReads = 0
  const schedules = equipment.flatMap((item) => base.serviceTypes.flatMap((service: any) => Array.from({ length: 12 }, (_, monthIndex) => new Proxy({
    id: `schedule-${item.id}-${service.id}-${monthIndex + 1}`,
    planId: "plan-a",
    equipmentId: item.id,
    serviceTypeId: service.id,
    month: monthIndex + 1,
    year: 2026,
    scheduledDate: `2026-${String(monthIndex + 1).padStart(2, "0")}-10`,
    serviceOrderId: "",
    status: "Planejado",
    createdAt: base.pmocPlans[0].createdAt,
    updatedAt: base.pmocPlans[0].updatedAt,
  }, {
    get(target, property, receiver) {
      if (property === "planId") scheduleReads += 1
      return Reflect.get(target, property, receiver)
    },
  }))))

  buildPmocAnnualReport({
    ...base,
    clients: [base.clients[0]],
    clientEnvironments: environments,
    pmocPlans: [base.pmocPlans[0]],
    pmocSectors: [base.pmocSectors[0]],
    pmocEquipment: equipment,
    pmocEquipmentServices: links,
    pmocSchedules: schedules,
    serviceOrders: [],
    checklistItems: [],
  }, {
    clientId: "client-a",
    year: 2026,
    periodicities: [1, 2, 3, 6],
    referenceDate: "2026-06-15",
  })

  assert.ok(scheduleReads < schedules.length * 3, `cronogramas foram percorridos excessivamente: ${scheduleReads} leituras`)
})
