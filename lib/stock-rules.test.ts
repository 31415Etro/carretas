import assert from "node:assert/strict"
import test from "node:test"

import { materialAvailable, needsReplenishment, suggestedPurchaseQuantity } from "./stock-rules.ts"

const item = { currentStock: 10, reservedStock: 4, minimumStock: 5, maximumStock: 30, reorderPoint: 8, status: "Ativo" as const }

test("disponível desconta o reservado", () => {
  assert.equal(materialAvailable(item), 6)
  assert.equal(materialAvailable({ currentStock: 2, reservedStock: 5 }), -3)
})

test("dispara reposição no ponto de reposição considerando o disponível", () => {
  assert.equal(needsReplenishment(item), true)
  assert.equal(needsReplenishment({ ...item, reservedStock: 0 }), false)
  assert.equal(needsReplenishment({ ...item, status: "Inativo" }), false)
  assert.equal(needsReplenishment({ ...item, minimumStock: 0, reorderPoint: 0 }), false)
})

test("sugere comprar até o estoque máximo", () => {
  assert.equal(suggestedPurchaseQuantity(item), 24)
  assert.equal(suggestedPurchaseQuantity({ ...item, maximumStock: 0 }), 10)
})
