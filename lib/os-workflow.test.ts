import assert from "node:assert/strict"
import test from "node:test"

import { nextStatuses, osTotals, validateDiscount, validateTransition } from "./os-workflow.ts"

const base = { technicianId: "t1", executedServices: 1 }

test("avança pelo fluxo, inclusive pulando etapas, e volta uma por vez", () => {
  assert.equal(validateTransition({ ...base, from: "Aberta", to: "Em análise" }), "")
  assert.equal(validateTransition({ ...base, from: "Aberta", to: "Em execução" }), "")
  assert.equal(validateTransition({ ...base, from: "Em execução", to: "Aguardando peças" }), "")
  assert.match(validateTransition({ ...base, from: "Em execução", to: "Em análise" }), /uma etapa/)
  assert.equal(validateTransition({ ...base, from: "Agendada", to: "Em execução" }), "")
})

test("cancelar e suspender exigem motivo", () => {
  assert.match(validateTransition({ ...base, from: "Em execução", to: "Cancelada" }), /motivo/)
  assert.equal(validateTransition({ ...base, from: "Em execução", to: "Cancelada", reason: "Cliente desistiu" }), "")
  assert.match(validateTransition({ ...base, from: "Em execução", to: "Suspensa" }), /motivo/)
  assert.match(validateTransition({ ...base, from: "Cancelada", to: "Aberta" }), /cancelada/)
})

test("retomar OS suspensa volta para a etapa de onde saiu ou anterior", () => {
  assert.equal(validateTransition({ ...base, from: "Suspensa", to: "Aguardando peças", suspendedFrom: "Aguardando peças" }), "")
  assert.match(validateTransition({ ...base, from: "Suspensa", to: "Concluída", suspendedFrom: "Aguardando peças" }), /retomar/)
})

test("concluir exige técnico e serviços executados; entregar só após concluir", () => {
  assert.match(validateTransition({ from: "Em conferência", to: "Concluída", executedServices: 0 }), /responsável técnico/)
  assert.match(validateTransition({ from: "Em conferência", to: "Concluída", technicianId: "t1", executedServices: 0 }), /serviços executados/)
  assert.equal(validateTransition({ from: "Em conferência", to: "Concluída", technicianId: "t1", executedServices: 0, servicesSummary: "Troca de lonas" }), "")
  assert.match(validateTransition({ ...base, from: "Em execução", to: "Entregue" }), /concluída/)
  assert.equal(validateTransition({ ...base, from: "Concluída", to: "Entregue" }), "")
  assert.match(validateTransition({ ...base, from: "Concluída", to: "Em execução" }), /motivo/)
  assert.match(validateTransition({ ...base, from: "Entregue", to: "Em execução", reason: "x" }), /entregue/)
})

test("próximas situações", () => {
  assert.deepEqual(nextStatuses("Concluída"), ["Entregue", "Em conferência", "Em execução"])
  assert.equal(nextStatuses("Entregue").length, 0)
  assert.ok(nextStatuses("Aberta").includes("Cancelada"))
  assert.ok(!nextStatuses("Aberta").includes("Entregue"))
})

test("valores e margem da OS", () => {
  const totals = osTotals(
    [{ quantity: 4, unitPrice: 150 }],
    [{ quantity: 2, unitPrice: 300, unitCost: 180 }],
    [{ hours: 4, hourlyCost: 40 }],
    100,
  )
  assert.deepEqual(
    { labor: totals.labor, materials: totals.materials, total: totals.total, cost: totals.cost, margin: totals.margin, marginPercent: totals.marginPercent, hours: totals.hours },
    { labor: 600, materials: 600, total: 1100, cost: 520, margin: 580, marginPercent: 52.73, hours: 4 },
  )
  assert.match(validateDiscount(50, 1200, ""), /autorizou/)
  assert.match(validateDiscount(2000, 1200, "Gerente"), /maior/)
  assert.equal(validateDiscount(50, 1200, "Gerente"), "")
})
