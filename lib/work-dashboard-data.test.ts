import assert from "node:assert/strict"
import test from "node:test"
import { dashboardWorks, mergeOperationalHierarchy } from "./work-dashboard-data.ts"

test("includes operational works and resolves mirrored budgets by client ID", () => {
  const clients = [{ id: "a", name: "ROGGA" }, { id: "b", name: "Outro" }]
  const budgets = [{ id: "w1", client_name: "Nome antigo", name: "Obra 10" }]
  const works = [{ id: "w1", client_id: "a", name: "Obra 10" }, { id: "w2", client_id: "a", name: "Obra 2" }, { id: "w3", client_id: "b", name: "Outra" }]
  assert.deepEqual(dashboardWorks(budgets, works, clients, "a").map((work) => work.id), ["w2", "w1"])
  assert.deepEqual(dashboardWorks(budgets, works, clients, "b").map((work) => work.id), ["w3"])
})

test("does not assign ambiguous client names", () => {
  assert.equal(dashboardWorks([{ id: "w", client_name: "Duplicado" }], [], [{ id: "a", name: "Duplicado" }, { id: "b", name: "Duplicado" }], "a").length, 0)
})

test("shows projects instead of generated service locations", () => {
  const works = [
    { id: "services", client_id: "a", name: "Servicos diversos - ROGGA", type: "Servicos diversos" },
    { id: "pmoc", client_id: "a", name: "PMOC - ROGGA", type: "PMOC" },
    { id: "legacy", client_id: "a", name: "Servicos diversos - Cliente", code: "OS-SD-123" },
    { id: "project", client_id: "a", name: "CURACAO", type: "Obra" },
    { id: "budget", client_id: "a", name: "Nome operacional", type: "Servicos diversos" },
  ]
  const result = dashboardWorks([{ id: "budget", client_id: "a", name: "Projeto orcado" }], works, [], "a")
  assert.deepEqual(result.map((row) => row.id), ["project", "budget"])
  assert.equal(result[1].name, "Projeto orcado")
})

test("loads operational points using existing budget hierarchy without duplicates", () => {
  const hierarchy = { towers: [{ id: "t", name: "Torre" }], floors: [{ id: "f", budget_tower_id: "t" }], finals: [{ id: "final", budget_floor_id: "f" }], environments: [{ id: "e", budget_service_type_id: "final" }], points: [{ id: "p", budget_environment_id: "e" }] }
  const result = mergeOperationalHierarchy(hierarchy, { floors: [], environments: [{ id: "e" }], points: [{ id: "p", environment_id: "e" }, { id: "p2", environment_id: "e", point_name: "Ponto 2" }] }, "w")
  assert.equal(result.towers.length, 1)
  assert.equal(result.points.length, 2)
  assert.equal(result.points[1].name, "Ponto 2")
})

test("builds a selectable operational work hierarchy without a budget", () => {
  const result = mergeOperationalHierarchy({ towers: [], floors: [], finals: [], environments: [], points: [] }, {
    floors: [{ id: "f", name: "Pavimento 2" }],
    environments: [{ id: "e", floor_id: "f", final: "01", environment_name: "Sala" }],
    points: [{ id: "p", environment_id: "e", point_name: "Ponto 1" }],
  }, "w")
  assert.equal(result.towers.length, 1)
  assert.equal(result.floors[0].name, "Pavimento 2")
  assert.equal(result.environments[0].budget_service_type_id, result.finals[0].id)
  assert.equal(result.points[0].budget_environment_id, "e")
})
