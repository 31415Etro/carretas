import assert from "node:assert/strict"
import test from "node:test"

import { applicableFiscalRule, validateFiscalRules, type FiscalRule } from "./fiscal-rules.ts"

const rule = (patch: Partial<FiscalRule>): FiscalRule => ({ operation: "Venda dentro do estado", taxRegime: "Simples Nacional", cfop: "5102", cstCsosn: "102", ibsCbsCst: "", ibsCbsClass: "", validFrom: "", validTo: "", notes: "", ...patch })

test("valida CFOP pela operação e CST/CSOSN pelo regime", () => {
  assert.equal(validateFiscalRules([rule({})]), "")
  assert.match(validateFiscalRules([rule({ cfop: "6102" })]), /não corresponde/)
  assert.match(validateFiscalRules([rule({ cstCsosn: "00" })]), /CSOSN/)
  assert.equal(validateFiscalRules([rule({ taxRegime: "Lucro Presumido", cstCsosn: "00" })]), "")
  assert.match(validateFiscalRules([rule({ ibsCbsClass: "123" })]), /cClassTrib/)
})

test("impede vigências sobrepostas para a mesma operação e regime", () => {
  assert.match(validateFiscalRules([rule({ validTo: "2026-12-31" }), rule({ validFrom: "2026-06-01" })]), /sobreposta/)
  assert.equal(validateFiscalRules([rule({ validTo: "2026-12-31" }), rule({ validFrom: "2027-01-01", ibsCbsCst: "000", ibsCbsClass: "000001" })]), "")
})

test("escolhe a regra vigente, preferindo o regime específico", () => {
  const rules = [rule({ taxRegime: "Todos", cstCsosn: "" }), rule({ validTo: "2026-12-31" }), rule({ validFrom: "2027-01-01", cstCsosn: "101" })]
  assert.equal(applicableFiscalRule(rules, "Venda dentro do estado", "Simples Nacional", "2026-10-09")?.cstCsosn, "102")
  assert.equal(applicableFiscalRule(rules, "Venda dentro do estado", "Simples Nacional", "2027-02-01")?.cstCsosn, "101")
  assert.equal(applicableFiscalRule(rules, "Venda dentro do estado", "Lucro Real", "2027-02-01")?.taxRegime, "Todos")
  assert.equal(applicableFiscalRule(rules, "Exportação", "Lucro Real", "2027-02-01"), null)
})
