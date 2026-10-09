import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import * as storage from "./operational-storage.ts"

// Extract the actual page handlers without mounting React or replacing domain logic.
function functionsFrom(path: string, names: string[]) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Map<string, string>()
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(source).replace(/^export\s+/, ""))
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const name of names) assert.ok(found.has(name), `Missing page handler ${name}`)
  return [...found.values()].join("\n")
}
const pagePath = "../components/operations/mvp-pages.tsx"
const handlerNames = ["pmocFrequencyInterval", "dateFromParts", "parseLocalDate", "isoDate", "pmocPlanStartDate", "pmocPlanEndDate", "pmocDateForMonth", "pmocDateForCompetency", "pmocCompetencyValidation", "pmocChecklistIdsFromNotes", "hydratePmocOrderFromType", "ensurePmocWork", "openPmocOrdersForSchedules", "generateCompetencyOrder"]
const code = functionsFrom(pagePath, handlerNames) + "\n" + functionsFrom("../components/operations/shared.tsx", ["names", "appendAudit"])
function handlers(context: Record<string, unknown> = {}) {
  const dependencies = { ...storage, ...context }
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(dependencies), `${js};return {${handlerNames.join(",")}}`)(...Object.values(dependencies))
}
function fixture() {
  const state = storage.defaultOperationalState()
  const plan = { id: "plan", clientId: state.clients[0].id, workId: state.works[0].id, name: "Test plan", frequency: "Mensal", startYear: 2026, startMonth: 1, startDate: "2026-01-01", endDate: "2026-12-31", scheduleDay: 31, status: "Ativo", notes: "", mainProviderId: state.providers[0].id }
  state.pmocPlans = [plan as any]
  state.pmocSectors = [{ id: "sector", planId: plan.id, name: "Test sector" } as any]
  state.pmocEquipment = [0, 1].map((id) => ({ id: `equipment-${id}`, planId: plan.id, sectorId: "sector", name: `Equipment ${id}`, status: "Ativo", clientEnvironmentId: "client-environment", clientEquipmentId: `client-equipment-${id}` } as any))
  state.pmocEquipmentServices = state.pmocEquipment.map((item) => ({ id: `link-${item.id}`, planId: plan.id, equipmentId: item.id, serviceTypeId: state.serviceTypes[0].id } as any))
  state.pmocSchedules = state.pmocEquipment.map((item) => ({ id: `schedule-${item.id}`, planId: plan.id, equipmentId: item.id, serviceTypeId: state.serviceTypes[0].id, year: 2026, month: 2, scheduledDate: "2026-02-28", serviceOrderId: "", status: "Planejado" } as any))
  return { state, plan }
}

test("PMOC clamps month-end dates and checks frequency and contract boundaries", () => {
  const api = handlers()
  assert.equal(api.pmocDateForCompetency("2026-02", 31), "2026-02-28")
  assert.equal(api.pmocDateForCompetency("2024-02", 31), "2024-02-29")
  assert.equal(api.pmocDateForCompetency("2026-13", 10), "")
  const { plan } = fixture()
  assert.equal(api.pmocCompetencyValidation(plan, "2025-12").valid, false)
  assert.equal(api.pmocCompetencyValidation(plan, "2027-01").valid, false)
  for (const [frequency, validMonth, invalidMonth] of [["Bimestral", "03", "02"], ["Trimestral", "04", "02"], ["Semestral", "07", "02"], ["Anual", "01", "02"]]) {
    assert.equal(api.pmocCompetencyValidation({ ...plan, frequency }, `2026-${validMonth}`).valid, true)
    assert.equal(api.pmocCompetencyValidation({ ...plan, frequency }, `2026-${invalidMonth}`).valid, false)
  }
})

test("one competency groups equipment in one OS and repeating does not duplicate it", () => {
  const { state, plan } = fixture()
  const api = handlers()
  const result = api.openPmocOrdersForSchedules(state, plan.id)
  assert.equal(result.count, 1)
  assert.equal(result.state.serviceOrders.length, state.serviceOrders.length + 1)
  const order = result.state.serviceOrders[0]
  assert.equal(order.orderType, "pmoc")
  assert.equal(order.scheduledDate, "2026-02-28")
  assert.equal(order.mainProviderId, plan.mainProviderId)
  assert.ok(result.state.pmocSchedules.every((item: any) => item.serviceOrderId === order.id))
  assert.equal(result.state.checklistItems.filter((item: any) => item.serviceOrderId === order.id).length, state.serviceTypeChecklistItems.length)
  assert.equal(api.openPmocOrdersForSchedules(result.state, plan.id).count, 0)
})

test("a selected schedule set does not open future competencies", () => {
  const { state, plan } = fixture()
  state.pmocSchedules.push({ ...state.pmocSchedules[0], id: "future", month: 3, scheduledDate: "2026-03-31" })
  const result = handlers().openPmocOrdersForSchedules(state, plan.id, new Set(state.pmocSchedules.slice(0, 2).map((item) => item.id)))
  assert.equal(result.count, 1)
  assert.equal(result.state.pmocSchedules.find((item: any) => item.id === "future").serviceOrderId, "")
})

test("generation waits for persistence and never announces success after failure", async () => {
  const { state, plan } = fixture()
  const messages: any[] = []
  let attempted = 0
  const api = handlers({ state, selectedPlan: plan, selectedPlanSchedules: state.pmocSchedules, generationCompetency: "2026-02", toast: (message: any) => messages.push(message), commitConfirmed: async () => { attempted++; return false } })
  await api.generateCompetencyOrder()
  assert.equal(attempted, 1)
  assert.equal(messages.length, 0)
  const already = handlers({ state, selectedPlan: plan, selectedPlanSchedules: [{ ...state.pmocSchedules[0], serviceOrderId: "saved" }], generationCompetency: "2026-02", toast: (message: any) => messages.push(message), commitConfirmed: async () => { throw new Error("Must not persist duplicate") } })
  await already.generateCompetencyOrder()
  assert.equal(messages[0].variant, "destructive")
})

test("labels render four per A4 page and escape data; blocked popups show an error", () => {
  const source = ts.transpileModule(functionsFrom(pagePath, ["printStockLabels"]), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const render = new Function("selectedStockOrders", "window", "toast", `${source};printStockLabels();`)
  const messages: any[] = []
  const orders = Array.from({ length: 760 }, (_, id) => ({ id, workName: '<script>alert("x")</script>', towerName: "Torre", floorName: "Floor", finalName: "Final", environmentName: "Environment", pointName: "Point", kitName: "Kit", infrastructureMeasure: "5m", hasWelding: true, guidePassage: false }))
  let html = ""
  let closed = false
  render(orders, { open: () => ({ document: { write: (value: string) => { html = value }, close: () => { closed = true } } }) }, (message: any) => messages.push(message))
  assert.equal((html.match(/class="label"/g) || []).length, 760)
  assert.equal((html.match(/class="sheet"/g) || []).length, 190)
  assert.ok(closed)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /SIM \[X\]/)
  render(orders, { open: () => null }, (message: any) => messages.push(message))
  assert.equal(messages.at(-1).variant, "destructive")
  render([], { open: () => { throw new Error("Empty selection must not open a window") } }, (message: any) => messages.push(message))
  assert.equal(messages.at(-1).variant, "destructive")
})
