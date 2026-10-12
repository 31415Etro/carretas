import assert from "node:assert/strict"
import test from "node:test"

import { addMonths, adjustedValue, contractAlerts, dueDateFor, dueRuns, pendingCompetences, validateContract, validateContractTransition, valueAt, type BillingContract, type ContractInput } from "./contracts.ts"

const input: ContractInput = {
  contractType: "Manutenção recorrente", direction: "Receita", title: "Manutenção da frota do cliente", clientId: "c1", supplierId: "", signedDate: "2026-09-30", startDate: "2026-10-01", endDate: "2027-09-30", indefinite: false,
  totalValue: 12000, recurringValue: 1000, billingPeriodicity: "Mensal", dueDay: 10, paymentMethod: "Boleto", adjustmentIndex: "IPCA", adjustmentPercent: 0, noticeDays: 60, autoRenew: false, renewalMonths: 0,
  scope: "Manutenção preventiva mensal de 5 carretas", sla: "Atendimento em até 24 h", responsibleName: "Ana", status: "Rascunho",
}

test("cadastro do contrato: obrigatórios e condicionais", () => {
  assert.equal(validateContract(input, "2026-10-12"), "")
  assert.match(validateContract({ ...input, clientId: "" }), /contratante/)
  assert.match(validateContract({ ...input, direction: "Despesa" }), /fornecedor/)
  assert.match(validateContract({ ...input, endDate: "" }), /término/)
  assert.equal(validateContract({ ...input, endDate: "", indefinite: true }, "2026-10-12"), "")
  assert.match(validateContract({ ...input, endDate: "2026-09-01" }), /anterior ao início/)
  assert.match(validateContract({ ...input, recurringValue: 0 }), /valor mensal/)
  assert.match(validateContract({ ...input, dueDay: 0 }), /dia de vencimento/)
  assert.match(validateContract({ ...input, sla: "" }), /SLA/)
  assert.match(validateContract({ ...input, signedDate: "2027-01-01" }, "2026-10-12"), /futura/)
  assert.match(validateContract({ ...input, adjustmentIndex: "Percentual fixo" }), /percentual fixo/)
  assert.equal(validateContract({ ...input, contractType: "Prestação de serviços", recurringValue: 0, sla: "" }, "2026-10-12"), "")
})

test("situação: vigente exige assinatura; final não muda", () => {
  assert.match(validateContractTransition("Rascunho", "Vigente", { hasSignature: false, signedDate: "2026-09-30" }), /contrato assinado/)
  assert.match(validateContractTransition("Rascunho", "Vigente", { hasSignature: true }), /data de assinatura/)
  assert.equal(validateContractTransition("Aguardando assinatura", "Vigente", { hasSignature: true, signedDate: "2026-09-30" }), "")
  assert.match(validateContractTransition("Vigente", "Suspenso", { hasSignature: true }), /motivo/)
  assert.match(validateContractTransition("Encerrado", "Vigente", { hasSignature: true, signedDate: "x" }), /não muda/)
  assert.match(validateContractTransition("Vigente", "Rascunho", { hasSignature: true }), /Não é possível/)
})

test("datas: meses com dia limitado e vencimento do período", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15")
  assert.equal(dueDateFor("2026-10-01", 10), "2026-10-10")
  assert.equal(dueDateFor("2026-10-20", 5), "2026-11-05")
  assert.equal(dueDateFor("2026-02-01", 31), "2026-02-28")
})

const billing: BillingContract = { status: "Vigente", startDate: "2026-10-01", endDate: "2027-09-30", billingStartDate: "", billingPeriodicity: "Mensal", dueDay: 10, billingAdvanceDays: 10, initialRecurringValue: 1000 }

