import assert from "node:assert/strict"
import test from "node:test"

import { buildInstallments, canCreateVersion, effectiveStatus, quoteTotals, shareMessage, typeMatchesLines, validateQuote, validateQuoteTransition, type QuoteInput } from "./quotes.ts"

const base: QuoteInput = {
  clientId: "c1", salespersonId: "s1", issueDate: "2026-10-12", validUntil: "2026-10-27", quoteType: "Misto", paymentConditionId: "p1", discountAmount: 0, freightAmount: 0, expensesAmount: 0, taxPercent: 0, warrantyDays: 90,
  lines: [
    { lineType: "Produto", catalogId: "m1", description: "Eixo", quantity: 2, unitPrice: 1000, unitCost: 600, discountPercent: 0 },
    { lineType: "Serviço", catalogId: "s1", description: "Montagem", quantity: 1, unitPrice: 500, unitCost: 200, discountPercent: 10 },
  ],
}

test("totais: desconto por item e global, frete, impostos e margem", () => {
  const totals = quoteTotals(base.lines, { discountAmount: 100, freightAmount: 200, expensesAmount: 50, taxPercent: 5 })
  assert.equal(totals.subtotal, 2450)
  assert.equal(totals.net, 2350)
  assert.equal(totals.taxes, 117.5)
  assert.equal(totals.total, 2717.5)
  assert.equal(totals.cost, 1400)
  assert.equal(totals.margin, 950)
  assert.equal(totals.marginPercent, 40.43)
  assert.equal(quoteTotals(base.lines, { discountAmount: 99999, freightAmount: 0, expensesAmount: 0, taxPercent: 0 }).total, 0)
})

test("cadastro do orçamento", () => {
  assert.equal(validateQuote(base), "")
  assert.match(validateQuote({ ...base, validUntil: "2026-10-01" }), /validade/)
  assert.match(validateQuote({ ...base, lines: [] }), /ao menos um/)
  assert.match(validateQuote({ ...base, paymentConditionId: "" }), /condição de pagamento/)
  assert.match(validateQuote({ ...base, quoteType: "Produto" }), /só pode ter itens de produto/)
  assert.match(validateQuote({ ...base, lines: [{ ...base.lines[0], catalogId: "" }, base.lines[1]] }), /catálogo/)
  assert.match(validateQuote({ ...base, discountAmount: 5000 }), /desconto global/)
  assert.equal(typeMatchesLines("Serviço", [base.lines[1]]), true)
  assert.equal(typeMatchesLines("Misto", [base.lines[0]]), false)
})

test("situação, validade e aceite", () => {
  assert.equal(effectiveStatus("Enviado", "2026-10-01", "2026-10-12"), "Expirado")
  assert.equal(effectiveStatus("Aprovado", "2026-10-01", "2026-10-12"), "Aprovado")
  assert.match(validateQuoteTransition("Enviado", "Aprovado", {}, "2026-10-12"), /responsável pelo aceite/)
  assert.equal(validateQuoteTransition("Enviado", "Aprovado", { acceptedBy: "João", validUntil: "2026-10-27" }, "2026-10-12"), "")
  assert.match(validateQuoteTransition("Enviado", "Aprovado", { acceptedBy: "João", validUntil: "2026-10-01" }, "2026-10-12"), /expirado/)
  assert.match(validateQuoteTransition("Rascunho", "Recusado", { reason: "x" }), /enviado/)
  assert.match(validateQuoteTransition("Convertido", "Cancelado", { reason: "x" }), /não pode ser cancelado/)
})

test("parcelas pela condição de pagamento", () => {
  assert.deepEqual(buildInstallments(1000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-31"), [
    { number: 1, dueDate: "2026-03-02", amount: 333.33 },
    { number: 2, dueDate: "2026-04-02", amount: 333.33 },
    { number: 3, dueDate: "2026-05-02", amount: 333.34 },
  ])
  assert.deepEqual(buildInstallments(100, { installments: 2, firstDueDays: 0, intervalDays: 15 }, "2026-10-12"), [
    { number: 1, dueDate: "2026-10-12", amount: 50 },
    { number: 2, dueDate: "2026-10-27", amount: 50 },
  ])
  assert.equal(buildInstallments(0.05, { installments: 3, firstDueDays: 0, intervalDays: 30 }, "2026-10-12").reduce((sum, item) => Math.round((sum + item.amount) * 100) / 100, 0), 0.05)
})

test("mensagem de envio", () => {
  assert.match(shareMessage({ companyName: "Carretas", clientName: "Silva", quoteNumber: "ORC-000001", version: 2, total: 1500, validUntil: "2026-10-27" }), /ORC-000001 \(versão 2\).*27\/10\/2026/)
})

test("situação 'Em negociação': só parte de um orçamento enviado e pode ser aprovada ou recusada", () => {
  assert.equal(validateQuoteTransition("Enviado", "Em negociação", {}), "")
  assert.match(validateQuoteTransition("Rascunho", "Em negociação", {}), /enviado/)
  assert.equal(validateQuoteTransition("Em negociação", "Aprovado", { acceptedBy: "Cliente" }), "")
  assert.equal(validateQuoteTransition("Em negociação", "Recusado", { reason: "preço" }), "")
  assert.equal(validateQuoteTransition("Em negociação", "Enviado", {}), "")
  assert.equal(validateQuoteTransition("Em negociação", "Cancelado", { reason: "x" }), "")
  assert.equal(effectiveStatus("Em negociação", "2020-01-01", "2026-01-01"), "Expirado")
  assert.equal(canCreateVersion("Em negociação"), true)
})
