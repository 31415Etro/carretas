import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import nextEnv from "@next/env"
import { createClient } from "@supabase/supabase-js"
import XLSX from "xlsx"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const APPLY = process.argv.includes("--apply")
const CHUNK_SIZE = 200
const fileName = fs.readdirSync(process.cwd()).find((name) =>
  /RELA.*SETORES.*EQUIPAMENTOS.*new\.xlsx$/i.test(name),
)

if (!fileName) throw new Error("Planilha RELACAO DE SETORES E EQUIPAMENTOS - new.xlsx nao encontrada.")

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const key = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const clientAliases = new Map(Object.entries({
  "CONCORDIA - ITAPEMA": "CONCORDIA DEPOSITO DE MERCADORIAS LTDA",
  "CONEXAO MARITIMA": "CONEXAO MARITIMA - SERVICOS LOGISTICOS S.A.",
  "EDUARDA MORAUER ESTETICA AVANCADA": "ESTETICA AVANCADA E.M. LTDA",
  "ITAMIRIM": "ITAMIRIM CLUBE DE CAMPO",
  "LABOR IMPORT": "LABOR IMPORT COMERCIAL IMPORTADORA EXPORTADORA LTDA",
  "LEAL": "INDUSTRIA E COMERCIO LEAL LTDA",
  "MSC ITAJAI": "MSC MEDITERRANEAN SHIPPING DO BRASIL LTDA",
  "MSC NAVEGANTES": "MSC MEDITERRANEAN LOGISTICA LTDA (NAVEGANTES)",
  "NEXT SHIPPING": "NEXT SHIPPING LOGISTICA INTERNACIONAL LTDA",
  "STARK STUDIO PILATES": "STARK STUDIO PILATES LTDA",
  "THYSSENKRUPP ESTALEIRO BRASIL SUL": "TKMS ESTALEIRO BRASIL SUL LTDA.",
}).map(([source, target]) => [key(source), key(target)]))

function uuidFromText(value) {
  const hash = createHash("sha1").update(value).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function environmentName(description, code) {
  const text = clean(description)
  if (!code) return text
  return text.replace(new RegExp(`^${escapeRegex(clean(code))}\\s*-?\\s*`, "i"), "").trim() || text
}

function capacityFromEquipment(value) {
  const text = clean(value)
  const btu = text.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*BTU(?:S|\/H)?/i)
  if (btu) {
    const amount = Number(btu[1].replace(/\D/g, ""))
    return { label: `${amount.toLocaleString("pt-BR")} BTU/h`, btu: amount }
  }
  const compactBtu = text.match(/\b(7|9|10|12|18|20|22|24|28|30|32|36|42|46|48|54|55|60)\s*K(?:\s*BTU(?:S|\/H)?)?\b/i)
  if (compactBtu) {
    const amount = Number(compactBtu[1]) * 1000
    return { label: `${amount.toLocaleString("pt-BR")} BTU/h`, btu: amount }
  }
  const inferredBtu = text.match(/\b(\d{1,3}[.]\d{3})\b/)
  if (inferredBtu) {
    const amount = Number(inferredBtu[1].replace(/\D/g, ""))
    return { label: `${amount.toLocaleString("pt-BR")} BTU/h`, btu: amount }
  }
  const tr = text.match(/(\d+(?:[.,]\d+)?)\s*TR\b/i)
  if (tr) return { label: `${tr[1].replace(",", ".")} TR`, btu: 0 }
  return { label: "", btu: 0 }
}

const equipmentBrands = [
  "SPRINGER MIDEA", "MITSUBISHI", "ELECTROLUX", "SPRINGER", "CARRIER", "FUJITSU",
  "SAMSUNG", "AGRATTO", "HITACHI", "KOMECO", "PHILCO", "DAIKIN", "ELGIN",
  "MIDEA", "GREE", "TRANE", "YORK", "CONSUL", "BRASTEMP", "TCL", "LG",
]

