// Regras do módulo Frota: cadastro de veículos/implementos, motoristas, manutenção,
// abastecimento, pneus, viagens e alertas de vencimento. Funções puras (testáveis).

export const vehicleTypes = [
  { value: "Caminhao", label: "Caminhão", road: true, motor: "km", cnh: "C" },
  { value: "Cavalo mecanico", label: "Cavalo mecânico", road: true, motor: "km", cnh: "E" },
  { value: "Semirreboque", label: "Semirreboque / carreta", road: true, motor: "", cnh: "E" },
  { value: "Reboque", label: "Reboque", road: true, motor: "", cnh: "E" },
  { value: "Utilitario", label: "Utilitário / van", road: true, motor: "km", cnh: "B" },
  { value: "Automovel", label: "Automóvel", road: true, motor: "km", cnh: "B" },
  { value: "Implemento", label: "Implemento (sem placa)", road: false, motor: "", cnh: "" },
  { value: "Maquina", label: "Máquina / empilhadeira", road: false, motor: "horimetro", cnh: "" },
] as const

export type VehicleTypeValue = (typeof vehicleTypes)[number]["value"]
export const vehicleStatuses = ["Disponivel", "Em uso", "Em manutencao", "Parado", "Vendido", "Inativo"] as const
export const vehicleStatusLabels: Record<string, string> = { Disponivel: "Disponível", "Em uso": "Em uso", "Em manutencao": "Em manutenção", Parado: "Parado", Vendido: "Vendido", Inativo: "Inativo" }
export const fuelTypes = ["Diesel S10", "Diesel S500", "Arla 32", "Gasolina", "Etanol", "GNV"]
export const cnhCategories = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"]
export const towingTypes = new Set(["Semirreboque", "Reboque"])

export const typeInfo = (type: string) => vehicleTypes.find((item) => item.value === type)

export type FleetVehicle = {
  id?: string
  vehicleType: string
  fleetNumber: string
  plate: string
  renavam: string
  chassis: string
  brand: string
  model: string
  manufactureYear: string
  modelYear: string
  color: string
  ownerName: string
  ownerDocument: string
  unitCompanyId: string
  bodyType: string
  loadCapacityKg: number
  tareKg: number
  axles: number
  currentKm: number
  currentHours: number
  driverId: string
  status: string
  acquisitionDate: string
  acquisitionValue: number
  licensingDueDate: string
  insurer: string
  policyNumber: string
  policyExpiry: string
  coupledVehicleId: string
  photoUrl: string
  notes: string
}

export type FleetDriver = { id?: string; name: string; cpf: string; phone: string; cnhNumber: string; cnhCategory: string; cnhExpiry: string; status: string; notes: string }

const digits = (value: string) => String(value || "").replace(/\D/g, "")

export function normalizePlate(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export function isValidPlate(value: string) {
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizePlate(value))
}

/** RENAVAM: 11 dígitos com dígito verificador (pesos 3,2,9,8,7,6,5,4,3,2). */
export function isValidRenavam(value: string) {
  const number = digits(value).padStart(11, "0")
  if (number.length !== 11 || /^0+$/.test(number)) return false
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce((total, weight, index) => total + weight * Number(number[index]), 0)
  const check = (sum * 10) % 11
  return (check === 10 ? 0 : check) === Number(number[10])
}

/** Chassi (VIN): 17 caracteres, sem I, O e Q. */
export function isValidVin(value: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(value || "").toUpperCase().trim())
}

