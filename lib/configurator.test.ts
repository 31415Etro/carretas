import assert from "node:assert/strict"
import test from "node:test"
import { canRequestReview, canSaveConfiguration, canSellConfiguration, configStatusLabel, dimensionsText, paramsFromInputs } from "./configurator.ts"
import { configurationFacts } from "./sales-order-pdf.ts"

test("só configuração válida ou aprovada pela engenharia é vendável", () => {
  for (const status of ["Valida", "Aprovada pela engenharia"]) assert.equal(canSellConfiguration(status), true, status)
  for (const status of ["Requer analise tecnica", "Fora dos limites", "Invalida", "Rejeitada pela engenharia"]) assert.equal(canSellConfiguration(status), false, status)
  assert.deepEqual(["Requer analise tecnica", "Fora dos limites", "Valida", "Invalida"].map(canRequestReview), [true, true, false, false])
  assert.deepEqual(["Invalida", "Rejeitada pela engenharia", "Fora dos limites"].map(canSaveConfiguration), [false, false, true])
  assert.equal(configStatusLabel("Requer analise tecnica"), "Requer análise técnica")
})
test("medidas digitadas (com vírgula e ponto de milhar) viram números; vazio fica de fora", () => {
  assert.deepEqual(paramsFromInputs({ comprimento: "3.500", largura: "1500,5", altura: "", x: "abc" }), { comprimento: 3500, largura: 1500.5 })
  assert.equal(dimensionsText({ comprimento: 5000, largura: 1800, altura: 1200 }), "5.000 x 1.800 x 1.200 mm")
  assert.equal(dimensionsText({ comprimento: 5000 }), "")
})
test("fatos da configuração vendida para o PDF e a ficha: medidas escolhidas, acabamento, acessórios e validação", () => {
  const facts = Object.fromEntries(configurationFacts({ summary: "FZ 1E", status: "Valida", homologated: true, revision_label: "R1", params: { comprimento: 5000, largura: 1800, altura: 1200, pbt: 750, lotacao: 550, eixos: 1 }, derived: {},
    options: { selected: [{ group: "acabamento", label: "Galvanizado", code: "g" }, { group: "acessorio", label: "Estepe", code: "e" }] }, drawing_spec: null, frozen_at: "2026-10-22" }))
  assert.equal(facts["Dimensões (C x L x A)"], "5.000 x 1.800 x 1.200 mm")
  assert.equal(facts["Acabamento"], "Galvanizado")
  assert.equal(facts["Acessórios"], "Estepe")
  assert.equal(facts["PBT"], "750 kg")
  assert.equal(facts["Eixos"], "1")
  assert.match(facts["Validação técnica"], /homologados \(revisão R1\)/)
  const pending = Object.fromEntries(configurationFacts({ summary: "x", status: "Aprovada pela engenharia", homologated: false, revision_label: null, params: {}, derived: {}, options: {}, drawing_spec: null, frozen_at: null }))
  assert.equal(pending["Acabamento"], "Padrão do modelo")
  assert.match(pending["Validação técnica"], /análise técnica específica/)
})
