import assert from "node:assert/strict"
import test from "node:test"

import { purchaseActionAllowed, purchaseOrderTotals, validatePurchaseOrder } from "./purchases.ts"

const order = {
  supplierId: "s1", supplierName: "Fornecedor", orderDate: "2026-10-01", freightAmount: 50, otherCosts: 10, discountAmount: 20,
  items: [
    { materialId: "m1", description: "Eixo", unit: "UN", quantity: 2, unitCost: 1000, discountPercent: 10 },
    { materialId: "m2", description: "Pneu", unit: "UN", quantity: 4, unitCost: 500, discountPercent: 0 },
  ],
}

test("total do pedido soma itens com desconto, frete e outros custos e abate o desconto", () => {
  assert.deepEqual(purchaseOrderTotals(order), { itemsTotal: 3800, total: 3840 })
})

test("valida pedido", () => {
  assert.equal(validatePurchaseOrder(order), "")
  assert.match(validatePurchaseOrder({ ...order, supplierId: "" }), /fornecedor/)
  assert.match(validatePurchaseOrder({ ...order, items: [] }), /ao menos um item/)
  assert.match(validatePurchaseOrder({ ...order, items: [{ ...order.items[0], quantity: 0 }] }), /Quantidade/)
  assert.match(validatePurchaseOrder({ ...order, expectedDate: "2026-09-01" }), /previsão/)
  assert.match(validatePurchaseOrder({ ...order, discountAmount: 10000 }), /desconto/)
})

test("transições de situação", () => {
  assert.equal(purchaseActionAllowed("approve", "Rascunho", false), true)
  assert.equal(purchaseActionAllowed("approve", "Aprovado", false), false)
  assert.equal(purchaseActionAllowed("cancel", "Aprovado", true), false)
  assert.equal(purchaseActionAllowed("reopen", "Aprovado", false), true)
  assert.equal(purchaseActionAllowed("close", "Parcialmente recebido", true), true)
  assert.equal(purchaseActionAllowed("close", "Recebido", true), false)
})
