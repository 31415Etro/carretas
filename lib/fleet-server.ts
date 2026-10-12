import type { createAdminClient } from "@/lib/supabase/server"
import { downtimeHours, driverCanDrive, fuelTotal, normalizePlate, tirePositions, typeInfo, validateCoupling, validateDriver, validateFuel, validateVehicle, type FleetDriver, type FleetVehicle } from "@/lib/fleet"

type Admin = ReturnType<typeof createAdminClient>
type Kind = "s" | "n" | "d" | "t"
type Field = [camel: string, snake: string, kind: Kind]

export const FLEET_MIGRATION_HINT = "Módulo Frota ainda não instalado no banco. Rode scripts/208_frota_erp.sql no SQL Editor do Supabase."
export const isFleetMissing = (message: string) => /Could not find the (table|column)|relation .* does not exist|column .* does not exist/i.test(message)

const fieldSets: Record<string, { table: string; order: [string, boolean][]; fields: Field[] }> = {
  vehicles: {
    table: "vehicles", order: [["fleet_number", true]],
    fields: [
      ["vehicleType", "vehicle_type", "s"], ["fleetNumber", "fleet_number", "s"], ["plate", "plate", "s"], ["renavam", "renavam", "s"], ["chassis", "chassis", "s"],
      ["brand", "brand", "s"], ["model", "model", "s"], ["manufactureYear", "manufacture_year", "n"], ["modelYear", "model_year", "n"], ["color", "color", "s"],
      ["ownerName", "owner_name", "s"], ["ownerDocument", "owner_document", "s"], ["unitCompanyId", "unit_company_id", "s"], ["bodyType", "body_type", "s"],
      ["loadCapacityKg", "load_capacity_kg", "n"], ["tareKg", "tare_kg", "n"], ["axles", "axles", "n"], ["currentKm", "current_km", "n"], ["currentHours", "current_hours", "n"],
      ["driverId", "driver_id", "s"], ["status", "status", "t"], ["acquisitionDate", "acquisition_date", "d"], ["acquisitionValue", "acquisition_value", "n"],
      ["licensingDueDate", "licensing_due_date", "d"], ["insurer", "insurer", "s"], ["policyNumber", "policy_number", "s"], ["policyExpiry", "policy_expiry", "d"],
      ["coupledVehicleId", "coupled_vehicle_id", "s"], ["photoPath", "photo_path", "s"], ["notes", "notes", "s"],
    ],
  },
  drivers: {
    table: "fleet_drivers", order: [["name", true]],
    fields: [["name", "name", "t"], ["cpf", "cpf", "t"], ["phone", "phone", "s"], ["cnhNumber", "cnh_number", "t"], ["cnhCategory", "cnh_category", "t"], ["cnhExpiry", "cnh_expiry", "d"], ["status", "status", "t"], ["notes", "notes", "s"]],
  },
  documents: {
    table: "vehicle_documents", order: [["created_at", false]],
    fields: [["vehicleId", "vehicle_id", "t"], ["docType", "doc_type", "t"], ["description", "description", "s"], ["expiryDate", "expiry_date", "d"], ["filePath", "file_path", "s"], ["fileName", "file_name", "s"]],
  },
  maintenance: {
    table: "vehicle_maintenance", order: [["start_date", false]],
    fields: [
      ["vehicleId", "vehicle_id", "t"], ["maintenanceType", "maintenance_type", "t"], ["startDate", "start_date", "d"], ["endDate", "end_date", "d"], ["odometer", "odometer", "n"], ["hours", "hours", "n"],
      ["serviceDescription", "service_description", "s"], ["serviceOrderId", "service_order_id", "s"], ["partsReplaced", "parts_replaced", "s"], ["workshop", "workshop", "s"],
      ["partsCost", "parts_cost", "n"], ["laborCost", "labor_cost", "n"], ["nextDate", "next_date", "d"], ["nextKm", "next_km", "n"], ["nextHours", "next_hours", "n"],
      ["stoppedAt", "stopped_at", "s"], ["releasedAt", "released_at", "s"], ["releasedBy", "released_by", "s"], ["status", "status", "t"],
    ],
  },
  fuel: {
    table: "fuel_entries", order: [["fuel_date", false]],
    fields: [
      ["vehicleId", "vehicle_id", "t"], ["driverId", "driver_id", "s"], ["fuelDate", "fuel_date", "d"], ["station", "station", "s"], ["fuelType", "fuel_type", "t"], ["liters", "liters", "n"],
      ["pricePerLiter", "price_per_liter", "n"], ["odometer", "odometer", "n"], ["receiptPath", "receipt_path", "s"], ["receiptName", "receipt_name", "s"], ["notes", "notes", "s"],
    ],
  },
  tires: {
    table: "vehicle_tires", order: [["position", true]],
    fields: [["vehicleId", "vehicle_id", "t"], ["position", "position", "t"], ["serialNumber", "serial_number", "s"], ["brand", "brand", "s"], ["size", "size", "s"], ["fittedDate", "fitted_date", "d"], ["fittedKm", "fitted_km", "n"], ["condition", "condition", "t"], ["notes", "notes", "s"]],
  },
  trips: {
    table: "trips", order: [["start_date", false]],
    fields: [
      ["vehicleId", "vehicle_id", "t"], ["trailerId", "trailer_id", "s"], ["driverId", "driver_id", "s"], ["clientId", "client_id", "s"], ["origin", "origin", "s"], ["destination", "destination", "s"],
      ["startDate", "start_date", "d"], ["endDate", "end_date", "d"], ["startKm", "start_km", "n"], ["endKm", "end_km", "n"], ["freightAmount", "freight_amount", "n"], ["tollsAmount", "tolls_amount", "n"],
      ["allowanceAmount", "allowance_amount", "n"], ["otherCosts", "other_costs", "n"], ["status", "status", "t"], ["notes", "notes", "s"],
    ],
  },
}

