import assert from "node:assert/strict"
import test from "node:test"

import { downtimeHours, driverCanDrive, fleetAlerts, fuelConsumption, fuelTotal, isValidPlate, isValidRenavam, isValidVin, tirePositions, tripResult, validateCoupling, validateFuel, validateVehicle, type FleetVehicle } from "./fleet.ts"

const vehicle: FleetVehicle = {
  vehicleType: "Cavalo mecanico", fleetNumber: "CV-01", plate: "ABC1D23", renavam: "00639884962", chassis: "9BWZZZ377VT004251", brand: "Scania", model: "R450",
  manufactureYear: "2022", modelYear: "2023", color: "Branco", ownerName: "Empresa", ownerDocument: "", unitCompanyId: "u1", bodyType: "", loadCapacityKg: 0, tareKg: 9000,
  axles: 3, currentKm: 120000, currentHours: 0, driverId: "", status: "Disponivel", acquisitionDate: "", acquisitionValue: 0, licensingDueDate: "2026-12-31",
  insurer: "", policyNumber: "", policyExpiry: "", coupledVehicleId: "", photoUrl: "", notes: "",
}

test("placa, RENAVAM e chassi", () => {
  assert.equal(isValidPlate("abc-1234"), true)
  assert.equal(isValidPlate("ABC1D23"), true)
  assert.equal(isValidPlate("AB12345"), false)
  assert.equal(isValidRenavam("00639884962"), true)
  assert.equal(isValidRenavam("00639884961"), false)
  assert.equal(isValidVin("9BWZZZ377VT004251"), true)
  assert.equal(isValidVin("9BWZZZ377VT00425I"), false)
})

test("cadastro de veículo: obrigatórios condicionados ao tipo", () => {
  assert.equal(validateVehicle(vehicle), "")
  assert.match(validateVehicle({ ...vehicle, plate: "" }), /Placa/)
  assert.match(validateVehicle({ ...vehicle, renavam: "123" }), /RENAVAM/)
  assert.match(validateVehicle(vehicle, { fleetNumbers: ["cv-01"], plates: [], chassis: [] }), /número de frota/)
  assert.match(validateVehicle({ ...vehicle, insurer: "Porto" }), /seguradora/)
  assert.match(validateVehicle({ ...vehicle, modelYear: "2025" }), /Ano-modelo/)
  // implemento sem placa não exige documentos de trânsito
  assert.equal(validateVehicle({ ...vehicle, vehicleType: "Implemento", plate: "", renavam: "", chassis: "", licensingDueDate: "" }), "")
})

test("CNH: validade e categoria pelo tipo de veículo", () => {
  const driver = { name: "João", cnhCategory: "D", cnhExpiry: "2027-01-01" }
  assert.match(driverCanDrive(driver, "Cavalo mecanico", "2026-10-09"), /exige categoria E/)
  assert.equal(driverCanDrive(driver, "Caminhao", "2026-10-09"), "")
  assert.equal(driverCanDrive({ ...driver, cnhCategory: "AE" }, "Cavalo mecanico", "2026-10-09"), "")
  assert.match(driverCanDrive({ ...driver, cnhExpiry: "2026-01-01" }, "Caminhao", "2026-10-09"), /vencida/)
  assert.equal(driverCanDrive(driver, "Implemento", "2026-10-09"), "")
})

test("engate cavalo x semirreboque", () => {
  assert.equal(validateCoupling("Cavalo mecanico", "Semirreboque"), "")
  assert.match(validateCoupling("Caminhao", "Semirreboque"), /cavalo/)
  assert.match(validateCoupling("Utilitario", "Reboque"), /Somente/)
})

test("abastecimento, consumo e tempo parado", () => {
  assert.equal(fuelTotal({ liters: 300, pricePerLiter: 6.19 }), 1857)
  assert.match(validateFuel({ vehicleId: "v", fuelDate: "2026-10-01", liters: 100, pricePerLiter: 6, odometer: 1000 }, 2000), /menor/)
  assert.equal(fuelConsumption([
    { vehicleId: "v", fuelDate: "2026-10-01", liters: 300, pricePerLiter: 6, odometer: 10000 },
    { vehicleId: "v", fuelDate: "2026-10-05", liters: 400, pricePerLiter: 6, odometer: 11000 },
    { vehicleId: "v", fuelDate: "2026-10-09", liters: 100, pricePerLiter: 6, odometer: 11500 },
  ]), 3)
  assert.equal(downtimeHours("2026-10-01T08:00:00Z", "2026-10-02T14:30:00Z"), 30.5)
})

test("alertas de vencimento e manutenção por km", () => {
  const alerts = fleetAlerts({
    vehicles: [{ id: "v1", label: "CV-01 ABC1D23", licensingDueDate: "2026-10-20", policyExpiry: "2026-09-30", currentKm: 119500, status: "Disponivel" }],
    drivers: [{ name: "João", cnhExpiry: "2027-06-01", status: "Ativo" }],
    documents: [],
    maintenance: [{ vehicleId: "v1", description: "Troca de óleo", nextKm: 120000 }],
  }, "2026-10-09")
  assert.deepEqual(alerts.map((item) => [item.kind, item.overdue]), [["Seguro", true], ["Licenciamento", false], ["Manutenção", false]])
})

test("pneus por posição e resultado da viagem", () => {
  assert.deepEqual(tirePositions(2), ["1E", "1D", "2EE", "2EI", "2DI", "2DE"])
  assert.deepEqual(tripResult({ startKm: 1000, endKm: 2000, freightAmount: 8000, tollsAmount: 300, allowanceAmount: 200, otherCosts: 0 }, 2500), { distance: 1000, cost: 3000, result: 5000, costPerKm: 3 })
})
