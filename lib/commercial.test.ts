import assert from "node:assert/strict"
import test from "node:test"

import { contactOverdue, conversionRate, fiscalPendencies, formatDocument, funnelSummary, isValidCnpj, isValidCpf, validateOpportunity, validateParty, validateStageChange, type Party } from "./commercial.ts"

const party: Party = {
  kind: "cliente", personType: "PJ", name: "Transportes Silva Ltda", tradeName: "Silva", document: "11.222.333/0001-81", stateRegistration: "123456789", municipalRegistration: "", icmsIndicator: "1",
  phone: "(11) 91234-5678", email: "contato@silva.com.br", zipCode: "01310-100", street: "Av. Paulista", number: "1000", complement: "", district: "Bela Vista", city: "São Paulo", state: "SP",
  contactName: "Ana", contactRole: "Compras", salespersonId: "", creditLimit: 0, paymentConditionId: "", commercialNotes: "", status: "Ativo",
}

test("CPF e CNPJ (numérico e alfanumérico)", () => {
  assert.equal(isValidCpf("529.982.247-25"), true)
  assert.equal(isValidCpf("529.982.247-24"), false)
  assert.equal(isValidCpf("111.111.111-11"), false)
  assert.equal(isValidCnpj("11.222.333/0001-81"), true)
  assert.equal(isValidCnpj("11.222.333/0001-82"), false)
  assert.equal(isValidCnpj("12.ABC.345/01DE-35"), true)
  assert.equal(formatDocument("11222333000181"), "11.222.333/0001-81")
})

test("cadastro: obrigatórios, lead sem documento e ICMS", () => {
  assert.equal(validateParty(party), "")
  assert.match(validateParty({ ...party, document: "" }), /CPF\/CNPJ/)
  assert.equal(validateParty({ ...party, document: "", status: "Prospect", icmsIndicator: "9" }), "")
  assert.match(validateParty({ ...party, document: "", status: "Prospect", kind: "ambos" }), /Lead/)
  assert.match(validateParty({ ...party, phone: "" }), /telefone/)
  assert.match(validateParty({ ...party, stateRegistration: "" }), /Inscrição Estadual/)
  assert.equal(validateParty({ ...party, stateRegistration: "", icmsIndicator: "9" }), "")
  assert.match(validateParty({ ...party, personType: "PF", document: "11.222.333/0001-81" }), /CPF inválido/)
  assert.match(validateParty({ ...party, zipCode: "123" }), /CEP/)
})

test("pendências para emissão fiscal", () => {
  assert.deepEqual(fiscalPendencies(party), [])
  assert.deepEqual(fiscalPendencies({ ...party, document: "", street: "", stateRegistration: "" }), ["CNPJ", "Inscrição Estadual", "Logradouro"])
  assert.deepEqual(fiscalPendencies({ ...party, stateRegistration: "", email: "" }, "nfse"), ["E-mail"])
})

test("oportunidade e mudança de etapa", () => {
  const input = { title: "Carreta 3 eixos", clientId: "c1", salespersonId: "s1", interest: "Carreta graneleira", estimatedValue: 150000, stage: "Novo lead", probability: 10 }
  assert.equal(validateOpportunity(input), "")
  assert.match(validateOpportunity({ ...input, interest: "" }), /interesse/)
  assert.match(validateOpportunity({ ...input, stage: "Perdido" }), /motivo da perda/)
  assert.match(validateOpportunity({ ...input, stage: "Ganho", estimatedValue: 0 }), /valor da venda/)
  assert.match(validateStageChange("Ganho", "Negociação", {}), /ganha não muda/)
  assert.match(validateStageChange("Perdido", "Contato realizado", {}), /reabrir/)
  assert.equal(validateStageChange("Perdido", "Contato realizado", { reopenReason: "Cliente voltou" }), "")
  assert.match(validateStageChange("Negociação", "Perdido", {}), /motivo da perda/)
  assert.equal(validateStageChange("Negociação", "Ganho", { estimatedValue: 1000 }), "")
})

test("funil, atraso de contato e conversão", () => {
  const rows = [
    { stage: "Orçamento", estimatedValue: 100000, probability: 60, nextContactDate: "2026-10-01" },
    { stage: "Orçamento", estimatedValue: 50000, probability: 50 },
    { stage: "Ganho", estimatedValue: 80000, probability: 100 },
    { stage: "Perdido", estimatedValue: 20000, probability: 0 },
  ]
  const orcamento = funnelSummary(rows).find((item) => item.stage === "Orçamento")
  assert.deepEqual(orcamento, { stage: "Orçamento", count: 2, value: 150000, weighted: 85000 })
  assert.equal(contactOverdue(rows[0], "2026-10-12"), true)
  assert.equal(contactOverdue(rows[2], "2026-10-12"), false)
  assert.equal(conversionRate(rows), 50)
  assert.equal(conversionRate([{ stage: "Novo lead" }]), null)
})
