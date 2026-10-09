import assert from "node:assert/strict"
import test from "node:test"

import { compositionCost, quantityWithLoss, validateComposition } from "./compositions.ts"

test("custo com perda prevista e mão de obra", () => {
  assert.equal(quantityWithLoss({ quantity: 10, lossPercent: 5 }), 10.5)
  const cost = compositionCost([
    { componentId: "chapa", quantity: 10, unit: "M2", lossPercent: 5, unitCost: 100 },
    { componentId: "eixo", quantity: 2, unit: "UN", lossPercent: 0, unitCost: 1500 },
  ], 800)
  assert.deepEqual(cost, { materials: 4050, labor: 800, total: 4850 })
})

test("validação da composição", () => {
  const item = { componentId: "eixo", quantity: 2, unit: "UN", lossPercent: 0 }
  assert.equal(validateComposition("carreta", [item], 0, 0), "")
  assert.match(validateComposition("carreta", [], 0, 0), /ao menos um/)
  assert.match(validateComposition("carreta", [{ ...item, componentId: "carreta" }], 0, 0), /si mesmo/)
  assert.match(validateComposition("carreta", [item, item], 0, 0), /repetido/)
  assert.match(validateComposition("carreta", [{ ...item, lossPercent: 100 }], 0, 0), /Perda/)
})

test("detecta composição circular", () => {
  assert.match(validateComposition("carreta", [{ componentId: "chassi", quantity: 1, unit: "UN", lossPercent: 0 }], 0, 0, { chassi: ["longarina"], longarina: ["carreta"] }), /circular/)
  assert.equal(validateComposition("carreta", [{ componentId: "chassi", quantity: 1, unit: "UN", lossPercent: 0 }], 0, 0, { chassi: ["longarina"] }), "")
})
