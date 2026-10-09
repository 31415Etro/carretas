import assert from "node:assert/strict"
import test from "node:test"

import { accountSettlementAmount, addMonths, buildInstallments, payableAutoStatus, receivableAutoStatus } from "./finance-erp.ts"

test("divide o total em parcelas e deixa a diferença de centavos na última", () => {
  const plan = buildInstallments(100, 3, "2026-01-31", 30)
  assert.deepEqual(plan.map((item) => item.amount), [33.33, 33.33, 33.34])
  assert.deepEqual(plan.map((item) => item.dueDate), ["2026-01-31", "2026-02-28", "2026-03-31"])
  assert.equal(plan.reduce((sum, item) => sum + item.amount, 0).toFixed(2), "100.00")
})

test("intervalo diferente de 30 dias conta em dias corridos", () => {
  const plan = buildInstallments(90, 3, "2026-01-01", 15)
  assert.deepEqual(plan.map((item) => item.dueDate), ["2026-01-01", "2026-01-16", "2026-01-31"])
})

test("mantém o último dia do mês ao somar meses", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29")
})

test("valor de liquidação soma juros e multa e abate o desconto", () => {
  assert.equal(accountSettlementAmount({ expectedAmount: 1000, interestAmount: 12.5, fineAmount: 20, discountAmount: 2.5 }), 1030)
})

test("status automático das contas", () => {
  const base = { dueDate: "2026-05-10", expectedAmount: 100, status: "Aberta" } as any
  assert.equal(payableAutoStatus({ ...base, paidAmount: 0 }, "2026-05-01"), "Aberta")
  assert.equal(payableAutoStatus({ ...base, paidAmount: 0 }, "2026-05-11"), "Vencida")
  assert.equal(payableAutoStatus({ ...base, paidAmount: 40 }, "2026-05-11"), "Parcialmente paga")
  assert.equal(payableAutoStatus({ ...base, paidAmount: 100 }, "2026-05-11"), "Paga")
  assert.equal(payableAutoStatus({ ...base, paidAmount: 100, fineAmount: 2 }, "2026-05-11"), "Parcialmente paga")
  assert.equal(payableAutoStatus({ ...base, status: "Cancelada", paidAmount: 0 }, "2026-05-11"), "Cancelada")
  assert.equal(receivableAutoStatus({ ...base, receivedAmount: 100 }, "2026-05-11"), "Recebida")
})
