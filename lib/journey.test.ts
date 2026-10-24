import assert from "node:assert/strict"
import test from "node:test"
import { closingChecks, defaultStep, stepAvailability } from "./journey.ts"

const opp = { id: "o1", stage: "Negociação" }

test("etapas abrem uma a uma conforme o andamento", () => {
  assert.deepEqual(stepAvailability({ opportunity: null, quote: null, order: null }), { oportunidade: true, proposta: false, fechamento: false, pedido: false, acompanhamento: false })
  assert.deepEqual(stepAvailability({ opportunity: opp, quote: null, order: null }), { oportunidade: true, proposta: true, fechamento: false, pedido: false, acompanhamento: false })
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Rascunho" }, order: null }).fechamento, true)
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Cancelado" }, order: null }).fechamento, false)
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Rascunho" } }).pedido, true)
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Rascunho" } }).acompanhamento, false)
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Confirmado" } }).acompanhamento, true)
  assert.equal(stepAvailability({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Cancelado" } }).pedido, false)
})

test("etapa inicial: a mais avançada disponível", () => {
  assert.equal(defaultStep({ opportunity: null, quote: null, order: null }), "oportunidade")
  assert.equal(defaultStep({ opportunity: opp, quote: null, order: null }), "proposta")
  assert.equal(defaultStep({ opportunity: opp, quote: { id: "q", status: "Enviado" }, order: null }), "fechamento")
  assert.equal(defaultStep({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Rascunho" } }), "pedido")
  assert.equal(defaultStep({ opportunity: opp, quote: { id: "q", status: "Convertido" }, order: { id: "p", status: "Em producao" } }), "acompanhamento")
})

test("conferências do fechamento apontam o que falta", () => {
  const ok = closingChecks({ clientId: "c", items: [{ lineType: "Produto", catalogId: "p", quantity: 1, unitPrice: 100, configurationId: "cfg", requiresConfiguration: true }], totalAmount: 100, paymentConditionId: "pc", deliveryTerm: "45 dias" })
  assert.ok(ok.every((check) => check.ok))
  const bad = closingChecks({ clientId: "", items: [{ lineType: "Produto", catalogId: "p", quantity: 1, unitPrice: 100, requiresConfiguration: true }], totalAmount: 0, paymentConditionId: "", deliveryTerm: " " })
  assert.deepEqual(bad.filter((check) => !check.ok).map((check) => check.key), ["cliente", "medidas", "valores", "condicoes", "prazo"])
  assert.equal(closingChecks({ clientId: "c", items: [], totalAmount: 10, paymentConditionId: "pc", deliveryTerm: "x" }).find((check) => check.key === "produtos")?.ok, false)
})