function equipmentMetadata(value) {
  const normalized = key(value)
  const brand = equipmentBrands.find((item) => new RegExp(`\\b${escapeRegex(key(item))}\\b`, "i").test(normalized)) || ""
  if (/DUTAD/.test(normalized)) return { type: "Split", brand, model: "Dutado" }
  if (/PISO\s*TETO|\bPT\b/.test(normalized)) return { type: "Split", brand, model: "Piso Teto" }
  if (/HI\s*WALL|HIGH\s*WALL|\bHW\b/.test(normalized)) return { type: "Split", brand, model: "Hi Wall" }
  if (/\bK7\b|CASSET/.test(normalized)) return { type: "Split", brand, model: "Cassete" }
  if (/\bVRF\b/.test(normalized)) return { type: "VRF", brand, model: "VRF" }
  if (/JANELA|\bACJ\b/.test(normalized)) return { type: "Ar-condicionado", brand, model: "Janela" }
  if (/FAN\s*COIL/.test(normalized)) return { type: "Fan Coil", brand, model: "Fan Coil" }
  if (/CHILLER/.test(normalized)) return { type: "Chiller", brand, model: "Chiller" }
  if (/SPLIT/.test(normalized)) return { type: "Split", brand, model: "Split" }
  return { type: "Ar-condicionado", brand, model: "" }
}

async function allRows(supabase, table, columns) {
  const result = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    result.push(...(data || []))
    if (!data || data.length < 1000) return result
  }
}

async function upsertChunks(supabase, table, rows) {
  if (!APPLY) return
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "id" })
    if (error) throw new Error(`${table} [${index}-${index + chunk.length}]: ${error.message}`)
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) throw new Error("Variaveis do Supabase ausentes em .env.local.")

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
const workbook = XLSX.readFile(path.join(process.cwd(), fileName))
const worksheet = workbook.Sheets[workbook.SheetNames[0]]
const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false })

const parsedRows = sourceRows.map((row, sourceIndex) => {
  const clientName = clean(row.Cliente)
  const environmentCode = clean(row.Cd_Ambiente)
  const environmentRaw = clean(row.Ds_Ambiente)
  const equipmentTag = clean(row.Cd_equipamento)
  const equipmentName = clean(row.Ds_Equipamento)
  const capacity = capacityFromEquipment(equipmentName)
  const metadata = equipmentMetadata(equipmentName)
  return {
    sourceIndex: sourceIndex + 2,
    clientName,
    environmentCode,
    environmentRaw,
    environmentName: environmentName(environmentRaw, environmentCode),
    equipmentTag,
    equipmentName,
    capacity: capacity.label,
    capacityBtu: capacity.btu,
    ...metadata,
  }
}).filter((row) => row.clientName && row.environmentName && row.equipmentName)

const existingClients = await allRows(supabase, "clients", "id,name,type,status,service_contexts")
const existingEnvironments = await allRows(
  supabase,
  "client_environments",
  "id,client_id,name,location,floor,activity_type,equipment_description,thermal_load,occupants_total,occupants_fixed,occupants_floating,air_conditioned_area,notes,status",
)
const existingEquipment = await allRows(
  supabase,
  "client_equipment",
  "id,client_id,client_environment_id,tag,name,type,brand,model,serial_number,capacity,notes,status",
)

const clientByName = new Map(existingClients.map((client) => [key(client.name), client]))
const clientRows = new Map()