export const fleetEntities = Object.keys(fieldSets)

/** Colunas numéricas NOT NULL (default 0): vazio vira 0 em vez de null. */
const zeroWhenEmpty = new Set(["load_capacity_kg", "tare_kg", "axles", "current_km", "current_hours", "acquisition_value", "parts_cost", "labor_cost", "start_km", "freight_amount", "tolls_amount", "allowance_amount", "other_costs"])

const readValue = (value: unknown, kind: Kind, column = "") => {
  if (kind === "n") return value === "" || value == null ? (zeroWhenEmpty.has(column) ? 0 : null) : Number(String(value).replace(",", "."))
  const text = String(value ?? "").trim()
  return kind === "t" ? text : text || null
}

/** Linha do banco -> objeto camelCase (campos nulos viram "" ou 0). */
export function fromRow(entity: string, row: any) {
  const out: Record<string, any> = { id: row.id }
  for (const [camel, snake, kind] of fieldSets[entity].fields) out[camel] = kind === "n" ? (row[snake] == null ? 0 : Number(row[snake])) : row[snake] ?? ""
  if (entity === "vehicles") out.internalCode = row.internal_code || ""
  if (entity === "fuel") out.totalAmount = Number(row.total_amount || 0)
  if (entity === "maintenance") out.downtimeHours = row.downtime_hours == null ? null : Number(row.downtime_hours)
  if (["documents", "fuel", "tires", "drivers", "vehicles", "maintenance", "trips"].includes(entity)) out.createdAt = row.created_at
  return out
}

function toRow(entity: string, item: Record<string, any>) {
  const row: Record<string, any> = {}
  for (const [camel, snake, kind] of fieldSets[entity].fields) row[snake] = readValue(item[camel], kind, snake)
  if (item.id) row.id = item.id
  return row
}

const asVehicle = (item: Record<string, any>): FleetVehicle => ({
  vehicleType: String(item.vehicleType || ""), fleetNumber: String(item.fleetNumber || ""), plate: normalizePlate(item.plate), renavam: String(item.renavam || "").replace(/\D/g, ""), chassis: String(item.chassis || "").toUpperCase().trim(),
  brand: String(item.brand || ""), model: String(item.model || ""), manufactureYear: String(item.manufactureYear || ""), modelYear: String(item.modelYear || ""), color: String(item.color || ""),
  ownerName: String(item.ownerName || ""), ownerDocument: String(item.ownerDocument || ""), unitCompanyId: String(item.unitCompanyId || ""), bodyType: String(item.bodyType || ""),
  loadCapacityKg: Number(item.loadCapacityKg) || 0, tareKg: Number(item.tareKg) || 0, axles: Number(item.axles) || 0, currentKm: Number(item.currentKm) || 0, currentHours: Number(item.currentHours) || 0,
  driverId: String(item.driverId || ""), status: String(item.status || ""), acquisitionDate: String(item.acquisitionDate || ""), acquisitionValue: Number(item.acquisitionValue) || 0,
  licensingDueDate: String(item.licensingDueDate || ""), insurer: String(item.insurer || ""), policyNumber: String(item.policyNumber || ""), policyExpiry: String(item.policyExpiry || ""),
  coupledVehicleId: String(item.coupledVehicleId || ""), photoUrl: "", notes: String(item.notes || ""),
})