test("competências: só vigente, sem duplicar, com antecedência e término", () => {
  assert.deepEqual(pendingCompetences({ ...billing, status: "Suspenso" }, [], [], "2026-10-05"), [])
  // 05/10: outubro vence dia 10 (dentro da antecedência); novembro vence 10/11 (fora)
  assert.deepEqual(pendingCompetences(billing, [], [], "2026-10-05"), [{ competence: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-10-10", amount: 1000 }])
  // já lançada: não repete
  assert.deepEqual(pendingCompetences(billing, [], ["2026-10-01"], "2026-10-05"), [])
  // recuperação de atraso: em 15/12 faltam out, nov e dez (jan vence 10/01, fora da antecedência)
  assert.deepEqual(pendingCompetences(billing, [], [], "2026-12-15").map((item) => item.competence), ["2026-10-01", "2026-11-01", "2026-12-01"])
  // início da cobrança posterior ao início do contrato
  assert.deepEqual(pendingCompetences({ ...billing, billingStartDate: "2026-12-01" }, [], [], "2026-12-15").map((item) => item.competence), ["2026-12-01"])
  // não passa do término
  assert.equal(pendingCompetences(billing, [], [], "2030-01-01").length, 12)
})

test("competências: trimestral e valor com reajuste", () => {
  const quarterly = { ...billing, billingPeriodicity: "Trimestral", dueDay: 5 }
  assert.deepEqual(pendingCompetences(quarterly, [], [], "2027-01-01").map((item) => [item.competence, item.dueDate]), [["2026-10-01", "2026-10-05"], ["2027-01-01", "2027-01-05"]])
  const steps = [{ from: "2027-01-01", value: 1050 }]
  assert.equal(valueAt("2026-12-01", 1000, steps), 1000)
  assert.equal(valueAt("2027-01-01", 1000, steps), 1050)
  const amounts = pendingCompetences(billing, steps, [], "2027-02-15").map((item) => item.amount)
  assert.deepEqual([amounts[2], amounts[3]], [1000, 1050])
  assert.equal(adjustedValue(1000, 4.5), 1045)
})

test("OS periódicas: antecedência, término e contrato não vigente", () => {
  const plan = { periodicity: "Mensal", nextRunDate: "2026-10-15", leadDays: 3, active: true }
  const contract = { status: "Vigente", endDate: "2027-09-30" }
  assert.deepEqual(dueRuns(plan, contract, "2026-10-10"), [])
  assert.deepEqual(dueRuns(plan, contract, "2026-10-12"), ["2026-10-15"])
  assert.deepEqual(dueRuns(plan, contract, "2026-12-20"), ["2026-10-15", "2026-11-15", "2026-12-15"])
  assert.deepEqual(dueRuns({ ...plan, active: false }, contract, "2026-12-20"), [])
  assert.deepEqual(dueRuns(plan, { status: "Suspenso", endDate: "" }, "2026-12-20"), [])
  assert.deepEqual(dueRuns(plan, { status: "Vigente", endDate: "2026-11-30" }, "2026-12-20"), ["2026-10-15", "2026-11-15"])
})

test("alertas: reajuste, aviso prévio, encerramento, obrigações e assinatura", () => {
  const contract = { id: "k1", number: "CTR-000001", title: "Manutenção", status: "Vigente", endDate: "2026-11-05", noticeDays: 30, autoRenew: false, nextAdjustmentDate: "2026-11-01", responsibleName: "Ana", responsibleEmail: "ana@x.com", hasSignature: true }
  const alerts = contractAlerts([contract, { ...contract, id: "k2", number: "CTR-000002", status: "Encerrado" }], [
    { contractId: "k1", kind: "Documento", title: "Seguro da contratada", dueDate: "2026-10-10", status: "Pendente" },
    { contractId: "k1", kind: "Obrigação", title: "Relatório mensal", dueDate: "2026-12-30", status: "Pendente" },
    { contractId: "k1", kind: "Obrigação", title: "Visita", dueDate: "2026-10-13", status: "Cumprida" },
  ], "2026-10-12")
  assert.deepEqual(alerts.map((item) => [item.kind, item.overdue]), [["Renovação / aviso prévio", true], ["Documento pendente", true], ["Reajuste", false], ["Encerramento", false]])
  assert.equal(alerts.every((item) => item.contractId === "k1"), true)
  assert.deepEqual(contractAlerts([{ ...contract, hasSignature: false, nextAdjustmentDate: "", endDate: "" }], [], "2026-10-12").map((item) => item.key), ["sem-assinatura"])
})