for (const row of parsedRows) {
  const sourceClientKey = key(row.clientName)
  const lookupClientKey = clientAliases.get(sourceClientKey) || sourceClientKey
  let client = clientByName.get(lookupClientKey)
  if (!client) {
    client = {
      id: uuidFromText(`climate-client:${key(row.clientName)}`),
      name: row.clientName,
      type: "PJ",
      status: "Ativo",
      service_contexts: ["pmoc"],
    }
    clientByName.set(key(row.clientName), client)
  } else {
    client = {
      ...client,
      service_contexts: Array.from(new Set([...(client.service_contexts || []), "pmoc"])),
    }
    clientByName.set(key(row.clientName), client)
  }
  clientRows.set(client.id, {
    id: client.id,
    name: client.name,
    type: client.type || "PJ",
    status: client.status || "Ativo",
    service_contexts: client.service_contexts,
  })
  row.clientId = client.id
}

const environmentByCode = new Map()
const environmentByName = new Map()
for (const environment of existingEnvironments) {
  if (environment.location) environmentByCode.set(`${environment.client_id}|${key(environment.location)}`, environment)
  environmentByName.set(`${environment.client_id}|${key(environment.name)}`, environment)
}

const sourceEnvironmentGroups = new Map()
for (const row of parsedRows) {
  const groupKey = `${row.clientId}|${key(row.environmentCode || row.environmentName)}`
  const group = sourceEnvironmentGroups.get(groupKey) || { rows: [] }
  group.rows.push(row)
  sourceEnvironmentGroups.set(groupKey, group)
}

const environmentRows = []
const sourceEnvironmentId = new Map()
for (const [groupKey, group] of sourceEnvironmentGroups) {
  const first = group.rows[0]
  const existing =
    environmentByCode.get(`${first.clientId}|${key(first.environmentCode)}`) ||
    environmentByName.get(`${first.clientId}|${key(first.environmentName)}`) ||
    environmentByName.get(`${first.clientId}|${key(first.environmentRaw)}`)
  const id = existing?.id || uuidFromText(`climate-environment:${groupKey}`)
  const environment = {
    id,
    client_id: first.clientId,
    name: first.environmentName,
    location: first.environmentCode,
    floor: existing?.floor || "",
    activity_type: existing?.activity_type || "",
    equipment_description: "",
    thermal_load: "",
    occupants_total: Number(existing?.occupants_total || 0),
    occupants_fixed: Number(existing?.occupants_fixed || 0),
    occupants_floating: Number(existing?.occupants_floating || 0),
    air_conditioned_area: Number(existing?.air_conditioned_area || 0),
    notes: existing?.notes || `Importado de ${fileName}`,
    status: existing?.status || "Ativo",
  }
  environmentRows.push(environment)
  sourceEnvironmentId.set(groupKey, id)
  for (const row of group.rows) row.environmentId = id
}

const equipmentByTag = new Map()
const equipmentByName = new Map()
for (const equipment of existingEquipment) {
  if (equipment.tag) equipmentByTag.set(`${equipment.client_environment_id}|${key(equipment.tag)}`, equipment)
  equipmentByName.set(`${equipment.client_environment_id}|${key(equipment.name)}`, equipment)
}

const equipmentRowsByKey = new Map()
for (const row of parsedRows) {
  const naturalKey = `${row.environmentId}|${key(row.equipmentTag || row.equipmentName)}`
  if (equipmentRowsByKey.has(naturalKey)) continue
  const existing =
    equipmentByTag.get(`${row.environmentId}|${key(row.equipmentTag)}`) ||
    equipmentByName.get(`${row.environmentId}|${key(row.equipmentName)}`)
  equipmentRowsByKey.set(naturalKey, {
    id: existing?.id || uuidFromText(`climate-equipment:${naturalKey}`),
    client_id: row.clientId,
    client_environment_id: row.environmentId,
    tag: row.equipmentTag,
    name: row.equipmentName,
    type: row.type || existing?.type || "",
    brand: row.brand || existing?.brand || "",
    model: row.model || existing?.model || "",
    serial_number: existing?.serial_number || "",
    capacity: row.capacity || existing?.capacity || "",
    notes: existing?.notes || `Importado da linha ${row.sourceIndex} de ${fileName}`,
    status: existing?.status || "Ativo",
  })
}