const today = () => new Date().toISOString().slice(0, 10)
const fail = (message: string): never => { throw new Error(message) }

async function loadDriver(admin: Admin, id: string): Promise<FleetDriver | null> {
  if (!id) return null
  const { data } = await admin.from("fleet_drivers").select("*").eq("id", id).maybeSingle()
  return data ? (fromRow("drivers", data) as FleetDriver) : null
}

async function loadVehicleRow(admin: Admin, id: string) {
  const { data } = await admin.from("vehicles").select("*").eq("id", id).maybeSingle()
  return data
}

function checkDriver(driver: FleetDriver | null, vehicleType: string) {
  if (!driver) return ""
  if (driver.status === "Inativo") return `Motorista ${driver.name} está inativo.`
  return driverCanDrive(driver, vehicleType, today())
}

async function saveVehicle(admin: Admin, item: Record<string, any>) {
  const vehicle = asVehicle(item)
  const { data: others } = await admin.from("vehicles").select("id, fleet_number, plate, chassis").neq("id", item.id || "00000000-0000-0000-0000-000000000000")
  const used = {
    fleetNumbers: (others || []).map((row) => String(row.fleet_number || "")).filter(Boolean),
    plates: (others || []).map((row) => normalizePlate(row.plate || "")).filter(Boolean),
    chassis: (others || []).map((row) => String(row.chassis || "").toUpperCase()).filter(Boolean),
  }
  const message = validateVehicle(vehicle, used)
  if (message) fail(message)
  if (vehicle.driverId) {
    const error = checkDriver(await loadDriver(admin, vehicle.driverId), vehicle.vehicleType)
    if (error) fail(error)
  }
  if (vehicle.coupledVehicleId) {
    if (vehicle.coupledVehicleId === item.id) fail("Um veículo não pode ser engatado a ele mesmo.")
    const other = await loadVehicleRow(admin, vehicle.coupledVehicleId)
    if (!other) fail("Veículo engatado não encontrado.")
    const error = typeInfo(vehicle.vehicleType)?.motor ? validateCoupling(vehicle.vehicleType, other!.vehicle_type) : validateCoupling(other!.vehicle_type, vehicle.vehicleType)
    if (error) fail(error)
  }
  const row = toRow("vehicles", { ...item, plate: vehicle.plate, renavam: vehicle.renavam, chassis: vehicle.chassis })
  const { data, error } = await admin.from("vehicles").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  // engate é simétrico: o implemento aponta de volta para o cavalo e libera o par anterior
  if (data.coupled_vehicle_id) await admin.from("vehicles").update({ coupled_vehicle_id: data.id }).eq("id", data.coupled_vehicle_id)
  await admin.from("vehicles").update({ coupled_vehicle_id: null }).eq("coupled_vehicle_id", data.id).neq("id", data.coupled_vehicle_id || "00000000-0000-0000-0000-000000000000")
  return data
}

