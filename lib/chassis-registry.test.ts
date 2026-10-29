import assert from "node:assert/strict"
import test from "node:test"
import { companyForGroup, FORT_COMPANY_ID, kgToTons, modelFromGroup, parseMention, registrySummary, viewRegistry, type RegistryRow } from "./chassis-registry.ts"

test("modelo, linha e eixos a partir do nome do grupo da planilha", () => {
  assert.deepEqual(modelFromGroup("CHASSI  BC 1E (1)"), { model: "BC 1E", family: "BC", axles: 1 })
  assert.deepEqual(modelFromGroup("CHASSI CA 1E ( MOTO . ) "), { model: "CA 1E", family: "CA", axles: 1 })
  assert.deepEqual(modelFromGroup("CHASSI FZ 2E"), { model: "FZ 2E", family: "FZ", axles: 2 })
  assert.deepEqual(modelFromGroup("Chassi BC 2E 3 toneladas (1)"), { model: "BC 2E", family: "BC", axles: 2 })
  assert.deepEqual(modelFromGroup("CHASSI JET"), { model: "JET", family: "JET", axles: 0 })
  assert.deepEqual(modelFromGroup("CHASSI FC"), { model: "FC", family: "FC", axles: 0 })
  assert.deepEqual(modelFromGroup("Fort- chassi 1 eixo"), { model: "FORT 1E", family: "FORT", axles: 1 })
  assert.deepEqual(modelFromGroup("Fort chassi 2 eixos"), { model: "FORT 2E", family: "FORT", axles: 2 })
})

test("data da menção em horário de Brasília e kg em toneladas", () => {
  assert.equal(parseMention("02/02/2024 07:34"), "2024-02-02T07:34:00-03:00")
  assert.equal(parseMention(""), null)
  assert.equal(parseMention("lixo"), null)
  assert.equal(kgToTons(550), 0.55)
  assert.equal(kgToTons(0), 0)
})

test("chassis Fort vão para a Fort Com de Ferro e Aço", () => {
  assert.equal(companyForGroup("Fort chassi 2 eixos"), FORT_COMPANY_ID)
  assert.notEqual(companyForGroup("CHASSI FZ 1E"), FORT_COMPANY_ID)
})

const row = (vin: string, patch: Partial<RegistryRow> = {}): RegistryRow => ({ vin, groupName: "CHASSI FZ 1E", model: "FZ 1E", family: "FZ", axles: 1, description: "", yearManufacture: "", yearModel: "", pbtKg: 0, capacityKg: 0, tareKg: 0, axleCapacityKg: 0, color: "", clientHint: "", firstMention: null, lastMention: null, mentions: 1, alerts: "", companyId: "c1", ...patch })

test("cadastro cruzado com as notas: com nota, sem nota e busca", () => {
  const notes = new Map([["980NDFZ1ETD000001", { number: "14180", clientName: "JOÃO LUIZ", issuedAt: "2026-01-05T12:00:00Z" }]])
  const rows = [row("980NDFZ1ETD000001", { description: "1200x2000" }), row("980NDFZ1ETD000002", { description: "1400x2500 com cesto" }), row("980NDBC1ETD000003", { model: "BC 1E", description: "5 metros viga grossa" })]
  const all = viewRegistry(rows, notes, {})
  assert.equal(all.length, 3)
  assert.equal(viewRegistry(rows, notes, { note: "sem" }).length, 2)
  assert.equal(viewRegistry(rows, notes, { note: "com" })[0].noteNumber, "14180")
  assert.equal(viewRegistry(rows, notes, { q: "viga grossa" })[0].vin, "980NDBC1ETD000003")
  assert.equal(viewRegistry(rows, notes, { q: "joao" }).length, 1) // sem acento acha o cliente da nota
  assert.equal(viewRegistry(rows, notes, { model: "BC 1E" }).length, 1)
  const summary = registrySummary(all)
  assert.deepEqual([summary.total, summary.withNote, summary.withoutNote, summary.withDescription], [3, 1, 2, 3])
})