/** Mensagem de erro ou "" quando o veículo pode ser salvo. `fleetNumbers`/`plates` = já usados por outros veículos. */
export function validateVehicle(vehicle: FleetVehicle, used: { fleetNumbers: string[]; plates: string[]; chassis: string[] } = { fleetNumbers: [], plates: [], chassis: [] }) {
  const info = typeInfo(vehicle.vehicleType)
  if (!info) return "Informe o tipo de veículo/implemento."
  if (!vehicle.fleetNumber.trim()) return "Informe o número da frota."
  if (used.fleetNumbers.some((value) => value.trim().toLowerCase() === vehicle.fleetNumber.trim().toLowerCase())) return `O número de frota ${vehicle.fleetNumber} já está em uso.`
  if (!vehicle.brand.trim() || !vehicle.model.trim()) return "Informe marca e modelo."
  if (!vehicle.ownerName.trim()) return "Informe o proprietário."
  if (!vehicle.unitCompanyId) return "Informe a unidade / filial."
  if (!(vehicleStatuses as readonly string[]).includes(vehicle.status)) return "Informe o status operacional."
  if (info.road) {
    if (!isValidPlate(vehicle.plate)) return "Placa obrigatória para veículo de estrada (ex.: ABC1D23 ou ABC1234)."
    if (!isValidRenavam(vehicle.renavam)) return "RENAVAM obrigatório e válido (11 dígitos) para veículo emplacado."
    if (!isValidVin(vehicle.chassis)) return "Chassi (VIN) obrigatório: 17 caracteres, sem I, O e Q."
    if (!vehicle.licensingDueDate) return "Informe o vencimento do licenciamento."
  } else {
    if (vehicle.plate && !isValidPlate(vehicle.plate)) return "Placa inválida."
    if (vehicle.renavam && !isValidRenavam(vehicle.renavam)) return "RENAVAM inválido."
    if (vehicle.chassis && !isValidVin(vehicle.chassis)) return "Chassi (VIN) inválido."
  }
  if (vehicle.plate && used.plates.includes(normalizePlate(vehicle.plate))) return "Já existe veículo com essa placa."
  if (vehicle.chassis && used.chassis.includes(vehicle.chassis.toUpperCase().trim())) return "Já existe veículo com esse chassi."
  if (info.motor === "km" && !(Number(vehicle.currentKm) >= 0)) return "Informe a quilometragem."
  if (info.motor === "horimetro" && !(Number(vehicle.currentHours) >= 0)) return "Informe o horímetro."
  const year = Number(vehicle.manufactureYear || 0)
  const modelYear = Number(vehicle.modelYear || 0)
  if (year && (year < 1950 || year > new Date().getFullYear() + 1)) return "Ano de fabricação inválido."
  if (year && modelYear && (modelYear < year || modelYear > year + 1)) return "Ano-modelo deve ser igual ou um ano após o de fabricação."
  if (Boolean(vehicle.insurer.trim()) !== Boolean(vehicle.policyExpiry)) return "Informe seguradora e vencimento da apólice juntos."
  if ([vehicle.loadCapacityKg, vehicle.tareKg, vehicle.axles, vehicle.acquisitionValue].some((value) => Number(value) < 0)) return "Capacidade, tara, eixos e valor não podem ser negativos."
  return ""
}

const cnhRank = (category: string) => Math.max(...String(category || "").toUpperCase().split("").map((letter) => ({ B: 1, C: 2, D: 3, E: 4 } as Record<string, number>)[letter] || 0), 0)

/** CNH vencida ou de categoria insuficiente para o tipo de veículo. */
export function driverCanDrive(driver: Pick<FleetDriver, "cnhCategory" | "cnhExpiry" | "name">, vehicleType: string, today = new Date().toISOString().slice(0, 10)) {
  const required = typeInfo(vehicleType)?.cnh || ""
  if (!required) return ""
  if (!driver.cnhExpiry || driver.cnhExpiry < today) return `CNH de ${driver.name} vencida.`
  if (cnhRank(driver.cnhCategory) < cnhRank(required)) return `${driver.name} tem CNH ${driver.cnhCategory || "sem categoria"}; ${typeInfo(vehicleType)!.label} exige categoria ${required}.`
  return ""
}

export function validateDriver(driver: FleetDriver) {
  if (!driver.name.trim()) return "Informe o nome do motorista."
  if (digits(driver.cpf).length !== 11) return "CPF deve ter 11 dígitos."
  if (digits(driver.cnhNumber).length !== 11) return "Número da CNH deve ter 11 dígitos."
  if (!cnhCategories.includes(driver.cnhCategory)) return "Informe a categoria da CNH."
  if (!driver.cnhExpiry) return "Informe a validade da CNH."
  return ""
}

/** Engate: só cavalo mecânico puxa semirreboque/reboque. */
export function validateCoupling(tractorType: string, trailerType: string) {
  if (tractorType !== "Cavalo mecanico" && tractorType !== "Caminhao") return "Somente cavalo mecânico ou caminhão pode engatar implemento."
  if (!towingTypes.has(trailerType)) return "Só é possível engatar semirreboque ou reboque."
  if (tractorType === "Caminhao" && trailerType === "Semirreboque") return "Semirreboque engata em cavalo mecânico."
  return ""
}

export type FuelEntry = { vehicleId: string; fuelDate: string; liters: number; pricePerLiter: number; odometer: number; fullTank?: boolean }

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function fuelTotal(entry: Pick<FuelEntry, "liters" | "pricePerLiter">) {
  return round2(Number(entry.liters || 0) * Number(entry.pricePerLiter || 0))
}

/** Odômetro não pode voltar em relação ao último abastecimento do veículo. */
export function validateFuel(entry: FuelEntry, lastOdometer: number) {
  if (!entry.vehicleId) return "Informe o veículo."
  if (!entry.fuelDate) return "Informe a data."
  if (!(Number(entry.liters) > 0)) return "Litros devem ser maiores que zero."
  if (!(Number(entry.pricePerLiter) > 0)) return "Preço por litro deve ser maior que zero."
  if (Number(entry.odometer) > 0 && Number(entry.odometer) < Number(lastOdometer || 0)) return `Quilometragem menor que a do último abastecimento (${lastOdometer}).`
  return ""
}