async function saveMaintenance(admin: Admin, item: Record<string, any>) {
  if (!item.vehicleId) fail("Informe o veículo.")
  if (!["Preventiva", "Corretiva"].includes(item.maintenanceType)) fail("Informe o tipo: preventiva ou corretiva.")
  if (!item.startDate) fail("Informe a data da manutenção.")
  if (!String(item.serviceDescription || "").trim()) fail("Descreva o serviço executado.")
  if (item.endDate && item.endDate < item.startDate) fail("A data de término não pode ser anterior ao início.")
  if ([item.partsCost, item.laborCost].some((value) => Number(value) < 0)) fail("Custos não podem ser negativos.")
  if (item.nextDate && item.nextDate <= item.startDate) fail("A próxima manutenção por data deve ser posterior à atual.")
  if (item.nextKm && Number(item.nextKm) <= Number(item.odometer || 0)) fail("A próxima manutenção por km deve ser maior que o km atual.")
  const vehicle = await loadVehicleRow(admin, item.vehicleId)
  if (!vehicle) fail("Veículo não encontrado.")
  const status = item.status || "Programada"
  if (status === "Realizada" && !String(item.releasedBy || "").trim()) fail("Informe o responsável pela liberação do veículo.")
  const stoppedAt = item.stoppedAt || (status === "Em andamento" ? new Date().toISOString() : "")
  const releasedAt = item.releasedAt || (status === "Realizada" ? new Date().toISOString() : "")
  const downtime = stoppedAt && releasedAt ? downtimeHours(stoppedAt, releasedAt) : null
  if (stoppedAt && releasedAt && downtime == null) fail("A liberação não pode ser anterior à parada.")
  const row = { ...toRow("maintenance", { ...item, status, stoppedAt, releasedAt }), downtime_hours: downtime, type: item.maintenanceType, date: item.startDate }
  const { data, error } = await admin.from("vehicle_maintenance").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  // reflete no veículo: km/horímetro maiores e situação operacional
  const patch: Record<string, any> = {}
  if (Number(item.odometer) > Number(vehicle!.current_km || 0)) patch.current_km = Number(item.odometer)
  if (Number(item.hours) > Number(vehicle!.current_hours || 0)) patch.current_hours = Number(item.hours)
  if (status === "Em andamento") patch.status = "Em manutencao"
  if (status === "Realizada" && vehicle!.status === "Em manutencao") patch.status = "Disponivel"
  if (Object.keys(patch).length) await admin.from("vehicles").update(patch).eq("id", item.vehicleId)
  return data
}

async function saveFuel(admin: Admin, item: Record<string, any>, responsible: string) {
  const entry = { vehicleId: String(item.vehicleId || ""), fuelDate: String(item.fuelDate || ""), liters: Number(item.liters) || 0, pricePerLiter: Number(item.pricePerLiter) || 0, odometer: Number(item.odometer) || 0 }
  const vehicle = entry.vehicleId ? await loadVehicleRow(admin, entry.vehicleId) : null
  if (entry.vehicleId && !vehicle) fail("Veículo não encontrado.")
  if (!item.fuelType) fail("Informe o combustível.")
  if (entry.fuelDate > today()) fail("A data do abastecimento não pode ser futura.")
  const { data: previous } = await admin.from("fuel_entries").select("odometer").eq("vehicle_id", entry.vehicleId).lte("fuel_date", entry.fuelDate).not("odometer", "is", null).neq("id", item.id || "00000000-0000-0000-0000-000000000000").order("fuel_date", { ascending: false }).order("odometer", { ascending: false }).limit(1)
  const message = validateFuel(entry, Number(previous?.[0]?.odometer || 0))
  if (message) fail(message)
  if (item.driverId) {
    const error = checkDriver(await loadDriver(admin, item.driverId), vehicle!.vehicle_type)
    if (error) fail(error)
  }
  const row = { ...toRow("fuel", item), total_amount: fuelTotal(entry), created_by: responsible }
  const { data, error } = await admin.from("fuel_entries").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  if (entry.odometer > Number(vehicle!.current_km || 0)) await admin.from("vehicles").update({ current_km: entry.odometer }).eq("id", entry.vehicleId)
  return data
}

