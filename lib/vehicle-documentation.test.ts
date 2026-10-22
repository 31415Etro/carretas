import assert from "node:assert/strict"
import test from "node:test"
import { docStatusLabel, documentationActions, normalizeVin, releaseLabel, simulateConsult, simulateSubmit, vinProblem } from "./vehicle-documentation.ts"

test("chassi: normaliza e valida (17 caracteres, sem I, O e Q)", () => {
  assert.equal(normalizeVin(" 9bw zzz377vt004251 "), "9BWZZZ377VT004251")
  assert.equal(vinProblem("9BWZZZ377VT004251"), "")
  assert.match(vinProblem("9BWZZZ377VT00425"), /inválido/)
  assert.match(vinProblem("9BWZZZ377VT00425I"), /inválido/)
  assert.match(vinProblem(""), /Informe/)
})
test("situações em português", () => {
  assert.equal(docStatusLabel("Aprovado para liberacao"), "Aprovado para liberação")
  assert.equal(docStatusLabel("Em exigencia"), "Em exigência")
})
test("ações por situação e por perfil: aprovação manual só administrador/gerente", () => {
  const doc = (status: string, channel = "manual") => ({ status, channel })
  assert.deepEqual([documentationActions(doc("Pendente de dados"), "user").edit, documentationActions(doc("Pendente de dados"), "user").submitAutomatic], [true, false])
  assert.equal(documentationActions(doc("Pronto para envio"), "user").registerManualSubmission, true)
  assert.equal(documentationActions(doc("Pronto para envio", "simulador"), "user").submitAutomatic, true)
  assert.equal(documentationActions(doc("Pronto para envio", "serpro_lote"), "user").submitAutomatic, false) // lote ainda não implementado
  assert.deepEqual([documentationActions(doc("Enviado"), "user").registerResult, documentationActions(doc("Enviado"), "manager").registerResult], [false, true])
  assert.equal(documentationActions(doc("Enviado", "simulador"), "user").consult, true)
  assert.equal(documentationActions(doc("Aprovado para liberacao"), "user").edit, false)
  assert.equal(documentationActions(doc("Aprovado para liberacao"), "user").finalStage, true)
  assert.equal(documentationActions(doc("Rejeitado"), "user").correct, true)
  assert.equal(documentationActions(doc("Cancelado"), "admin").cancel, false)
})
test("texto da liberação", () => {
  assert.equal(releaseLabel({ eligible: true, blockers: [] }), "Liberada para fabricar")
  assert.match(releaseLabel({ eligible: false, blockers: [{ code: "documentacao", message: "Documentação: 1 de 3.", waivable: false }] }), /Bloqueada: Documentação: 1 de 3/)
})
test("simulador: roteiros pelo último caractere do chassi", () => {
  assert.equal(simulateSubmit({ vin: "9BWZZZ377VT000007", submitAttempts: 1 }).outcome, "indisponivel")
  assert.equal(simulateSubmit({ vin: "9BWZZZ377VT000007", submitAttempts: 2 }).outcome, "sucesso")
  assert.equal(simulateConsult({ vin: "9BWZZZ377VT000001", consults: 0 }).result, "processando")
  assert.equal(simulateConsult({ vin: "9BWZZZ377VT000001", consults: 1 }).result, "aprovado")
  assert.equal(simulateConsult({ vin: "9BWZZZ377VT000008", consults: 0 }).result, "exigencia")
  assert.equal(simulateConsult({ vin: "9BWZZZ377VT000009", consults: 0 }).result, "rejeitado")
})
