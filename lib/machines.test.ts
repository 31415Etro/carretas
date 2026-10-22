import assert from "node:assert/strict"
import test from "node:test"

import {
  addMonths, bookValueCurve, buildQrUrl, checkStatusChange, computeNextDue, costInPeriod, depreciation, dueState, failureCount, formatDuration, formatMachineCode, formatOrderNumber, isHighMaintenanceCost,
  lastMaintenanceDate, machineCodePattern, orderCost, suggestIllustration, sumMoney, totalMaintenanceCost, unavailableHours, validateMachine, validateMachineFile, validateMeterReading, validateOrder,
} from "./machines.ts"

const today = "2026-10-22"

test("código patrimonial e número de OM", () => {
  assert.equal(formatMachineCode("ND", "MAQ", 1), "ND-MAQ-000001")
  assert.equal(formatMachineCode("ND", "EQP", 12), "ND-EQP-000012")
  assert.equal(formatOrderNumber(2026, 1), "OM-2026-000001")
  assert.ok(machineCodePattern.test("ND-MAQ-000001"))
  assert.ok(!machineCodePattern.test("ND-XYZ-1"))
})

test("dinheiro em centavos não acumula erro de ponto flutuante", () => {
  assert.equal(sumMoney(0.1, 0.2), 0.3)
  assert.equal(sumMoney(1234.56, 0.01, 99.99), 1334.56)
  assert.equal(orderCost({ laborCost: 100.1, partsCost: 50.2, otherCost: 0.3 }), 150.6)
})

test("ilustração: sugere pela palavra-chave e cai na genérica sem correspondência", () => {
  assert.equal(suggestIllustration("Máquina de solda MIG 250"), "solda_mig")
  assert.equal(suggestIllustration("Compressor de ar"), "compressor")
  assert.equal(suggestIllustration("Torno CNC"), "generica")
  assert.equal(suggestIllustration(""), "generica")
})

test("addMonths respeita fim de mês", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29")
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15")
})

test("depreciação linear: base, residual, meses completos e ajustes", () => {
  const input = { acquisitionValue: 100000, freightCost: 2000, installationCost: 3000, otherCosts: 0, residualValue: 15000, usefulLifeMonths: 120, startDate: "2024-10-22", asOf: "2026-10-22" }
  const result = depreciation(input)
  assert.equal(result.baseValue, 105000)
  assert.equal(result.depreciable, 90000)
  assert.equal(result.monthly, 750)
  assert.equal(result.monthsElapsed, 24)
  assert.equal(result.accumulated, 18000)
  assert.equal(result.bookValue, 87000)
  assert.equal(depreciation({ ...input, asOf: "2026-10-21" }).monthsElapsed, 23)
  assert.equal(depreciation({ ...input, adjustments: -1000 }).accumulated, 17000)
})

test("depreciação para no valor residual e não é aplicada sem vida útil", () => {
  const done = depreciation({ acquisitionValue: 10000, residualValue: 1000, usefulLifeMonths: 12, startDate: "2020-01-01", asOf: today })
  assert.equal(done.bookValue, 1000)
  assert.equal(done.fullyDepreciated, true)
  const none = depreciation({ acquisitionValue: 10000, startDate: "2020-01-01", asOf: today })
  assert.equal(none.applicable, false)
  assert.equal(none.bookValue, 10000)
  assert.equal(depreciation({ acquisitionValue: 10000, usefulLifeMonths: 12, startDate: "2020-01-01", method: "Nenhum", asOf: today }).accumulated, 0)
})

test("curva do valor contábil termina no residual", () => {
  const curve = bookValueCurve({ acquisitionValue: 12000, residualValue: 0, usefulLifeMonths: 24, startDate: "2025-01-01" }, today)
  assert.equal(curve[0].bookValue, 12000)
  assert.equal(curve.find((point) => point.date === "2027-01-01")?.bookValue, 0)
})

