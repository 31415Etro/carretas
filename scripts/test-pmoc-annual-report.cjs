const fs = require("fs")
const ts = require("typescript")
const vm = require("vm")

const source = fs.readFileSync("lib/pmoc-annual-report.ts", "utf8")
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const reportModule = {}

vm.runInNewContext(javascript, {
  exports: reportModule,
  module: { exports: reportModule },
  require: () => ({
    compareAlphaNumeric: (left, right) => String(left).localeCompare(String(right), "pt-BR", { numeric: true, sensitivity: "base" }),
  }),
  console,
  Date,
  Map,
  Set,
  Array,
  String,
  Number,
})

const state = {
  companySettings: { name: "M&C" },
  clients: [{ id: "client-1", name: "Cliente Teste", document: "1", street: "Rua A" }],
  clientEnvironments: [{ id: "environment-1", name: "Sala", floor: "1" }],
  pmocSectors: [],
  serviceTypes: [{ id: "service-1", name: "Limpeza", periodicityMonths: 1 }],
  pmocPlans: [{ id: "plan-1", clientId: "client-1", name: "Plano Teste", startYear: 2026, startMonth: 1, startDate: "2026-01-01", endDate: "2026-12-31", notes: "" }],
  pmocEquipment: [{ id: "equipment-1", planId: "plan-1", clientEnvironmentId: "environment-1", status: "Ativo", name: "Split", tag: "T-1", capacity: "12.000 BTU/h", serialNumber: "S1" }],
  pmocEquipmentServices: [{ id: "link-1", planId: "plan-1", equipmentId: "equipment-1", serviceTypeId: "service-1" }],
  serviceTypeChecklistItems: [{ id: "task-1", serviceTypeId: "service-1", taskName: "Limpar filtros", order: 1 }],
  pmocSchedules: [
    { planId: "plan-1", equipmentId: "equipment-1", serviceTypeId: "service-1", year: 2026, month: 1, serviceOrderId: "order-1", status: "OS aberta" },
    { planId: "plan-1", equipmentId: "equipment-1", serviceTypeId: "service-1", year: 2026, month: 2, serviceOrderId: "order-2", status: "OS aberta" },
  ],
  serviceOrders: [{ id: "order-1", status: "Finalizada" }, { id: "order-2", status: "Agendada" }],
  checklistItems: [{ serviceOrderId: "order-2", taskName: "Limpar filtros", status: "Concluido" }],
}

const report = reportModule.buildPmocAnnualReport(state, {
  clientId: "client-1",
  year: 2026,
  periodicities: [1],
  referenceDate: "2026-08-26",
})
const service = report.clients[0].plans[0].equipment[0].services[0]
const html = reportModule.renderPmocAnnualReportHtml(report)

if (service.months.length !== 12) throw new Error("O relatorio nao possui os 12 meses.")
if (service.months[0] !== "OK") throw new Error("OS finalizada nao foi marcada como OK.")
if (service.months[1] !== "OK") throw new Error("Checklist concluido nao foi marcado como OK.")
if (service.months[2] !== "PENDENTE") throw new Error("Competencia passada nao foi marcada como pendente.")
if (service.months[8] !== "PROGRAMADO") throw new Error("Competencia futura nao foi marcada como programada.")
if (!html.includes("Cliente Teste") || !html.includes("Jan/26")) throw new Error("Cabecalho mensal ou cliente ausente.")
if (html.includes('class="cover"')) throw new Error("A capa antiga ainda esta sendo gerada.")

console.log("Relatorio anual PMOC validado:", service.months.join(" | "))
