import assert from "node:assert/strict"
import test from "node:test"
import { budgetKitsForPoints, budgetKitsForWork, mergeStoredAndBudgetKits } from "./order-budget-kits.ts"

test("groups one budget kit for each selected point", () => {
  const result = budgetKitsForPoints(["p1", "p2", "p3"], [
    { id: "p1", kitId: "kit-a" }, { id: "p2", kitId: "kit-a" }, { id: "p3", kitId: "kit-b" },
  ], [])
  assert.deepEqual(result, [
    { kitId: "kit-a", quantity: 2, notes: "Kit do orcamento - 2 ponto(s)" },
    { kitId: "kit-b", quantity: 1, notes: "Kit do orcamento - 1 ponto(s)" },
  ])
})

test("resolves a legacy kit by name and preserves saved manual kits", () => {
  const budget = budgetKitsForPoints(["p1"], [{ id: "p1", kitName: " Kit Instalacao " }], [{ id: "kit-budget", name: "kit instalacao" }])
  const merged = mergeStoredAndBudgetKits([{ kitId: "kit-manual", quantity: 1, notes: "Manual" }], budget)
  assert.deepEqual(merged.map((item) => item.kitId), ["kit-manual", "kit-budget"])
})

test("loads and groups every active budget kit from the selected work", () => {
  const result = budgetKitsForWork("work-a", [
    { id: "p1", workId: "work-a", kitId: "kit-a", status: "Ativo" },
    { id: "p2", workId: "work-a", kitId: "kit-a", status: "Ativo" },
    { id: "p3", workId: "work-a", kitId: "kit-b", status: "Inativo" },
    { id: "p4", workId: "work-b", kitId: "kit-b", status: "Ativo" },
  ], [])
  assert.deepEqual(result, [
    { kitId: "kit-a", quantity: 2, notes: "Kit do orcamento - 2 ponto(s)" },
  ])
})