test("próxima manutenção por dias, meses, horas e regra combinada", () => {
  assert.deepEqual(computeNextDue({ intervalDays: 30, lastDoneDate: "2026-10-01" }), { dueDate: "2026-10-31", dueHours: null })
  assert.deepEqual(computeNextDue({ intervalMonths: 3, baseDate: "2026-01-31" }), { dueDate: "2026-04-30", dueHours: null })
  assert.deepEqual(computeNextDue({ intervalHours: 500, lastDoneHours: 1200 }), { dueDate: "", dueHours: 1700 })
  assert.equal(computeNextDue({ intervalDays: 30, intervalMonths: 3, lastDoneDate: "2026-01-01", combineRule: "Primeiro" }).dueDate, "2026-01-31")
  assert.equal(computeNextDue({ intervalDays: 30, intervalMonths: 3, lastDoneDate: "2026-01-01", combineRule: "Todos" }).dueDate, "2026-04-01")
  assert.equal(computeNextDue({ fixedDate: "2026-12-01", lastDoneDate: "2026-12-05" }).dueDate, "")
})

test("vencimento: vencida, próxima, em dia e por horímetro", () => {
  assert.equal(dueState({ dueDate: "2026-10-01" }, today, 0), "Vencida")
  assert.equal(dueState({ dueDate: "2026-10-30" }, today, 0), "Proxima")
  assert.equal(dueState({ dueDate: "2027-03-01" }, today, 0), "Em dia")
  assert.equal(dueState({ dueHours: 500 }, today, 510), "Vencida")
  assert.equal(dueState({ dueHours: 500 }, today, 490), "Proxima")
  assert.equal(dueState({}, today, 0), "Sem prazo")
  assert.equal(dueState({ dueDate: "2026-10-01", dueHours: 900 }, today, 100, { combineRule: "Todos" }), "Proxima")
  assert.equal(dueState({ dueDate: "2026-10-01", dueHours: 900 }, today, 100, { combineRule: "Primeiro" }), "Vencida")
})

test("status: segurança, ordem bloqueante, motivo e estado administrativo", () => {
  const base = { adminStatus: "Ativo" as const, current: "Parada" as const, safetyLocked: false, to: "Em operacao" as const, blockingOpenOrders: 0, canReleaseSafety: false, reason: "Início de produção" }
  assert.equal(checkStatusChange(base), "")
  assert.match(checkStatusChange({ ...base, safetyLocked: true }), /bloqueada por segurança/)
  assert.equal(checkStatusChange({ ...base, safetyLocked: true, canReleaseSafety: true }), "")
  assert.match(checkStatusChange({ ...base, blockingOpenOrders: 1 }), /ordem de manutenção em aberto/)
  assert.match(checkStatusChange({ ...base, reason: "  " }), /motivo/)
  assert.match(checkStatusChange({ ...base, adminStatus: "Baixado" }), /baixado/)
  assert.match(checkStatusChange({ ...base, to: "Parada" }), /já está/)
  assert.match(checkStatusChange({ ...base, to: "Nao informado" }), /Escolha/)
})

test("última manutenção usa a data efetiva e só registros concluídos e válidos", () => {
  const orders = [
    { status: "Concluida", origin: "Historico", performedAt: "2025-03-10", createdAt: "2026-10-01" },
    { status: "Concluida", origin: "Ordem", completedAt: "2026-05-02T10:00:00Z", maintenanceType: "Preventiva" },
    { status: "Aberta", origin: "Ordem", performedAt: "2026-09-01" },
    { status: "Cancelada", origin: "Ordem", performedAt: "2026-10-01" },
    { status: "Concluida", origin: "Ocorrencia", performedAt: "2026-10-10" },
  ]
  assert.equal(lastMaintenanceDate(orders), "2026-05-02")
  assert.equal(lastMaintenanceDate([]), "")
})

test("custos de manutenção: total, por período e alerta de custo alto", () => {
  const orders = [
    { status: "Concluida", performedAt: "2026-01-10", laborCost: 500, partsCost: 250.5, otherCost: 0 },
    { status: "Concluida", performedAt: "2026-06-10", laborCost: 100, partsCost: 0, otherCost: 49.5 },
    { status: "Cancelada", performedAt: "2026-06-11", laborCost: 9999 },
  ]
  assert.equal(totalMaintenanceCost(orders), 900)
  assert.equal(costInPeriod(orders, "2026-06-01", "2026-06-30"), 149.5)
  assert.equal(isHighMaintenanceCost(900, 3000, 30), true)
  assert.equal(isHighMaintenanceCost(899.99, 3000, 30), false)
  assert.equal(isHighMaintenanceCost(500, 0, 30), false)
})

