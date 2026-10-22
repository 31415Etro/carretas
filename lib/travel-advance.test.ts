import assert from "node:assert/strict"
import test from "node:test"
import { canFinalize, canUpload, daysUntil, hasContested, isFullyReviewed, needsSettlementChoice, summarizeAdvance, summarizeCategories, validateCategoryBudgets } from "./travel-advance.ts"

test("resumo: gasto, saldo e estouro", () => {
  assert.deepEqual(summarizeAdvance(1000, [{ amount: 300 }, { amount: 200 }]), { budget: 1000, spent: 500, remaining: 500, overspent: false, overspentAmount: 0 })
  assert.deepEqual(summarizeAdvance(1000, [{ amount: 700 }, { amount: 500 }]), { budget: 1000, spent: 1200, remaining: -200, overspent: true, overspentAmount: 200 })
})

test("finalizar exige justificativa quando estourou o orçamento", () => {
  const over = summarizeAdvance(100, [{ amount: 150 }])
  assert.deepEqual(canFinalize(over, ""), { ok: false, reason: "Você gastou mais do que o valor disponibilizado: explique o que pagou do seu bolso antes de finalizar." })
  assert.deepEqual(canFinalize(over, "paguei a diferença no cartão pessoal"), { ok: true })
  assert.deepEqual(canFinalize(summarizeAdvance(100, [{ amount: 100 }]), ""), { ok: true })
})

test("saldo sobrando exige escolha de devolução/desconto", () => {
  const under = summarizeAdvance(100, [{ amount: 60 }])
  assert.equal(needsSettlementChoice(under, null), true)
  assert.equal(needsSettlementChoice(under, "devolver"), false)
  assert.equal(needsSettlementChoice(summarizeAdvance(100, [{ amount: 100 }]), null), false)
})

test("totalmente revisado só quando todas as notas foram aprovadas", () => {
  assert.equal(isFullyReviewed([{ status: "Aprovado" }, { status: "Aprovado" }]), true)
  assert.equal(isFullyReviewed([{ status: "Aprovado" }, { status: "Enviado" }]), false)
  assert.equal(isFullyReviewed([]), false)
  assert.equal(hasContested([{ status: "Aprovado" }, { status: "Contestado" }]), true)
  assert.equal(hasContested([{ status: "Aprovado" }]), false)
})

test("prazo do link", () => {
  assert.equal(daysUntil("2026-01-10", "2026-01-05"), 5)
  assert.equal(daysUntil("2026-01-01", "2026-01-05"), -4)
  assert.equal(canUpload("Aberto", "2026-01-10", "2026-01-05"), true)
  assert.equal(canUpload("Aberto", "2026-01-01", "2026-01-05"), false)
  assert.equal(canUpload("Finalizado", "2026-01-10", "2026-01-05"), false)
})

test("sub-orçamentos: a soma não pode passar do total", () => {
  assert.equal(validateCategoryBudgets(1900, { Hospedagem: 1000, Alimentacao: 900 }).ok, true)
  assert.equal(validateCategoryBudgets(1900, { Hospedagem: 1000, Alimentacao: 950 }).ok, false)
  assert.equal(validateCategoryBudgets(1900, {}).ok, true) // nenhum sub-orçamento: tudo bem, fica sem divisão
  assert.equal(validateCategoryBudgets(1900, { Hospedagem: 1900 }).ok, true) // bate exatamente no total
})

test("gasto por categoria é só informativo: cada uma soma suas notas, sem travar as outras", () => {
  const receipts = [{ category: "Hospedagem", amount: 1100 }, { category: "Alimentacao", amount: 300 }, { category: "Combustivel", amount: 50 }]
  const summary = summarizeCategories({ Hospedagem: 1000, Alimentacao: 900 }, receipts)
  assert.deepEqual(summary, [
    { category: "Hospedagem", budget: 1000, spent: 1100, remaining: -100, overspent: true },
    { category: "Alimentacao", budget: 900, spent: 300, remaining: 600, overspent: false },
  ])
  // Combustível não tem teto definido: não aparece no resumo por categoria
  assert.equal(summary.some((item) => item.category === "Combustivel"), false)
})