const equipmentRows = Array.from(equipmentRowsByKey.values())
const summary = {
  mode: APPLY ? "apply" : "dry-run",
  sourceRows: sourceRows.length,
  validRows: parsedRows.length,
  clients: clientRows.size,
  environments: environmentRows.length,
  equipment: equipmentRows.length,
  duplicateSourceRowsIgnored: parsedRows.length - equipmentRows.length,
  newClients: Array.from(clientRows.values()).filter((row) => !existingClients.some((client) => client.id === row.id)).length,
  reusedClients: Array.from(clientRows.values()).filter((row) => existingClients.some((client) => client.id === row.id)).length,
  newEnvironments: environmentRows.filter((row) => !existingEnvironments.some((environment) => environment.id === row.id)).length,
  reusedEnvironments: environmentRows.filter((row) => existingEnvironments.some((environment) => environment.id === row.id)).length,
  newEquipment: equipmentRows.filter((row) => !existingEquipment.some((equipment) => equipment.id === row.id)).length,
  reusedEquipment: equipmentRows.filter((row) => existingEquipment.some((equipment) => equipment.id === row.id)).length,
  equipmentWithTag: equipmentRows.filter((row) => row.tag).length,
  equipmentWithCapacity: equipmentRows.filter((row) => row.capacity).length,
  equipmentWithBrand: equipmentRows.filter((row) => row.brand).length,
  equipmentWithModel: equipmentRows.filter((row) => row.model).length,
}

console.log(JSON.stringify(summary, null, 2))

await upsertChunks(supabase, "clients", Array.from(clientRows.values()))
await upsertChunks(supabase, "client_environments", environmentRows)
await upsertChunks(supabase, "client_equipment", equipmentRows)

if (APPLY) {
  const [environmentCount, equipmentCount, allSavedEnvironments, allSavedEquipment] = await Promise.all([
    supabase.from("client_environments").select("id", { count: "exact", head: true }),
    supabase.from("client_equipment").select("id", { count: "exact", head: true }),
    allRows(supabase, "client_environments", "id,equipment_description,thermal_load"),
    allRows(supabase, "client_equipment", "id,tag,name,type,brand,model,capacity"),
  ])
  if (environmentCount.error) throw new Error(`Validacao ambientes: ${environmentCount.error.message}`)
  if (equipmentCount.error) throw new Error(`Validacao equipamentos: ${equipmentCount.error.message}`)
  const expectedEnvironmentIds = new Set(environmentRows.map((row) => row.id))
  const expectedEquipmentIds = new Set(equipmentRows.map((row) => row.id))
  const savedEnvironments = allSavedEnvironments.filter((row) => expectedEnvironmentIds.has(row.id))
  const savedEquipment = allSavedEquipment.filter((row) => expectedEquipmentIds.has(row.id))
  const invalidEnvironments = savedEnvironments.filter((row) => row.equipment_description || row.thermal_load)
  const savedEquipmentById = new Map(savedEquipment.map((row) => [row.id, row]))
  const invalidEquipment = equipmentRows.filter((expected) => {
    const saved = savedEquipmentById.get(expected.id)
    return !saved || saved.tag !== expected.tag || saved.name !== expected.name || saved.capacity !== expected.capacity || saved.brand !== expected.brand || saved.model !== expected.model
  })
  if (invalidEnvironments.length || invalidEquipment.length) {
    throw new Error(`Validacao divergente: ${invalidEnvironments.length} ambientes e ${invalidEquipment.length} equipamentos.`)
  }
  console.log(JSON.stringify({
    saved: true,
    databaseEnvironmentCount: environmentCount.count,
    databaseEquipmentCount: equipmentCount.count,
    validatedSourceEnvironments: savedEnvironments.length,
    validatedSourceEquipment: savedEquipment.length,
    invalidEnvironments: invalidEnvironments.length,
    invalidEquipment: invalidEquipment.length,
  }, null, 2))
}