/** Consumo médio (km/L) entre abastecimentos consecutivos com odômetro. */
export function fuelConsumption(entries: FuelEntry[]) {
  const sorted = entries.filter((item) => Number(item.odometer) > 0).sort((a, b) => Number(a.odometer) - Number(b.odometer))
  if (sorted.length < 2) return null
  const distance = Number(sorted[sorted.length - 1].odometer) - Number(sorted[0].odometer)
  const liters = sorted.slice(1).reduce((sum, item) => sum + Number(item.liters || 0), 0)
  return liters > 0 ? round2(distance / liters) : null
}

/** Horas parado entre a parada e a liberação do veículo. */
export function downtimeHours(stoppedAt: string, releasedAt: string) {
  if (!stoppedAt || !releasedAt) return null
  const hours = (new Date(releasedAt).getTime() - new Date(stoppedAt).getTime()) / 3_600_000
  return Number.isFinite(hours) && hours >= 0 ? round2(hours) : null
}

export type FleetAlert = { kind: string; vehicleOrDriver: string; description: string; dueDate?: string; overdue: boolean }

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Vencimentos: licenciamento, apólice, CNH, documentos e manutenções por data ou por km/horas. */
export function fleetAlerts(input: {
  vehicles: Array<{ id: string; label: string; licensingDueDate?: string; policyExpiry?: string; currentKm?: number; currentHours?: number; status?: string }>
  drivers: Array<{ name: string; cnhExpiry?: string; status?: string }>
  documents: Array<{ vehicleId: string; docType: string; expiryDate?: string }>
  maintenance: Array<{ vehicleId: string; description: string; nextDate?: string; nextKm?: number; nextHours?: number }>
}, today = new Date().toISOString().slice(0, 10), days = 30, kmMargin = 1000) {
  const limit = addDays(today, days)
  const alerts: FleetAlert[] = []
  const active = input.vehicles.filter((vehicle) => !["Vendido", "Inativo"].includes(vehicle.status || ""))
  const label = (id: string) => input.vehicles.find((vehicle) => vehicle.id === id)?.label || "-"
  const dateAlert = (kind: string, who: string, description: string, date?: string) => {
    if (date && date <= limit) alerts.push({ kind, vehicleOrDriver: who, description, dueDate: date, overdue: date < today })
  }
  active.forEach((vehicle) => {
    dateAlert("Licenciamento", vehicle.label, "Licenciamento", vehicle.licensingDueDate)
    dateAlert("Seguro", vehicle.label, "Apólice de seguro", vehicle.policyExpiry)
  })
  input.drivers.filter((driver) => driver.status !== "Inativo").forEach((driver) => dateAlert("CNH", driver.name, "Validade da CNH", driver.cnhExpiry))
  input.documents.filter((doc) => active.some((vehicle) => vehicle.id === doc.vehicleId)).forEach((doc) => dateAlert("Documento", label(doc.vehicleId), doc.docType, doc.expiryDate))
  input.maintenance.forEach((item) => {
    const vehicle = active.find((row) => row.id === item.vehicleId)
    if (!vehicle) return
    dateAlert("Manutenção", vehicle.label, item.description, item.nextDate)
    if (item.nextKm && Number(vehicle.currentKm || 0) >= Number(item.nextKm) - kmMargin) {
      alerts.push({ kind: "Manutenção", vehicleOrDriver: vehicle.label, description: `${item.description} (próxima em ${item.nextKm} km; atual ${vehicle.currentKm} km)`, overdue: Number(vehicle.currentKm || 0) >= Number(item.nextKm) })
    }
    if (item.nextHours && Number(vehicle.currentHours || 0) >= Number(item.nextHours) - 50) {
      alerts.push({ kind: "Manutenção", vehicleOrDriver: vehicle.label, description: `${item.description} (próxima em ${item.nextHours} h; atual ${vehicle.currentHours} h)`, overdue: Number(vehicle.currentHours || 0) >= Number(item.nextHours) })
    }
  })
  return alerts.sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")))
}

/** Posições de pneus pelo número de eixos: eixo 1 simples; demais em rodado duplo. */
export function tirePositions(axles: number, firstAxleSingle = true) {
  const positions: string[] = []
  for (let axle = 1; axle <= Math.max(0, Math.min(Number(axles) || 0, 9)); axle++) {
    if (axle === 1 && firstAxleSingle) positions.push(`${axle}E`, `${axle}D`)
    else positions.push(`${axle}EE`, `${axle}EI`, `${axle}DI`, `${axle}DE`)
  }
  return positions
}

/** Custo e resultado de uma viagem. */
export function tripResult(trip: { startKm: number; endKm: number; freightAmount: number; tollsAmount: number; allowanceAmount: number; otherCosts: number }, fuelCost: number) {
  const distance = Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0))
  const cost = round2(Number(fuelCost || 0) + Number(trip.tollsAmount || 0) + Number(trip.allowanceAmount || 0) + Number(trip.otherCosts || 0))
  return { distance, cost, result: round2(Number(trip.freightAmount || 0) - cost), costPerKm: distance ? round2(cost / distance) : null }
}