test("frequência de falhas conta só corretivas válidas no período", () => {
  const orders = [
    { status: "Concluida", maintenanceType: "Corretiva", performedAt: "2026-02-01" },
    { status: "Concluida", maintenanceType: "Preventiva", performedAt: "2026-02-02" },
    { status: "Cancelada", maintenanceType: "Corretiva", performedAt: "2026-02-03" },
    { status: "Aberta", maintenanceType: "Corretiva", origin: "Ocorrencia", createdAt: "2026-02-04" },
    { status: "Concluida", maintenanceType: "Corretiva", performedAt: "2025-02-01" },
  ]
  assert.equal(failureCount(orders, "2026-01-01", "2026-12-31"), 1)
})

test("horas de indisponibilidade cortam o histórico no período", () => {
  const history = [
    { toStatus: "Em operacao", startedAt: "2026-10-01T08:00:00Z", endedAt: "2026-10-02T08:00:00Z" },
    { toStatus: "Parada", startedAt: "2026-10-02T08:00:00Z", endedAt: "2026-10-02T20:00:00Z" },
    { toStatus: "Em manutencao", startedAt: "2026-10-03T00:00:00Z", endedAt: null },
  ]
  assert.equal(unavailableHours(history, "2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z", "2026-10-03T06:00:00Z"), 18)
  assert.equal(unavailableHours(history, "2026-10-02T12:00:00Z", "2026-10-02T18:00:00Z", "2026-10-30T00:00:00Z"), 6)
})

test("horímetro não aceita leitura menor sem correção justificada", () => {
  assert.equal(validateMeterReading(100, 120, false), "")
  assert.match(validateMeterReading(100, 90, false), /menor/)
  assert.match(validateMeterReading(100, 90, true, ""), /justificativa/)
  assert.equal(validateMeterReading(100, 90, true, "Troca do medidor"), "")
  assert.match(validateMeterReading(100, -1, false), /válida/)
})

test("validação do cadastro e do histórico anterior", () => {
  assert.match(validateMachine({ name: " " }, today), /nome/)
  assert.match(validateMachine({ name: "X", manufactureYear: 1800 }, today), /Ano/)
  assert.match(validateMachine({ name: "X", acquisitionValue: 1000, residualValue: 2000 }, today), /residual/)
  assert.match(validateMachine({ name: "X", acquisitionDate: "2027-01-01" }, today), /futuro/)
  assert.equal(validateMachine({ name: "Solda MIG", acquisitionValue: 5000, residualValue: 500, usefulLifeMonths: 120 }, today), "")
  assert.match(validateOrder({ description: "Troca de rolamento", origin: "Historico" }, today), /data em que/)
  assert.match(validateOrder({ description: "Troca", origin: "Historico", performedAt: "2027-01-01" }, today), /futuro/)
  assert.equal(validateOrder({ description: "Troca", origin: "Historico", performedAt: "2025-01-01" }, today), "")
  assert.match(validateOrder({ description: "", origin: "Ordem" }, today), /Descreva/)
})

test("QR Code: URL configurável e token opaco válido", () => {
  const token = "a".repeat(32)
  assert.equal(buildQrUrl("https://erp.exemplo.com.br/", token), `https://erp.exemplo.com.br/maquinas/q/${token}`)
  assert.throws(() => buildQrUrl("", token), /URL base/)
  assert.throws(() => buildQrUrl("https://x.com", "curto"), /inválido/)
})

test("arquivos: tipo e tamanho", () => {
  assert.equal(validateMachineFile("application/pdf", 1000).ok, true)
  assert.equal(validateMachineFile("application/x-msdownload", 1000).ok, false)
  assert.equal(validateMachineFile("image/png", 21 * 1024 * 1024).ok, false)
})

test("tempo no status", () => {
  assert.equal(formatDuration(30_000), "menos de 1 min")
  assert.equal(formatDuration(45 * 60_000), "45 min")
  assert.equal(formatDuration(5 * 3600_000 + 10 * 60_000), "5 h 10 min")
  assert.equal(formatDuration(50 * 3600_000), "2 d 2 h")
})