async function saveTrip(admin: Admin, item: Record<string, any>) {
  if (!item.vehicleId) fail("Informe o veículo (cavalo mecânico ou caminhão).")
  if (!item.startDate) fail("Informe a data de saída.")
  if (item.endDate && item.endDate < item.startDate) fail("A chegada não pode ser anterior à saída.")
  if (item.endKm && Number(item.endKm) < Number(item.startKm || 0)) fail("Km final menor que o km inicial.")
  if (["Concluída"].includes(item.status) && (!item.endDate || !item.endKm)) fail("Para concluir a viagem informe a chegada e o km final.")
  const vehicle = await loadVehicleRow(admin, item.vehicleId)
  if (!vehicle) fail("Veículo não encontrado.")
  if (item.trailerId) {
    const trailer = await loadVehicleRow(admin, item.trailerId)
    if (!trailer) fail("Semirreboque não encontrado.")
    const error = validateCoupling(vehicle!.vehicle_type, trailer!.vehicle_type)
    if (error) fail(error)
  }
  if (item.driverId) {
    const error = checkDriver(await loadDriver(admin, item.driverId), vehicle!.vehicle_type)
    if (error) fail(error)
  }
  const { data, error } = await admin.from("trips").upsert(toRow("trips", item), { onConflict: "id" }).select("*").single()
  if (error) throw error
  if (item.status === "Concluída" && Number(item.endKm) > Number(vehicle!.current_km || 0)) await admin.from("vehicles").update({ current_km: Number(item.endKm) }).eq("id", item.vehicleId)
  return data
}

/** Valida e grava um registro da Frota; devolve o registro já no formato da tela. */
export async function saveFleetItem(admin: Admin, entity: string, item: Record<string, any>, responsible: string) {
  if (!fieldSets[entity]) fail("Cadastro desconhecido.")
  let row: any
  if (entity === "vehicles") row = await saveVehicle(admin, item)
  else if (entity === "maintenance") row = await saveMaintenance(admin, item)
  else if (entity === "fuel") row = await saveFuel(admin, item, responsible)
  else if (entity === "trips") row = await saveTrip(admin, item)
  else {
    if (entity === "drivers") {
      const driver = { name: String(item.name || ""), cpf: String(item.cpf || ""), phone: String(item.phone || ""), cnhNumber: String(item.cnhNumber || ""), cnhCategory: String(item.cnhCategory || ""), cnhExpiry: String(item.cnhExpiry || ""), status: item.status || "Ativo", notes: "" }
      const message = validateDriver(driver)
      if (message) fail(message)
      item = { ...item, cpf: driver.cpf.replace(/\D/g, ""), cnhNumber: driver.cnhNumber.replace(/\D/g, ""), status: driver.status }
    }
    if (entity === "documents" && (!item.vehicleId || !String(item.docType || "").trim())) fail("Informe o veículo e o tipo do documento.")
    if (entity === "tires") {
      if (!item.vehicleId || !item.position) fail("Informe o veículo e a posição do pneu.")
      const vehicle = await loadVehicleRow(admin, item.vehicleId)
      if (!vehicle) fail("Veículo não encontrado.")
      if (!tirePositions(vehicle!.axles).includes(item.position)) fail(`Posição ${item.position} não existe em um veículo de ${vehicle!.axles || 0} eixo(s).`)
      const { data, error } = await admin.from("vehicle_tires").upsert(toRow("tires", { ...item, id: undefined }), { onConflict: "vehicle_id,position" }).select("*").single()
      if (error) throw error
      return fromRow("tires", data)
    }
    const { data, error } = await admin.from(fieldSets[entity].table).upsert(toRow(entity, item), { onConflict: "id" }).select("*").single()
    if (error) throw error
    row = data
  }
  return fromRow(entity, row)
}

export async function listFleet(admin: Admin, entity: string, filters: { vehicleId?: string } = {}) {
  const set = fieldSets[entity]
  if (!set) fail("Cadastro desconhecido.")
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let query = admin.from(set.table).select("*")
    if (filters.vehicleId && set.fields.some((field) => field[1] === "vehicle_id")) query = query.eq("vehicle_id", filters.vehicleId)
    for (const [column, ascending] of set.order) query = query.order(column, { ascending })
    const { data, error } = await query.range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return rows.map((row) => fromRow(entity, row))
}

export function fleetError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isFleetMissing(message)) return { message: FLEET_MIGRATION_HINT, status: 503 }
  if (/duplicate key/.test(message)) {
    const hint = /fleet_number/.test(message) ? "número de frota" : /chassis/.test(message) ? "chassi" : /plate/.test(message) ? "placa" : /cpf/.test(message) ? "CPF" : "dado"
    return { message: `Já existe um registro com esse ${hint}.`, status: 400 }
  }
  if (/violates foreign key/.test(message)) return { message: "Registro vinculado a outros dados; inative em vez de excluir.", status: 400 }
  return { message, status: 400 }
}
