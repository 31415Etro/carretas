import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createAdminClient, createAdminClientForServiceOrder, createClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { defaultOperationalState, type OperationalState } from "@/lib/operational-storage"
import { syncReceivablesForServiceOrders } from "@/lib/service-order-receivables"
import { serviceOrdersNeedingStockSync, syncStockForServiceOrderSafely } from "@/lib/stock-engine"
import { readAllPages } from "@/lib/supabase-pagination"
import { operationalSections, operationalStateSection, type OperationalSection } from "@/lib/operational-state-sections"
import { materialErpColumns, materialErpFields } from "@/lib/material-fields"

export const dynamic = "force-dynamic"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value))
}

function nullableUuid(value?: string) {
  return isUuid(value) ? value : null
}

function dateParts(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dbPriority(value?: string) {
  const normalized = String(value || "Media").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (normalized === "baixa") return "Baixa"
  if (normalized === "alta") return "Alta"
  if (normalized === "urgente") return "Urgente"
  return "Media"
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`operational:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string, companyId = "") {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(`${companyId}:${value}`)
}

function normalizeOperationalStateIds(state: OperationalState, companyId = ""): OperationalState {
  const map = new Map<string, string>()
  const remember = (id?: string) => {
    if (id) map.set(id, normalizeId(id, companyId))
  }
  const ref = (id?: string) => id ? map.get(id) || normalizeId(id, companyId) : ""

  state.clients.forEach((x) => remember(x.id))
  state.clientContacts.forEach((x) => remember(x.id))
  ;(state.clientEnvironments || []).forEach((x) => remember(x.id))
  ;(state.clientEquipment || []).forEach((x) => remember(x.id))
  ;(state.suppliers || []).forEach((x) => remember(x.id))
  state.works.forEach((x) => remember(x.id))
  state.workStructures.forEach((x) => remember(x.id))
  state.workFloors.forEach((x) => remember(x.id))
  state.workEnvironments.forEach((x) => remember(x.id))
  state.environmentPhotos.forEach((x) => remember(x.id))
  state.workPoints.forEach((x) => remember(x.id))
  state.pointPhotos.forEach((x) => remember(x.id))
  state.serviceOrders.forEach((x) => remember(x.id))
  state.serviceOrderEvents.forEach((x) => remember(x.id))
  state.checklistItems.forEach((x) => remember(x.id))
  state.serviceOrderMaterials.forEach((x) => remember(x.id))
  state.serviceOrderFiles.forEach((x) => remember(x.id))
  state.serviceOrderSignatures.forEach((x) => remember(x.id))
  state.providers.forEach((x) => remember(x.id))
  state.providerDocuments.forEach((x) => remember(x.id))
  state.vehicles.forEach((x) => remember(x.id))
  state.vehicleUsage.forEach((x) => remember(x.id))
  state.vehicleChecklists.forEach((x) => remember(x.id))
  state.vehicleMaintenance.forEach((x) => remember(x.id))
  state.serviceTypes.forEach((x) => remember(x.id))
  state.serviceTypeChecklistItems.forEach((x) => remember(x.id))
  state.serviceTypeMaterials.forEach((x) => remember(x.id))
  state.materials.forEach((x) => remember(x.id))
  ;(state.stockKits || []).forEach((x) => remember(x.id))
  ;(state.stockKitItems || []).forEach((x) => remember(x.id))
  ;(state.pmocPlans || []).forEach((x) => remember(x.id))
  ;(state.pmocSectors || []).forEach((x) => remember(x.id))
  ;(state.pmocEquipment || []).forEach((x) => remember(x.id))
  ;(state.pmocEquipmentServices || []).forEach((x) => remember(x.id))
  ;(state.pmocSchedules || []).forEach((x) => remember(x.id))
  state.statuses.forEach((x) => remember(x.id))
  state.executionSteps.forEach((x) => remember(x.id))
  state.auditLogs.forEach((x) => remember(x.id))

  return {
    ...state,
    clients: state.clients.map((x) => ({ ...x, id: ref(x.id) })),
    clientContacts: state.clientContacts.map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId) })),
    clientEnvironments: (state.clientEnvironments || []).map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId) })),
    clientEquipment: (state.clientEquipment || []).map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId), clientEnvironmentId: ref(x.clientEnvironmentId) })),
    suppliers: (state.suppliers || []).map((x) => ({ ...x, id: ref(x.id) })),
    works: state.works.map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId) })),
    workStructures: state.workStructures.map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId) })),
    workFloors: state.workFloors.map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId) })),
    workEnvironments: state.workEnvironments.map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId), floorId: ref(x.floorId), serviceTypeId: ref(x.serviceTypeId) })),
    environmentPhotos: state.environmentPhotos.map((x) => ({ ...x, id: ref(x.id), environmentId: ref(x.environmentId), uploadedBy: ref(x.uploadedBy) })),
    workPoints: state.workPoints.map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId), environmentId: ref(x.environmentId), serviceTypeId: ref(x.serviceTypeId), serviceTypeIds: ((x as any).serviceTypeIds || []).map(ref) })),
    pointPhotos: state.pointPhotos.map((x) => ({ ...x, id: ref(x.id), pointId: ref(x.pointId), uploadedBy: ref(x.uploadedBy) })),
    serviceOrders: state.serviceOrders.map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId), workId: ref(x.workId), clientEnvironmentId: ref((x as any).clientEnvironmentId), clientEquipmentId: ref((x as any).clientEquipmentId), workStructureId: ref(x.workStructureId), floorId: ref(x.floorId), environmentId: ref(x.environmentId), pointId: ref(x.pointId), serviceTypeId: ref(x.serviceTypeId), mainProviderId: ref(x.mainProviderId), helperProviderId: ref(x.helperProviderId), supervisorId: ref(x.supervisorId), vehicleId: ref(x.vehicleId) })),
    serviceOrderEvents: state.serviceOrderEvents.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId), providerId: ref(x.providerId), fileId: ref(x.fileId) })),
    checklistItems: state.checklistItems.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId), responsibleProviderId: ref(x.responsibleProviderId) })),
    serviceOrderMaterials: state.serviceOrderMaterials.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId), materialId: ref(x.materialId) })),
    serviceOrderFiles: state.serviceOrderFiles.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId), uploadedBy: ref(x.uploadedBy) })),
    serviceOrderSignatures: state.serviceOrderSignatures.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId) })),
    providers: state.providers.map((x) => ({ ...x, id: ref(x.id) })),
    providerDocuments: state.providerDocuments.map((x) => ({ ...x, id: ref(x.id), providerId: ref(x.providerId) })),
    vehicles: state.vehicles.map((x) => ({ ...x, id: ref(x.id) })),
    vehicleUsage: state.vehicleUsage.map((x) => ({ ...x, id: ref(x.id), vehicleId: ref(x.vehicleId), providerId: ref(x.providerId), serviceOrderId: ref(x.serviceOrderId) })),
    vehicleChecklists: state.vehicleChecklists.map((x) => ({ ...x, id: ref(x.id), serviceOrderId: ref(x.serviceOrderId), vehicleId: ref(x.vehicleId), providerId: ref(x.providerId) })),
    vehicleMaintenance: state.vehicleMaintenance.map((x) => ({ ...x, id: ref(x.id), vehicleId: ref(x.vehicleId) })),
    serviceTypes: state.serviceTypes.map((x) => ({ ...x, id: ref(x.id) })),
    serviceTypeChecklistItems: state.serviceTypeChecklistItems.map((x) => ({ ...x, id: ref(x.id), serviceTypeId: ref(x.serviceTypeId) })),
    serviceTypeMaterials: state.serviceTypeMaterials.map((x) => ({ ...x, id: ref(x.id), serviceTypeId: ref(x.serviceTypeId), materialId: ref(x.materialId) })),
    materials: state.materials.map((x) => ({ ...x, id: ref(x.id) })),
    stockKits: (state.stockKits || []).map((x) => ({ ...x, id: ref(x.id) })),
    stockKitItems: (state.stockKitItems || []).map((x) => ({ ...x, id: ref(x.id), kitId: ref(x.kitId), materialId: ref(x.materialId) })),
    pmocPlans: (state.pmocPlans || []).map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId), workId: ref(x.workId), mainProviderId: ref((x as any).mainProviderId) })),
    pmocSectors: (state.pmocSectors || []).map((x) => ({ ...x, id: ref(x.id), planId: ref(x.planId) })),
    pmocEquipment: (state.pmocEquipment || []).map((x) => ({ ...x, id: ref(x.id), planId: ref(x.planId), sectorId: ref(x.sectorId) })),
    pmocEquipmentServices: (state.pmocEquipmentServices || []).map((x) => ({ ...x, id: ref(x.id), planId: ref(x.planId), equipmentId: ref(x.equipmentId), serviceTypeId: ref(x.serviceTypeId) })),
    pmocSchedules: (state.pmocSchedules || []).map((x) => ({ ...x, id: ref(x.id), planId: ref(x.planId), equipmentId: ref(x.equipmentId), serviceTypeId: ref(x.serviceTypeId), serviceOrderId: ref(x.serviceOrderId) })),
    statuses: state.statuses.map((x) => ({ ...x, id: ref(x.id) })),
    executionSteps: state.executionSteps.map((x) => ({ ...x, id: ref(x.id) })),
    auditLogs: state.auditLogs.map((x) => ({ ...x, id: ref(x.id), userId: ref(x.userId), entityId: ref(x.entityId) })),
  }
}

async function table(supabase: ReturnType<typeof createAdminClient>, name: string) {
  try {
    return await readAllPages<any>((from, to) => supabase.from(name).select("*").order("id").range(from, to))
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : error}`)
  }
}

async function optionalTable(supabase: ReturnType<typeof createAdminClient>, name: string) {
  try {
    return await table(supabase, name)
  } catch (error) {
    if (error instanceof Error && /Could not find the table|relation .* does not exist/i.test(error.message)) return []
    throw error
  }
}

const registryTableNames = [
  "profiles", "clients", "client_contacts", "client_environments", "client_equipment", "suppliers",
  "works", "work_floors", "work_environments", "work_points",
  "budget_works", "budget_towers", "budget_floors", "budget_service_types", "budget_environments", "budget_points",
  "providers", "vehicles", "materials", "stock_kits", "stock_kit_items",
  "service_types", "service_type_checklist_items", "service_type_materials",
  "system_users", "operational_statuses", "execution_steps",
] as const

const pmocTableNames = [
  "pmoc_plans", "pmoc_sectors", "pmoc_equipment", "pmoc_equipment_services", "pmoc_schedules",
] as const

const executionTableNames = [
  "environment_photos", "point_photos", "provider_documents",
  "service_orders", "service_order_events", "service_order_checklist_items", "service_order_materials",
  "service_order_files", "service_order_signatures",
  "vehicle_checklists", "vehicle_usage", "vehicle_maintenance", "audit_logs",
] as const

const allOperationalTableNames = Array.from(new Set([
  ...registryTableNames,
  ...pmocTableNames,
  ...executionTableNames,
]))

const optionalTableNames = new Set([
  "profiles", "suppliers", "client_environments", "client_equipment",
  "budget_works", "budget_towers", "budget_floors", "budget_service_types", "budget_environments", "budget_points",
  "stock_kits", "stock_kit_items", "pmoc_plans", "pmoc_sectors", "pmoc_equipment", "pmoc_equipment_services", "pmoc_schedules",
])

function tablesForRequest(section: OperationalSection | null, scoped: boolean, orderScoped: boolean) {
  if (!section) return allOperationalTableNames
  const names = new Set<string>(
    section === "registry" ? registryTableNames : section === "pmoc" ? pmocTableNames : executionTableNames,
  )

  if (orderScoped || (scoped && section === "registry")) names.add("service_orders")
  if (scoped && section === "registry") names.add("pmoc_plans")
  if (section === "execution" && scoped) {
    ;["works", "work_floors", "work_environments", "work_points", "budget_works", "budget_towers", "budget_floors", "budget_service_types", "budget_environments", "budget_points"].forEach((name) => names.add(name))
  }
  return [...names]
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, name: string, rows: any[]) {
  const dedupedRows = Array.from(new Map(rows.filter((row) => row?.id).map((row) => [row.id, row])).values())
  if (!dedupedRows.length) return
  let currentRows = name === "works"
    ? await uniqueWorkCodes(supabase, dedupedRows)
    : name === "work_floors"
      ? await uniqueWorkFloors(supabase, dedupedRows)
      : name === "service_orders"
        ? await uniqueServiceOrderNumbers(supabase, dedupedRows)
        : dedupedRows
  let error: any = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await supabase.from(name).upsert(currentRows, { onConflict: "id" })
    error = result.error
    if (!error) return
    const missingColumn = error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!missingColumn) break
    currentRows = currentRows.map((row) => {
      const { [missingColumn]: _ignored, ...rest } = row
      return rest
    })
  }
  if (error.message.includes("Could not find the table") || error.message.includes("does not exist")) {
    if (["suppliers", "client_environments", "client_equipment", "stock_kits", "stock_kit_items", "pmoc_plans", "pmoc_sectors", "pmoc_equipment", "pmoc_equipment_services", "pmoc_schedules"].includes(name)) return
  }
  if (name === "materials" && error.message.includes("composes_kit")) {
    const fallbackRows = dedupedRows.map(({ composes_kit, ...row }) => row)
    const retry = await supabase.from(name).upsert(fallbackRows, { onConflict: "id" })
    if (!retry.error) return
  }
  if (name === "service_types" && error.message.includes("execution_percentage")) {
    const fallbackRows = dedupedRows.map(({ execution_percentage, ...row }) => row)
    const retry = await supabase.from(name).upsert(fallbackRows, { onConflict: "id" })
    if (!retry.error) return
  }
  if (name === "service_types" && error.message.includes("enabled_contexts")) {
    const fallbackRows = dedupedRows.map(({ enabled_contexts, ...row }) => row)
    const retry = await supabase.from(name).upsert(fallbackRows, { onConflict: "id" })
    if (!retry.error) return
  }
  if (name === "service_orders" && (error.message.includes("total_amount") || error.message.includes("service_category"))) {
    const fallbackRows = dedupedRows.map(({ total_amount, service_category, ...row }) => row)
    const retry = await supabase.from(name).upsert(fallbackRows, { onConflict: "id" })
    if (!retry.error) return
  }
  if (name === "work_floors" && error.message.includes("work_floors_work_id_name_key")) {
    const retryRows = await uniqueWorkFloors(supabase, currentRows)
    for (const row of retryRows) {
      const { error: rowError } = await supabase.from(name).upsert(row, { onConflict: "id" })
      if (rowError && !rowError.message.includes("work_floors_work_id_name_key")) throw new Error(`${name}: ${rowError.message}`)
    }
    return
  }
  throw new Error(`${name}: ${error.message}`)
}

async function uniqueServiceOrderNumbers(supabase: ReturnType<typeof createAdminClient>, rows: any[]) {
  const { data, error } = await supabase.from("service_orders").select("id, order_number")
  if (error) throw new Error(`service_orders: ${error.message}`)

  const existingById = new Map((data || []).map((row) => [row.id, row.order_number]))
  const occupied = new Set((data || []).map((row) => String(row.order_number || "").trim()).filter(Boolean))
  let nextNumber = (data || []).reduce((highest, row) => {
    const match = /^OS-(\d+)$/i.exec(String(row.order_number || "").trim())
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 2000) + 1

  return rows.map((row) => {
    if (existingById.has(row.id)) return row

    let orderNumber = String(row.order_number || "").trim()
    while (!orderNumber || occupied.has(orderNumber)) {
      orderNumber = `OS-${String(nextNumber).padStart(4, "0")}`
      nextNumber += 1
    }
    occupied.add(orderNumber)
    return { ...row, order_number: orderNumber }
  })
}

async function uniqueWorkCodes(supabase: ReturnType<typeof createAdminClient>, rows: any[]) {
  const { data } = await supabase.from("works").select("id, code")
  const usedByCode = new Map<string, string>((data || []).filter((row) => row?.code).map((row) => [String(row.code), String(row.id)]))
  const usedInPayload = new Set<string>()

  return rows.map((row) => {
    const base = String(row.code || row.name || "OBRA").trim() || "OBRA"
    let code = base
    let index = 2

    while ((usedInPayload.has(code)) || (usedByCode.has(code) && usedByCode.get(code) !== row.id)) {
      code = `${base}-${index}`
      index += 1
    }

    usedInPayload.add(code)
    return { ...row, code }
  })
}

async function uniqueWorkFloors(supabase: ReturnType<typeof createAdminClient>, rows: any[]) {
  const { data } = await supabase.from("work_floors").select("id, work_id, name")
  const dbByKey = new Map<string, string>((data || []).map((row) => [`${row.work_id}|${normalizeUniqueName(row.name)}`, row.id]))
  const payloadByKey = new Map<string, any>()

  for (const row of rows) {
    const key = `${row.work_id}|${normalizeUniqueName(row.name)}`
    if (!payloadByKey.has(key)) {
      const existingId = dbByKey.get(key)
      payloadByKey.set(key, existingId && existingId !== row.id ? { ...row, id: existingId } : row)
      continue
    }
    const current = payloadByKey.get(key)
    payloadByKey.set(key, {
      ...current,
      status: current.status || row.status,
      notes: [current.notes, row.notes].filter(Boolean).join("\n"),
    })
  }

  return Array.from(payloadByKey.values())
}

function normalizeUniqueName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase()
}

function baseState(): OperationalState {
  const base = defaultOperationalState()
  return {
    ...base,
    clients: [],
    clientContacts: [],
    clientEnvironments: [],
    clientEquipment: [],
    suppliers: [],
    works: [],
    workStructures: [],
    workFloors: [],
    workEnvironments: [],
    environmentPhotos: [],
    workPoints: [],
    pointPhotos: [],
    serviceOrders: [],
    serviceOrderEvents: [],
    checklistItems: [],
    serviceOrderMaterials: [],
    serviceOrderFiles: [],
    serviceOrderSignatures: [],
    providers: [],
    providerDocuments: [],
    vehicles: [],
    vehicleUsage: [],
    vehicleChecklists: [],
    vehicleMaintenance: [],
    serviceTypes: [],
    serviceTypeChecklistItems: [],
    serviceTypeMaterials: [],
    materials: [],
    stockKits: [],
    stockKitItems: [],
    pmocPlans: [],
    pmocSectors: [],
    pmocEquipment: [],
    pmocEquipmentServices: [],
    pmocSchedules: [],
    statuses: [],
    executionSteps: [],
    systemUsers: [],
    auditLogs: [],
  }
}

function normalizeText(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

function budgetMeta(key: string, value?: string) {
  return value ? `__budget_${key}:${value}` : ""
}

function budgetServiceTypeIds(value: unknown, fallback: string, serviceTypes: any[]) {
  let services: Array<{ id?: string; name?: string }> = []
  if (Array.isArray(value)) {
    services = value
  } else {
    services = String(fallback || "")
      .split(";")
      .map((name) => ({ name: name.trim() }))
      .filter((item) => item.name)
  }
  return Array.from(new Set(services.map((service) => {
    if (isUuid(service.id)) return service.id || ""
    const matched = serviceTypes.find((item) => normalizeText(item.name) === normalizeText(service.name || service.id || ""))
    return matched?.id || ""
  }).filter(Boolean)))
}

function budgetServiceTypeId(value: unknown, fallback: string, serviceTypes: any[]) {
  return budgetServiceTypeIds(value, fallback, serviceTypes)[0] || ""
}

function fromDb(rows: Record<string, any[]>): OperationalState {
  const state = baseState()
  const clients = rows.clients.map((x) => ({ id: x.id, type: x.type, name: x.name, document: x.document || "", corporateName: x.corporate_name || "", tradeName: x.trade_name || "", stateRegistration: x.state_registration || "", responsibleName: x.responsible_name || "", phone: x.phone || "", mobile: x.mobile || "", email: x.email || "", zipCode: x.zip_code || "", street: x.street || "", number: x.number || "", complement: x.complement || "", district: x.district || "", city: x.city || "", state: x.state || "", serviceContexts: Array.isArray(x.service_contexts) ? x.service_contexts : [], monthlyPmocValue: Number(x.monthly_pmoc_value || 0), status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at }))
  const serviceTypes = rows.service_types.map((x) => ({ id: x.id, name: x.name, description: x.description || "", status: x.status, kitId: x.kit_id || "", executionPercentage: Number(x.execution_percentage || 0), periodicityMonths: Number(x.periodicity_months || 1) as 1 | 2 | 3 | 6, enabledContexts: Array.isArray(x.enabled_contexts) && x.enabled_contexts.length ? x.enabled_contexts : ["obra"], requiredPhotos: x.required_photos || [], orientationVideoUrl: x.orientation_video_url || "", orientationVideoDescription: x.orientation_video_description || "", createdAt: x.created_at, updatedAt: x.updated_at }))
  const normalWorks = rows.works.map((x) => ({ id: x.id, clientId: x.client_id, uniqueNumber: x.code, name: x.name, type: x.type || "", status: x.status, zipCode: x.zip_code || "", street: x.street || "", number: x.number || "", complement: x.complement || "", district: x.district || "", city: x.city || "", state: x.state || "", responsibleName: x.responsible_name || "", responsiblePhone: x.responsible_phone || "", responsibleEmail: x.responsible_email || "", responsibleRole: x.responsible_role || "", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at }))
  const normalWorkIds = new Set(normalWorks.map((work) => work.id))
  const budgetWorkRows = rows.budget_works || []
  const budgetTowerRows = rows.budget_towers || []
  const budgetFloorRows = rows.budget_floors || []
  const budgetTypeRows = rows.budget_service_types || []
  const budgetEnvironmentRows = rows.budget_environments || []
  const budgetPointRows = rows.budget_points || []
  const budgetWorkIds = new Set(budgetTowerRows.map((tower) => tower.budget_work_id).filter(Boolean))
  const budgetFloorIds = new Set(budgetFloorRows.map((floor) => floor.id))
  const budgetEnvironmentIds = new Set(budgetEnvironmentRows.map((environment) => environment.id))
  const budgetPointIds = new Set(budgetPointRows.map((point) => point.id))
  const operationalFloorRows = rows.work_floors.filter((floor) => !budgetWorkIds.has(floor.work_id) || budgetFloorIds.has(floor.id))
  const operationalEnvironmentRows = rows.work_environments.filter((environment) => !budgetWorkIds.has(environment.work_id) || budgetEnvironmentIds.has(environment.id))
  const operationalPointRows = rows.work_points.filter((point) => !budgetWorkIds.has(point.work_id) || budgetPointIds.has(point.id))
  const normalFloorIds = new Set(operationalFloorRows.map((floor) => floor.id))
  const normalEnvironmentIds = new Set(operationalEnvironmentRows.map((environment) => environment.id))
  const normalPointIds = new Set(operationalPointRows.map((point) => point.id))
  const budgetTowerById = new Map(budgetTowerRows.map((item) => [item.id, item]))
  const budgetFloorById = new Map(budgetFloorRows.map((item) => [item.id, item]))
  const budgetTypeById = new Map(budgetTypeRows.map((item) => [item.id, item]))
  const budgetEnvironmentById = new Map(budgetEnvironmentRows.map((item) => [item.id, item]))
  const budgetPointById = new Map(budgetPointRows.map((item) => [item.id, item]))
  const budgetPointServiceIds = new Map(budgetPointRows.map((point) => [point.id, budgetServiceTypeIds(point.service_types, point.service_type || "", serviceTypes)]))
  const budgetWorkClientId = (work: any) => work.client_id || clients.find((client) => normalizeText(client.name) === normalizeText(work.client_name))?.id || ""
  const budgetWorks = budgetWorkRows
    .filter((x) => !normalWorkIds.has(x.id))
    .map((x, index) => ({ id: x.id, clientId: budgetWorkClientId(x), uniqueNumber: `ORC-${String(index + 1).padStart(4, "0")}`, name: x.name, type: "Orçamento", status: "Ativa" as const, zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", responsibleName: x.client_name || "", responsiblePhone: "", responsibleEmail: "", responsibleRole: "", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at || x.created_at }))
  const budgetFloors = budgetFloorRows.filter((floor) => !normalFloorIds.has(floor.id)).map((floor) => {
    const tower = budgetTowerById.get(floor.budget_tower_id)
    return {
      id: floor.id,
      workId: tower?.budget_work_id || "",
      name: floor.name,
      status: "Ativo" as const,
      notes: [budgetMeta("tower_id", tower?.id), budgetMeta("tower_name", tower?.name), floor.level || ""].filter(Boolean).join("\n"),
      createdAt: floor.created_at || new Date().toISOString(),
      updatedAt: floor.updated_at || floor.created_at || new Date().toISOString(),
    }
  }).filter((floor) => floor.workId)
  const budgetEnvironments = budgetEnvironmentRows.filter((environment) => !normalEnvironmentIds.has(environment.id)).map((environment) => {
    const type = budgetTypeById.get(environment.budget_service_type_id)
    const floor = type ? budgetFloorById.get(type.budget_floor_id) : undefined
    const tower = floor ? budgetTowerById.get(floor.budget_tower_id) : undefined
    return {
      id: environment.id,
      workId: tower?.budget_work_id || "",
      floorId: floor?.id || "",
      floor: floor?.name || "",
      final: type?.name || "",
      environmentName: environment.name,
      serviceTypeId: "",
      pointsQuantity: Number(environment.points_quantity || 0),
      notes: [budgetMeta("tower_id", tower?.id), budgetMeta("tower_name", tower?.name), budgetMeta("type_id", type?.id), environment.notes || ""].filter(Boolean).join("\n"),
      status: "Ativo" as const,
      createdAt: environment.created_at || new Date().toISOString(),
      updatedAt: environment.updated_at || environment.created_at || new Date().toISOString(),
    }
  }).filter((environment) => environment.workId)
  const budgetPoints = budgetPointRows.filter((point) => !normalPointIds.has(point.id)).map((point) => {
    const environment = budgetEnvironmentById.get(point.budget_environment_id)
    const type = environment ? budgetTypeById.get(environment.budget_service_type_id) : undefined
    const floor = type ? budgetFloorById.get(type.budget_floor_id) : undefined
    const tower = floor ? budgetTowerById.get(floor.budget_tower_id) : undefined
    const serviceTypeIds = budgetServiceTypeIds(point.service_types, point.service_type || "", serviceTypes)
    const kitInfo = [point.kit_name ? `Kit: ${point.kit_name}` : "", point.specifications ? `Especificações: ${point.specifications}` : "", point.notes || ""].filter(Boolean).join("\n")
    return {
      id: point.id,
      workId: tower?.budget_work_id || "",
      environmentId: environment?.id || "",
      pointNumber: Number(point.point_number || 0),
      pointName: point.name,
      serviceTypeId: serviceTypeIds[0] || "",
      serviceTypeIds,
      kitId: point.kit_id || "",
      kitName: point.kit_name || "",
      status: "Ativo" as const,
      equipmentExpected: "",
      btus: "",
      brand: "",
      model: "",
      serialNumber: "",
      evaporatorLocation: "",
      condenserLocation: "",
      hasDrain: false,
      hasElectricPoint: false,
      hasPiping: false,
      infrastructureMeasure: point.infrastructure_measure || "",
      measurementConfirmation: point.measurement_confirmation || "",
      technicalNotes: kitInfo,
      createdAt: point.created_at || new Date().toISOString(),
      updatedAt: point.updated_at || point.created_at || new Date().toISOString(),
    }
  }).filter((point) => point.workId && point.environmentId)
  return {
    ...state,
    clients,
    clientContacts: rows.client_contacts.map((x) => ({ id: x.id, clientId: x.client_id, name: x.name, role: x.role || "", phone: x.phone || "", email: x.email || "", main: Boolean(x.main), notes: x.notes || "" })),
    clientEnvironments: (rows.client_environments || []).map((x) => ({ id: x.id, clientId: x.client_id, name: x.name, location: x.location || "", floor: x.floor || "", activityType: x.activity_type || "", equipmentDescription: x.equipment_description || "", thermalLoad: x.thermal_load || "", occupantsTotal: Number(x.occupants_total || 0), occupantsFixed: Number(x.occupants_fixed || 0), occupantsFloating: Number(x.occupants_floating || 0), airConditionedArea: Number(x.air_conditioned_area || 0), notes: x.notes || "", status: x.status || "Ativo", createdAt: x.created_at, updatedAt: x.updated_at })),
    clientEquipment: (rows.client_equipment || []).map((x) => ({ id: x.id, clientId: x.client_id, clientEnvironmentId: x.client_environment_id, tag: x.tag || "", name: x.name, type: x.type || "", brand: x.brand || "", model: x.model || "", serialNumber: x.serial_number || "", capacity: x.capacity || "", notes: x.notes || "", status: x.status || "Ativo", createdAt: x.created_at, updatedAt: x.updated_at })),
    suppliers: (rows.suppliers || []).map((x) => ({ id: x.id, name: x.name, document: x.document || "", contactName: x.contact_name || "", phone: x.phone || "", email: x.email || "", category: x.category || "", categoryIds: Array.isArray(x.category_ids) ? x.category_ids : [], city: x.city || "", state: x.state || "", status: x.status || "Ativo", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    works: [...normalWorks, ...budgetWorks],
    workFloors: [...operationalFloorRows.map((x) => ({ id: x.id, workId: x.work_id, name: x.name, status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })), ...budgetFloors],
    workEnvironments: [...operationalEnvironmentRows.map((x) => ({ id: x.id, workId: x.work_id, floorId: x.floor_id || "", floor: x.floor || "", final: x.final || "", environmentName: x.environment_name, serviceTypeId: x.service_type_id || "", pointsQuantity: Number(x.points_quantity || 0), notes: x.notes || "", status: x.status, createdAt: x.created_at, updatedAt: x.updated_at })), ...budgetEnvironments],
    environmentPhotos: rows.environment_photos.map((x) => ({ id: x.id, environmentId: x.environment_id, fileName: x.file_name || x.file_url || "", photoType: x.photo_type, description: x.description || "", uploadedBy: x.uploaded_by || "", createdAt: x.created_at })),
    workPoints: [...operationalPointRows.map((x) => {
      const budgetPoint = budgetPointById.get(x.id)
      const serviceTypeIds = budgetPointServiceIds.get(x.id) || [x.service_type_id || ""].filter(Boolean)
      const kitInfo = budgetPoint ? [budgetPoint.kit_name ? `Kit: ${budgetPoint.kit_name}` : "", budgetPoint.specifications ? `EspecificaÃ§Ãµes: ${budgetPoint.specifications}` : "", budgetPoint.notes || ""].filter(Boolean).join("\n") : ""
      return { id: x.id, workId: x.work_id, environmentId: x.environment_id, pointNumber: Number(budgetPoint?.point_number || x.point_number), pointName: budgetPoint?.name || x.point_name, serviceTypeId: serviceTypeIds[0] || "", serviceTypeIds, kitId: budgetPoint?.kit_id || "", kitName: budgetPoint?.kit_name || "", status: x.status, equipmentExpected: x.equipment_expected || "", btus: x.btus || "", brand: x.brand || "", model: x.model || "", serialNumber: x.serial_number || "", evaporatorLocation: x.evaporator_location || "", condenserLocation: x.condenser_location || "", hasDrain: Boolean(x.has_drain), hasElectricPoint: Boolean(x.has_electric_point), hasPiping: Boolean(x.has_piping), infrastructureMeasure: budgetPoint?.infrastructure_measure || x.infrastructure_measure || "", measurementConfirmation: budgetPoint?.measurement_confirmation || x.measurement_confirmation || "", technicalNotes: kitInfo || x.technical_notes || "", createdAt: x.created_at, updatedAt: budgetPoint?.updated_at || x.updated_at }
    }), ...budgetPoints],
    pointPhotos: rows.point_photos.map((x) => ({ id: x.id, pointId: x.point_id, fileName: x.file_name || x.file_url || "", photoType: x.photo_type, description: x.description || "", uploadedBy: x.uploaded_by || "", createdAt: x.created_at })),
    providers: rows.providers.map((x) => ({ id: x.id, fullName: x.full_name, cpf: x.cpf || "", rg: x.rg || "", birthDate: x.birth_date || "", phone: x.phone || "", email: x.email || "", zipCode: x.zip_code || "", street: x.street || "", number: x.number || "", complement: x.complement || "", district: x.district || "", city: x.city || "", state: x.state || "", role: x.role || "", relationshipType: x.relationship_type || "", status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    providerDocuments: rows.provider_documents.map((x) => ({ id: x.id, providerId: x.provider_id, type: x.type, fileName: x.file_name || x.file_url || "", notes: x.notes || "", createdAt: x.created_at })),
    vehicles: rows.vehicles.map((x) => ({ id: x.id, plate: x.plate, model: x.model, brand: x.brand, year: x.year || "", color: x.color || "", currentKm: Number(x.current_km || 0), frontRightTire: x.front_right_tire, frontLeftTire: x.front_left_tire, rearRightTire: x.rear_right_tire, rearLeftTire: x.rear_left_tire, lastOilChangeDate: x.last_oil_change_date || "", lastOilChangeKm: Number(x.last_oil_change_km || 0), status: x.status, renavam: x.renavam || "", licensingDueDate: x.licensing_due_date || "", insuranceInfo: x.insurance_info || "", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    materials: rows.materials.map((x) => ({ id: x.id, name: x.name, category: x.category || "", unit: x.unit, internalCode: x.internal_code || "", minimumStock: Number(x.minimum_stock || 0), currentStock: Number(x.current_stock || 0), composesKit: Boolean(x.composes_kit), status: x.status, notes: x.notes || "", ...materialErpFields(x), createdAt: x.created_at, updatedAt: x.updated_at })),
    stockKits: (rows.stock_kits || []).map((x) => ({ id: x.id, name: x.name, description: x.description || "", unitValue: Number(x.unit_value || 0), quantityInStock: Number(x.stock_quantity || 0), status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    stockKitItems: (rows.stock_kit_items || []).map((x) => ({ id: x.id, kitId: x.kit_id, materialId: x.material_id, quantity: Number(x.quantity || 0), unit: x.unit || "" })),
    pmocPlans: (rows.pmoc_plans || []).map((x) => {
      const startMonth = Number(x.start_month || 1)
      const startYear = Number(x.start_year || new Date().getFullYear())
      return { id: x.id, clientId: x.client_id, workId: x.work_id || "", name: x.name, frequency: x.frequency, startMonth, startYear, startDate: x.start_date || `${startYear}-${String(startMonth).padStart(2, "0")}-10`, endDate: x.end_date || `${startYear}-12-31`, scheduleDay: Number(x.schedule_day || String(x.start_date || "").slice(8, 10) || 10), mainProviderId: x.main_provider_id || "", status: x.status || "Ativo", paymentMethod: x.payment_method || "", paymentType: x.payment_type || "", paymentTerm: x.payment_term || "", paymentDueDate: x.payment_due_date || "", financialNotes: x.financial_notes || "", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at }
    }),
    pmocSectors: (rows.pmoc_sectors || []).map((x) => ({ id: x.id, planId: x.pmoc_plan_id, name: x.name, floor: x.floor || "", notes: x.notes || "", status: x.status || "Ativo", createdAt: x.created_at, updatedAt: x.updated_at })),
    pmocEquipment: (rows.pmoc_equipment || []).map((x) => ({ id: x.id, planId: x.pmoc_plan_id, sectorId: x.pmoc_sector_id, clientEnvironmentId: x.client_environment_id || "", clientEquipmentId: x.client_equipment_id || "", tag: x.tag || "", name: x.name, brand: x.brand || "", model: x.model || "", serialNumber: x.serial_number || "", capacity: x.capacity || "", location: x.location || "", status: x.status || "Ativo", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    pmocEquipmentServices: (rows.pmoc_equipment_services || []).map((x) => ({ id: x.id, planId: x.pmoc_plan_id, equipmentId: x.pmoc_equipment_id, serviceTypeId: x.service_type_id, createdAt: x.created_at })),
    pmocSchedules: (rows.pmoc_schedules || []).map((x) => ({ id: x.id, planId: x.pmoc_plan_id, equipmentId: x.pmoc_equipment_id, serviceTypeId: x.service_type_id, month: Number(x.month || 1), year: Number(x.year || new Date().getFullYear()), scheduledDate: x.scheduled_date || "", serviceOrderId: x.service_order_id || "", status: x.status || "Planejado", createdAt: x.created_at, updatedAt: x.updated_at })),
    serviceTypes,
    serviceTypeChecklistItems: rows.service_type_checklist_items.map((x) => ({ id: x.id, serviceTypeId: x.service_type_id, taskName: x.task_name, required: Boolean(x.required), requiresPhoto: Boolean(x.requires_photo), order: Number(x.order_index || 1), notes: x.notes || "" })),
    serviceTypeMaterials: rows.service_type_materials.map((x) => ({ id: x.id, serviceTypeId: x.service_type_id, materialId: x.material_id || "", quantity: Number(x.quantity || 0), unit: x.unit, required: Boolean(x.required) })),
    serviceOrders: rows.service_orders.map((x) => ({ id: x.id, orderNumber: x.order_number, orderType: x.order_type || "obra", serviceCategory: x.service_category || "", clientId: x.client_id, workId: x.work_id, clientEnvironmentId: x.client_environment_id || "", clientEquipmentId: x.client_equipment_id || "", workStructureId: "", floorId: x.floor_id || "", environmentId: x.environment_id || "", pointId: x.point_id || "", simpleService: Boolean(x.simple_service), serviceTypeId: x.service_type_id || "", priority: x.priority, description: x.description || "", scheduledDate: x.scheduled_date || "", scheduledStartTime: x.scheduled_start_time || "", scheduledEndTime: x.scheduled_end_time || "", estimatedDuration: x.estimated_duration || "", allowReschedule: Boolean(x.allow_reschedule), scheduleNotes: x.schedule_notes || "", mainProviderId: x.main_provider_id || "", helperProviderId: x.helper_provider_id || "", supervisorId: x.supervisor_id || "", vehicleId: x.vehicle_id || "", initialKm: Number(x.initial_km || 0), finalKm: Number(x.final_km || 0), totalAmount: Number(x.total_amount || 0), paymentMethod: x.payment_method || "", paymentType: x.payment_type || "", paymentTerm: x.payment_term || "", paymentDueDate: x.payment_due_date || "", financialNotes: x.financial_notes || "", status: x.status, customerResponsibleName: x.customer_responsible_name || "", customerResponsiblePhone: x.customer_responsible_phone || "", teamNotes: x.team_notes || "", notes: x.notes || "", pauseReason: x.pause_reason || "", cancellationReason: x.cancellation_reason || "", partialReason: x.partial_reason || "", createdAt: x.created_at, updatedAt: x.updated_at, finishedAt: x.finished_at || "", cancelledAt: x.cancelled_at || "" })),
    serviceOrderEvents: rows.service_order_events.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, stepName: x.step_name, status: x.status, providerId: x.provider_id || "", eventDatetime: x.event_datetime, latitude: x.latitude ? String(x.latitude) : "", longitude: x.longitude ? String(x.longitude) : "", notes: x.notes || "", fileId: x.file_id || "", createdAt: x.created_at })),
    checklistItems: rows.service_order_checklist_items.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, taskName: x.task_name, required: Boolean(x.required), requiresPhoto: Boolean(x.requires_photo), status: x.status, responsibleProviderId: x.responsible_provider_id || "", notes: x.notes || "", completedAt: x.completed_at || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    serviceOrderMaterials: rows.service_order_materials.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, materialId: x.material_id || "", itemName: x.item_name, expectedQuantity: Number(x.expected_quantity || 0), usedQuantity: Number(x.used_quantity || 0), unit: x.unit, status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    serviceOrderFiles: rows.service_order_files.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, category: x.category, fileName: x.file_name || x.file_url || "", fileUrl: x.file_url || "", fileType: x.file_type || "", uploadedBy: x.uploaded_by || "", notes: x.notes || "", createdAt: x.created_at })),
    serviceOrderSignatures: rows.service_order_signatures.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, responsibleName: x.responsible_name, responsibleDocument: x.responsible_document || "", signatureText: x.signature_text || x.signature_url || "", rating: x.rating || "", customerNotes: x.customer_notes || "", createdAt: x.created_at })),
    vehicleChecklists: rows.vehicle_checklists.map((x) => ({ id: x.id, serviceOrderId: x.service_order_id, vehicleId: x.vehicle_id, providerId: x.provider_id || "", cleanlinessState: x.cleanliness_state, conservationState: x.conservation_state, frontRightTire: x.front_right_tire, frontLeftTire: x.front_left_tire, rearRightTire: x.rear_right_tire, rearLeftTire: x.rear_left_tire, mandatorySafetyItems: Boolean(x.mandatory_safety_items), oilLevel: x.oil_level, brakesTest: x.brakes_test, windshieldWipers: x.windshield_wipers, mirrors: x.mirrors, lights: x.lights, fuelLevel: x.fuel_level, notes: x.notes || "", acceptedAt: x.accepted_at, createdAt: x.created_at, updatedAt: x.updated_at })),
    vehicleUsage: rows.vehicle_usage.map((x) => ({ id: x.id, vehicleId: x.vehicle_id, providerId: x.provider_id || "", serviceOrderId: x.service_order_id || "", date: x.date, initialKm: Number(x.initial_km || 0), finalKm: Number(x.final_km || 0) })),
    vehicleMaintenance: rows.vehicle_maintenance.map((x) => ({ id: x.id, vehicleId: x.vehicle_id, type: x.type, date: x.start_date, km: Number(x.km || 0), cost: Number(x.cost || 0), description: x.description || "", nextMaintenance: x.end_date || x.next_maintenance || "", status: x.status, attachmentName: x.attachment_url || "" })),
    systemUsers: (rows.profiles?.length ? rows.profiles : rows.system_users).map((x) => rows.profiles?.length
      ? ({ id: x.id, name: x.full_name || x.email, email: x.email, phone: x.phone || "", profile: x.role === "admin" ? "Administrador" : x.role === "manager" ? "Supervisor" : x.role === "sdr" ? "Atendimento" : x.role === "client" ? "Cliente" : "Tecnico", temporaryPassword: "", status: x.active === false ? "Inativo" : "Ativo", permissions: x.page_permissions || [], clientId: x.client_id || "" })
      : ({ id: x.id, name: x.name, email: x.email, phone: x.phone || "", profile: x.profile, temporaryPassword: "", status: x.status, permissions: x.permissions || [], clientId: x.client_id || "" })),
    statuses: rows.operational_statuses.map((x) => ({ id: x.id, name: x.name, color: x.color, order: Number(x.order_index || 1), finalStatus: Boolean(x.final_status), editable: Boolean(x.editable), requiresReason: Boolean(x.requires_reason) })),
    executionSteps: rows.execution_steps.map((x) => ({ id: x.id, name: x.name, order: Number(x.order_index || 1), requiresPhoto: Boolean(x.requires_photo), requiresLocation: Boolean(x.requires_location), requiresNotes: Boolean(x.requires_notes), changesStatusTo: x.changes_status_to || "" })),
    auditLogs: rows.audit_logs.map((x) => ({ id: x.id, userId: x.user_id || "", entityType: x.entity_type, entityId: x.entity_id || "", action: x.action, description: x.description || "", createdAt: x.created_at })),
  }
}

function scopeStateForClient(state: OperationalState, clientId: string): OperationalState {
  const works = state.works.filter((item) => item.clientId === clientId)
  const workIds = new Set(works.map((item) => item.id))
  const workFloors = state.workFloors.filter((item) => workIds.has(item.workId))
  const workEnvironments = state.workEnvironments.filter((item) => workIds.has(item.workId))
  const environmentIds = new Set(workEnvironments.map((item) => item.id))
  const workPoints = state.workPoints.filter((item) => workIds.has(item.workId) && environmentIds.has(item.environmentId))
  const pointIds = new Set(workPoints.map((item) => item.id))
  const pmocPlans = state.pmocPlans.filter((item) => item.clientId === clientId)
  const planIds = new Set(pmocPlans.map((item) => item.id))
  const pmocSectors = state.pmocSectors.filter((item) => planIds.has(item.planId))
  const sectorIds = new Set(pmocSectors.map((item) => item.id))
  const pmocEquipment = state.pmocEquipment.filter((item) => planIds.has(item.planId) && sectorIds.has(item.sectorId))
  const equipmentIds = new Set(pmocEquipment.map((item) => item.id))
  const serviceOrders = state.serviceOrders.filter((item) => item.clientId === clientId)
  const orderIds = new Set(serviceOrders.map((item) => item.id))
  const providerIds = new Set([
    ...pmocPlans.map((item) => item.mainProviderId),
    ...serviceOrders.flatMap((item) => [item.mainProviderId, item.helperProviderId, item.supervisorId]),
  ].filter(Boolean))
  const vehicleIds = new Set(serviceOrders.map((item) => item.vehicleId).filter(Boolean))

  return {
    ...state,
    clients: state.clients.filter((item) => item.id === clientId),
    clientContacts: state.clientContacts.filter((item) => item.clientId === clientId),
    clientEnvironments: state.clientEnvironments.filter((item) => item.clientId === clientId),
    clientEquipment: state.clientEquipment.filter((item) => item.clientId === clientId),
    suppliers: [],
    works,
    workFloors,
    workEnvironments,
    environmentPhotos: state.environmentPhotos.filter((item) => environmentIds.has(item.environmentId)),
    workPoints,
    pointPhotos: state.pointPhotos.filter((item) => pointIds.has(item.pointId)),
    serviceOrders,
    serviceOrderEvents: state.serviceOrderEvents.filter((item) => orderIds.has(item.serviceOrderId)),
    checklistItems: state.checklistItems.filter((item) => orderIds.has(item.serviceOrderId)),
    serviceOrderMaterials: state.serviceOrderMaterials.filter((item) => orderIds.has(item.serviceOrderId)),
    serviceOrderFiles: state.serviceOrderFiles.filter((item) => orderIds.has(item.serviceOrderId)),
    serviceOrderSignatures: state.serviceOrderSignatures.filter((item) => orderIds.has(item.serviceOrderId)),
    providers: state.providers.filter((item) => providerIds.has(item.id)),
    providerDocuments: [],
    vehicles: state.vehicles.filter((item) => vehicleIds.has(item.id)),
    vehicleUsage: state.vehicleUsage.filter((item) => orderIds.has(item.serviceOrderId || "")),
    vehicleChecklists: state.vehicleChecklists.filter((item) => orderIds.has(item.serviceOrderId)),
    vehicleMaintenance: [],
    materials: [],
    stockKits: [],
    stockKitItems: [],
    pmocPlans,
    pmocSectors,
    pmocEquipment,
    pmocEquipmentServices: state.pmocEquipmentServices.filter((item) => planIds.has(item.planId) && equipmentIds.has(item.equipmentId)),
    pmocSchedules: state.pmocSchedules.filter((item) => planIds.has(item.planId) && equipmentIds.has(item.equipmentId)),
    serviceTypeMaterials: [],
    systemUsers: [],
    auditLogs: [],
  }
}

function scopeStateForOrder(state: OperationalState, orderId: string): OperationalState | null {
  const order = state.serviceOrders.find((item) => item.id === orderId)
  if (!order) return null
  const scoped = scopeStateForClient(state, order.clientId)
  const scheduleRows = scoped.pmocSchedules.filter((item) => item.serviceOrderId === orderId)
  const planIds = new Set(scheduleRows.map((item) => item.planId))
  const equipmentIds = new Set(scheduleRows.map((item) => item.equipmentId))
  const workEnvironments = scoped.workEnvironments.filter((item) => item.workId === order.workId)
  const environmentIds = new Set(workEnvironments.map((item) => item.id))
  const workPoints = scoped.workPoints.filter((item) => item.workId === order.workId && environmentIds.has(item.environmentId))
  const pointIds = new Set(workPoints.map((item) => item.id))

  return {
    ...scoped,
    works: scoped.works.filter((item) => item.id === order.workId),
    workFloors: scoped.workFloors.filter((item) => item.workId === order.workId),
    workEnvironments,
    environmentPhotos: scoped.environmentPhotos.filter((item) => environmentIds.has(item.environmentId)),
    workPoints,
    pointPhotos: scoped.pointPhotos.filter((item) => pointIds.has(item.pointId)),
    serviceOrders: [order],
    serviceOrderEvents: scoped.serviceOrderEvents.filter((item) => item.serviceOrderId === orderId),
    checklistItems: scoped.checklistItems.filter((item) => item.serviceOrderId === orderId),
    serviceOrderMaterials: scoped.serviceOrderMaterials.filter((item) => item.serviceOrderId === orderId),
    serviceOrderFiles: scoped.serviceOrderFiles.filter((item) => item.serviceOrderId === orderId),
    serviceOrderSignatures: scoped.serviceOrderSignatures.filter((item) => item.serviceOrderId === orderId),
    pmocPlans: scoped.pmocPlans.filter((item) => planIds.has(item.id)),
    pmocSectors: scoped.pmocSectors.filter((item) => planIds.has(item.planId)),
    pmocEquipment: scoped.pmocEquipment.filter((item) => equipmentIds.has(item.id)),
    pmocEquipmentServices: scoped.pmocEquipmentServices.filter((item) => equipmentIds.has(item.equipmentId)),
    pmocSchedules: scheduleRows,
  }
}

function toDb(state: OperationalState) {
  const valid = <T extends { id: string }>(items: T[]) => items.filter((x) => isUuid(x.id))
  const validClientIds = new Set(valid(state.clients || []).map((client) => client.id))
  const validWorkIds = new Set(valid(state.works || []).filter((work) => isUuid(work.clientId) && validClientIds.has(work.clientId)).map((work) => work.id))
  const floorIdAliases = new Map<string, string>()
  const workFloors = Array.from(valid(state.workFloors).filter((x) => isUuid(x.workId) && validWorkIds.has(x.workId)).reduce((map, floor) => {
    const key = `${floor.workId}|${normalizeUniqueName(floor.name)}`
    const existing = map.get(key)
    if (existing) {
      floorIdAliases.set(floor.id, existing.id)
      map.set(key, { ...existing, notes: [existing.notes, floor.notes].filter(Boolean).join("\n"), status: existing.status || floor.status })
    } else {
      map.set(key, floor)
    }
    return map
  }, new Map<string, any>()).values())
  const resolveFloorId = (id?: string) => floorIdAliases.get(id || "") || id || ""
  const workEnvironments = valid(state.workEnvironments || []).filter((x) => isUuid(x.workId) && validWorkIds.has(x.workId))
  const validWorkEnvironmentIds = new Set(workEnvironments.map((environment) => environment.id))
  const workPoints = valid(state.workPoints || []).filter((x) => isUuid(x.workId) && validWorkIds.has(x.workId) && isUuid(x.environmentId) && validWorkEnvironmentIds.has(x.environmentId))
  const validWorkPointIds = new Set(workPoints.map((point) => point.id))
  return {
    client_contacts: valid(state.clientContacts).filter((x) => isUuid(x.clientId)).map((x) => ({ id: x.id, client_id: x.clientId, name: x.name, role: x.role, phone: x.phone, email: x.email, main: x.main, notes: x.notes })),
    clients: valid(state.clients).map((x) => ({ id: x.id, type: x.type, name: x.name, document: x.document, corporate_name: x.corporateName, trade_name: x.tradeName, state_registration: x.stateRegistration, responsible_name: x.responsibleName, phone: x.phone, mobile: x.mobile, email: x.email, zip_code: x.zipCode, street: x.street, number: x.number, complement: x.complement, district: x.district, city: x.city, state: x.state, service_contexts: x.serviceContexts || [], monthly_pmoc_value: (x.serviceContexts || []).includes("pmoc") ? Math.max(0, Number(x.monthlyPmocValue || 0)) : 0, status: x.status, notes: x.notes })),
    client_environments: valid(state.clientEnvironments || []).filter((x) => isUuid(x.clientId)).map((x) => ({ id: x.id, client_id: x.clientId, name: x.name, location: x.location, floor: x.floor, activity_type: x.activityType || "", equipment_description: x.equipmentDescription || "", thermal_load: x.thermalLoad || "", occupants_total: Math.max(0, Number(x.occupantsTotal || 0)), occupants_fixed: Math.max(0, Number(x.occupantsFixed || 0)), occupants_floating: Math.max(0, Number(x.occupantsFloating || 0)), air_conditioned_area: Math.max(0, Number(x.airConditionedArea || 0)), notes: x.notes, status: x.status })),
    client_equipment: valid(state.clientEquipment || []).filter((x) => isUuid(x.clientId) && isUuid(x.clientEnvironmentId)).map((x) => ({ id: x.id, client_id: x.clientId, client_environment_id: x.clientEnvironmentId, tag: x.tag, name: x.name, type: x.type, brand: x.brand, model: x.model, serial_number: x.serialNumber, capacity: x.capacity, notes: x.notes, status: x.status })),
    suppliers: valid(state.suppliers || []).map((x) => ({ id: x.id, name: x.name, document: x.document, contact_name: x.contactName, phone: x.phone, email: x.email, category: x.category, category_ids: (x.categoryIds || []).filter(isUuid), city: x.city, state: x.state, status: x.status, notes: x.notes })),
    works: valid(state.works).filter((x) => isUuid(x.clientId)).map((x) => ({ id: x.id, client_id: x.clientId, code: x.uniqueNumber, name: x.name, type: x.type, status: x.status, zip_code: x.zipCode, street: x.street, number: x.number, complement: x.complement, district: x.district, city: x.city, state: x.state, responsible_name: x.responsibleName, responsible_phone: x.responsiblePhone, responsible_email: x.responsibleEmail, responsible_role: x.responsibleRole, notes: x.notes })),
    work_floors: workFloors.map((x) => ({ id: x.id, work_id: x.workId, name: x.name, status: x.status, notes: x.notes })),
    service_types: valid(state.serviceTypes).map((x) => ({ id: x.id, name: x.name, description: x.description, status: x.status, kit_id: nullableUuid(x.kitId || ""), execution_percentage: Number(x.executionPercentage || 0), periodicity_months: Number(x.periodicityMonths || 1), enabled_contexts: x.enabledContexts?.length ? x.enabledContexts : ["obra"], required_photos: x.requiredPhotos, orientation_video_url: x.orientationVideoUrl, orientation_video_description: x.orientationVideoDescription })),
    service_type_checklist_items: valid(state.serviceTypeChecklistItems).filter((x) => isUuid(x.serviceTypeId)).map((x) => ({ id: x.id, service_type_id: x.serviceTypeId, task_name: x.taskName, required: x.required, requires_photo: x.requiresPhoto, order_index: x.order, notes: x.notes })),
    service_type_materials: valid(state.serviceTypeMaterials).filter((x) => isUuid(x.serviceTypeId)).map((x) => ({ id: x.id, service_type_id: x.serviceTypeId, material_id: nullableUuid(x.materialId), quantity: x.quantity, unit: x.unit, required: x.required })),
    work_environments: workEnvironments.map((x) => ({ id: x.id, work_id: x.workId, floor_id: nullableUuid(resolveFloorId(x.floorId)), floor: x.floor, final: x.final, environment_name: x.environmentName, service_type_id: nullableUuid(x.serviceTypeId), points_quantity: x.pointsQuantity, status: x.status, notes: x.notes })),
    environment_photos: valid(state.environmentPhotos).filter((x) => isUuid(x.environmentId) && validWorkEnvironmentIds.has(x.environmentId)).map((x) => ({ id: x.id, environment_id: x.environmentId, file_url: x.fileName, file_name: x.fileName, photo_type: x.photoType, description: x.description, uploaded_by: nullableUuid(x.uploadedBy) })),
    work_points: workPoints.map((x) => ({ id: x.id, work_id: x.workId, environment_id: x.environmentId, point_number: x.pointNumber, point_name: x.pointName, service_type_id: nullableUuid(x.serviceTypeId), status: x.status, equipment_expected: x.equipmentExpected, btus: x.btus, brand: x.brand, model: x.model, serial_number: x.serialNumber, evaporator_location: x.evaporatorLocation, condenser_location: x.condenserLocation, has_drain: x.hasDrain, has_electric_point: x.hasElectricPoint, has_piping: x.hasPiping, infrastructure_measure: x.infrastructureMeasure || "", measurement_confirmation: x.measurementConfirmation || "", technical_notes: x.technicalNotes })),
    point_photos: valid(state.pointPhotos).filter((x) => isUuid(x.pointId) && validWorkPointIds.has(x.pointId)).map((x) => ({ id: x.id, point_id: x.pointId, file_url: x.fileName, file_name: x.fileName, photo_type: x.photoType, description: x.description, uploaded_by: nullableUuid(x.uploadedBy) })),
    providers: valid(state.providers).map((x) => ({ id: x.id, full_name: x.fullName, cpf: x.cpf, rg: x.rg, birth_date: x.birthDate || null, phone: x.phone, email: x.email, zip_code: x.zipCode, street: x.street, number: x.number, complement: x.complement, district: x.district, city: x.city, state: x.state, role: x.role, relationship_type: x.relationshipType, status: x.status, notes: x.notes })),
    provider_documents: valid(state.providerDocuments).filter((x) => isUuid(x.providerId)).map((x) => ({ id: x.id, provider_id: x.providerId, type: x.type, file_url: x.fileName, file_name: x.fileName, notes: x.notes })),
    vehicles: valid(state.vehicles).map((x) => ({ id: x.id, plate: x.plate, model: x.model, brand: x.brand, year: x.year, color: x.color, current_km: x.currentKm, front_right_tire: x.frontRightTire, front_left_tire: x.frontLeftTire, rear_right_tire: x.rearRightTire, rear_left_tire: x.rearLeftTire, last_oil_change_date: x.lastOilChangeDate || null, last_oil_change_km: x.lastOilChangeKm, status: x.status, renavam: x.renavam, licensing_due_date: x.licensingDueDate || null, insurance_info: x.insuranceInfo, notes: x.notes })),
    materials: valid(state.materials).map((x) => ({ id: x.id, name: x.name, category: x.category, unit: x.unit, internal_code: x.internalCode, minimum_stock: x.minimumStock, composes_kit: x.composesKit, status: x.status, notes: x.notes, ...materialErpColumns(x) })),
    stock_kits: valid(state.stockKits || []).map((x) => ({ id: x.id, name: x.name, description: x.description, unit_value: Number((x as any).unitValue || 0), stock_quantity: Math.max(0, Math.floor(Number((x as any).quantityInStock || 0))), status: x.status, notes: x.notes })),
    stock_kit_items: valid(state.stockKitItems || []).filter((x) => isUuid(x.kitId) && isUuid(x.materialId)).map((x) => ({ id: x.id, kit_id: x.kitId, material_id: x.materialId, quantity: x.quantity, unit: x.unit })),
    pmoc_plans: valid(state.pmocPlans || []).filter((x) => isUuid(x.clientId)).map((x) => {
      const startParts = dateParts((x as any).startDate)
      return { id: x.id, client_id: x.clientId, work_id: nullableUuid(x.workId), name: x.name, frequency: x.frequency, start_month: Number(x.startMonth || startParts?.month || 1), start_year: Number(x.startYear || startParts?.year || new Date().getFullYear()), start_date: (x as any).startDate || null, end_date: (x as any).endDate || null, schedule_day: Math.max(1, Math.min(31, Number((x as any).scheduleDay || startParts?.day || 10))), main_provider_id: nullableUuid((x as any).mainProviderId), status: x.status, payment_method: (x as any).paymentMethod || "", payment_type: (x as any).paymentType || "", payment_term: (x as any).paymentTerm || "", payment_due_date: (x as any).paymentDueDate || null, financial_notes: (x as any).financialNotes || "", notes: x.notes }
    }),
    pmoc_sectors: valid(state.pmocSectors || []).filter((x) => isUuid(x.planId)).map((x) => ({ id: x.id, pmoc_plan_id: x.planId, name: x.name, floor: x.floor, status: x.status, notes: x.notes })),
    pmoc_equipment: valid(state.pmocEquipment || []).filter((x) => isUuid(x.planId) && isUuid(x.sectorId)).map((x) => ({ id: x.id, pmoc_plan_id: x.planId, pmoc_sector_id: x.sectorId, client_environment_id: nullableUuid((x as any).clientEnvironmentId), client_equipment_id: nullableUuid((x as any).clientEquipmentId), tag: x.tag, name: x.name, brand: x.brand, model: x.model, serial_number: x.serialNumber, capacity: x.capacity, location: x.location, status: x.status, notes: x.notes })),
    pmoc_equipment_services: valid(state.pmocEquipmentServices || []).filter((x) => isUuid(x.planId) && isUuid(x.equipmentId) && isUuid(x.serviceTypeId)).map((x) => ({ id: x.id, pmoc_plan_id: x.planId, pmoc_equipment_id: x.equipmentId, service_type_id: x.serviceTypeId })),
    pmoc_schedules: valid(state.pmocSchedules || []).filter((x) => isUuid(x.planId) && isUuid(x.equipmentId) && isUuid(x.serviceTypeId)).map((x) => ({ id: x.id, pmoc_plan_id: x.planId, pmoc_equipment_id: x.equipmentId, service_type_id: x.serviceTypeId, month: x.month, year: x.year, scheduled_date: x.scheduledDate || null, service_order_id: nullableUuid(x.serviceOrderId), status: x.status })),
    service_orders: valid(state.serviceOrders).filter((x) => isUuid(x.clientId) && isUuid(x.workId)).map((x) => ({ id: x.id, order_number: x.orderNumber, order_type: (x as any).orderType || "obra", service_category: (x as any).serviceCategory || "", client_id: x.clientId, work_id: x.workId, client_environment_id: nullableUuid((x as any).clientEnvironmentId), client_equipment_id: nullableUuid((x as any).clientEquipmentId), floor_id: nullableUuid(resolveFloorId(x.floorId)), environment_id: nullableUuid(x.environmentId), point_id: nullableUuid(x.pointId), service_type_id: nullableUuid(x.serviceTypeId), simple_service: x.simpleService, priority: dbPriority(x.priority), description: x.description, scheduled_date: x.scheduledDate || null, scheduled_start_time: x.scheduledStartTime || null, scheduled_end_time: x.scheduledEndTime || null, estimated_duration: x.estimatedDuration, allow_reschedule: x.allowReschedule, schedule_notes: x.scheduleNotes, main_provider_id: nullableUuid(x.mainProviderId), helper_provider_id: nullableUuid(x.helperProviderId), supervisor_id: nullableUuid(x.supervisorId), vehicle_id: nullableUuid(x.vehicleId), initial_km: x.initialKm, final_km: x.finalKm, total_amount: Number((x as any).totalAmount || 0), payment_method: (x as any).paymentMethod || "", payment_type: (x as any).paymentType || "", payment_term: (x as any).paymentTerm || "", payment_due_date: (x as any).paymentDueDate || null, financial_notes: (x as any).financialNotes || "", status: x.status, customer_responsible_name: x.customerResponsibleName, customer_responsible_phone: x.customerResponsiblePhone, team_notes: x.teamNotes, notes: x.notes, pause_reason: x.pauseReason, cancellation_reason: x.cancellationReason, partial_reason: x.partialReason, finished_at: x.finishedAt || null, cancelled_at: x.cancelledAt || null })),
    service_order_events: valid(state.serviceOrderEvents).filter((x) => isUuid(x.serviceOrderId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, step_name: x.stepName, status: x.status, provider_id: nullableUuid(x.providerId), event_datetime: x.eventDatetime, notes: x.notes })),
    service_order_checklist_items: valid(state.checklistItems).filter((x) => isUuid(x.serviceOrderId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, task_name: x.taskName, required: x.required, requires_photo: x.requiresPhoto, status: x.status, responsible_provider_id: nullableUuid(x.responsibleProviderId), notes: x.notes, completed_at: x.completedAt || null })),
    service_order_materials: valid(state.serviceOrderMaterials).filter((x) => isUuid(x.serviceOrderId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, material_id: nullableUuid(x.materialId), item_name: x.itemName, expected_quantity: x.expectedQuantity, used_quantity: x.usedQuantity, unit: x.unit, status: x.status, notes: x.notes })),
    service_order_files: valid(state.serviceOrderFiles).filter((x) => isUuid(x.serviceOrderId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, category: x.category, file_url: x.fileUrl || x.fileName, file_name: x.fileName, file_type: x.fileType, uploaded_by: nullableUuid(x.uploadedBy), notes: x.notes })),
    service_order_signatures: valid(state.serviceOrderSignatures).filter((x) => isUuid(x.serviceOrderId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, responsible_name: x.responsibleName, responsible_document: x.responsibleDocument, signature_url: x.signatureText, signature_text: x.signatureText, rating: x.rating, customer_notes: x.customerNotes })),
    vehicle_checklists: valid(state.vehicleChecklists).filter((x) => isUuid(x.serviceOrderId) && isUuid(x.vehicleId)).map((x) => ({ id: x.id, service_order_id: x.serviceOrderId, vehicle_id: x.vehicleId, provider_id: nullableUuid(x.providerId), cleanliness_state: x.cleanlinessState, conservation_state: x.conservationState, front_right_tire: x.frontRightTire, front_left_tire: x.frontLeftTire, rear_right_tire: x.rearRightTire, rear_left_tire: x.rearLeftTire, mandatory_safety_items: x.mandatorySafetyItems, oil_level: x.oilLevel, brakes_test: x.brakesTest, windshield_wipers: x.windshieldWipers, mirrors: x.mirrors, lights: x.lights, fuel_level: x.fuelLevel, notes: x.notes, accepted_at: x.acceptedAt })),
    vehicle_usage: valid(state.vehicleUsage).filter((x) => isUuid(x.vehicleId)).map((x) => ({ id: x.id, vehicle_id: x.vehicleId, provider_id: nullableUuid(x.providerId), service_order_id: nullableUuid(x.serviceOrderId), date: x.date || null, initial_km: x.initialKm, final_km: x.finalKm })),
    vehicle_maintenance: valid(state.vehicleMaintenance).filter((x) => isUuid(x.vehicleId)).map((x) => ({ id: x.id, vehicle_id: x.vehicleId, type: x.type, start_date: x.date || null, date: x.date || null, km: x.km, cost: x.cost, description: x.description, end_date: x.nextMaintenance || null, next_maintenance: x.nextMaintenance || null, status: x.status, attachment_url: x.attachmentName })),
    operational_statuses: valid(state.statuses).map((x) => ({ id: x.id, name: x.name, color: x.color, order_index: x.order, final_status: x.finalStatus, editable: x.editable, requires_reason: x.requiresReason })),
    execution_steps: valid(state.executionSteps).map((x) => ({ id: x.id, name: x.name, order_index: x.order, requires_photo: x.requiresPhoto, requires_location: x.requiresLocation, requires_notes: x.requiresNotes, changes_status_to: x.changesStatusTo })),
    audit_logs: valid(state.auditLogs).map((x) => ({ id: x.id, user_id: null, entity_type: x.entityType, entity_id: nullableUuid(x.entityId), action: x.action, description: x.description })),
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const section = url.searchParams.get("section")
    if (section && !operationalSections.includes(section as OperationalSection)) return NextResponse.json({ error: "Secao invalida" }, { status: 400 })
    const requestedSection = section as OperationalSection | null
    const orderId = url.searchParams.get("orderId") || ""
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user && !isUuid(orderId)) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

    const supabase = orderId ? (await createAdminClientForServiceOrder(orderId)).client : createAdminClient()
    const { data: profile } = user
      ? await supabase.from("profiles").select("role, client_id").eq("id", user.id).maybeSingle()
      : { data: null }
    const clientScoped = profile?.role === "client"
    if (clientScoped && !profile.client_id) return NextResponse.json({ error: "Usuario cliente sem cliente vinculado" }, { status: 403 })

    const respond = (state: OperationalState, flags: Record<string, boolean>) => NextResponse.json({
      state: requestedSection ? operationalStateSection(state, requestedSection) : state, source: "supabase", ...flags,
    })
    const names = tablesForRequest(requestedSection, clientScoped || Boolean(orderId), Boolean(orderId))
    const entries = await Promise.all(names.map(async (name) => {
      const rows = optionalTableNames.has(name) ? await optionalTable(supabase, name) : await table(supabase, name)
      return [name, rows] as const
    }))
    const loaded = Object.fromEntries(entries) as Record<string, any[]>
    const result = Object.fromEntries(allOperationalTableNames.map((name) => [name, loaded[name] || []])) as Record<string, any[]>
    const fullState = fromDb(result)
    if (user) {
      if (clientScoped) {
        if (orderId) {
          const order = fullState.serviceOrders.find((item) => item.id === orderId)
          if (!order) return NextResponse.json({ error: "OS nao encontrada" }, { status: 404 })
          if (order.clientId !== profile!.client_id) return NextResponse.json({ error: "Acesso negado a esta OS" }, { status: 403 })
          return respond(scopeStateForOrder(fullState, orderId)!, { clientScoped: true, orderScoped: true })
        }
        return respond(scopeStateForClient(fullState, profile!.client_id), { clientScoped: true })
      }
      if (orderId) {
        const orderState = scopeStateForOrder(fullState, orderId)
        if (!orderState) return NextResponse.json({ error: "OS nao encontrada" }, { status: 404 })
        return respond(orderState, { orderScoped: true })
      }
      return respond(fullState, { clientScoped: false })
    }
    const publicState = orderId ? scopeStateForOrder(fullState, orderId) : null
    if (!publicState) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    return respond(publicState, { publicOrderScoped: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar Supabase" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    const orderId = new URL(request.url).searchParams.get("orderId") || ""
    let publicOrderWrite = false
    if (user) {
      const admin = createAdminClient()
      const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle()
      if (profile?.role === "client") return NextResponse.json({ error: "Acesso de cliente e somente leitura" }, { status: 403 })
    } else {
      if (!isUuid(orderId)) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
      publicOrderWrite = true
    }
    const { state } = await request.json() as { state: OperationalState }
    const supabase = orderId ? (await createAdminClientForServiceOrder(orderId)).client : createAdminClient()
    const rows = toDb(normalizeOperationalStateIds(state, companyId))
    if (publicOrderWrite) {
      if (rows.service_orders.length !== 1 || rows.service_orders[0]?.id !== orderId) {
        return NextResponse.json({ error: "O formulario publico so pode alterar a OS vinculada ao link" }, { status: 403 })
      }
      const invalidChild = [rows.service_order_events, rows.service_order_checklist_items, rows.service_order_materials, rows.service_order_files, rows.service_order_signatures, rows.vehicle_checklists]
        .some((items) => items.some((item: any) => item.service_order_id !== orderId))
      if (invalidChild) return NextResponse.json({ error: "Dados fora da OS vinculada" }, { status: 403 })
    }
    const namesToSave = publicOrderWrite
      ? ["service_orders", "service_order_events", "service_order_checklist_items", "service_order_materials", "service_order_files", "service_order_signatures", "vehicle_checklists", "vehicle_usage"] as const
      : ["clients", "client_contacts", "client_environments", "client_equipment", "suppliers", "works", "work_floors", "service_types", "service_type_checklist_items", "service_type_materials", "work_environments", "environment_photos", "work_points", "point_photos", "providers", "provider_documents", "vehicles", "materials", "stock_kits", "stock_kit_items", "pmoc_plans", "pmoc_sectors", "pmoc_equipment", "pmoc_equipment_services", "service_orders", "pmoc_schedules", "service_order_events", "service_order_checklist_items", "service_order_materials", "service_order_files", "service_order_signatures", "vehicle_checklists", "vehicle_usage", "vehicle_maintenance", "operational_statuses", "execution_steps", "audit_logs"] as const
    const stockSyncIds = await serviceOrdersNeedingStockSync(supabase, rows.service_orders)
    for (const name of namesToSave) {
      await upsertRows(supabase, name, rows[name])
    }
    await syncReceivablesForServiceOrders(supabase, rows.service_orders)
    for (const id of stockSyncIds) await syncStockForServiceOrderSafely(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar Supabase" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    const supabase = createAdminClient()
    const { data: profile, error: profileError } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle()
    if (profileError || !profile || profile.active === false || profile.role === "client") {
      return NextResponse.json({ error: "Sem permissao para salvar estes registros" }, { status: 403 })
    }
    const { changes } = await request.json()
    const tables = {
      clients: "clients", clientContacts: "client_contacts", clientEnvironments: "client_environments",
      clientEquipment: "client_equipment", works: "works", pmocPlans: "pmoc_plans",
      pmocSectors: "pmoc_sectors", pmocEquipment: "pmoc_equipment", pmocEquipmentServices: "pmoc_equipment_services",
      serviceOrders: "service_orders", pmocSchedules: "pmoc_schedules", checklistItems: "service_order_checklist_items",
      serviceOrderMaterials: "service_order_materials", auditLogs: "audit_logs",
    } as const
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.entries(changes).some(([key, value]) =>
      !Object.hasOwn(tables, key) || !Array.isArray(value) || value.some((row) => !row || !isUuid(row.id)))) {
      return NextResponse.json({ error: "Alteracoes invalidas" }, { status: 400 })
    }
    const empty = Object.fromEntries(Object.entries(defaultOperationalState()).map(([key, value]) => [key, Array.isArray(value) ? [] : value])) as unknown as OperationalState
    const rows = toDb(normalizeOperationalStateIds({ ...empty, ...changes }, companyId))
    const stockSyncIds = new Set([
      ...(changes.serviceOrders?.length ? await serviceOrdersNeedingStockSync(supabase, rows.service_orders) : []),
      ...rows.service_order_materials.map((row: any) => row.service_order_id),
    ])
    for (const [key, name] of Object.entries(tables)) {
      if (!changes[key]?.length) continue
      const records = rows[name]
      if (records.length !== changes[key].length) throw new Error(`${name}: vinculos invalidos. Recarregue os cadastros antes de salvar.`)
      for (let index = 0; index < records.length; index += 200) {
        // These writes must never silently drop a missing table or column.
        const batch = records.slice(index, index + 200)
        const prepared = name === "works" ? await uniqueWorkCodes(supabase, batch)
          : name === "service_orders" ? await uniqueServiceOrderNumbers(supabase, batch) : batch
        const { error } = await supabase.from(name).upsert(prepared, { onConflict: "id" })
        if (error) throw new Error(`${name}: ${error.message}`)
      }
    }
    if (changes.serviceOrders?.length) await syncReceivablesForServiceOrders(supabase, rows.service_orders)
    for (const id of stockSyncIds) if (id) await syncStockForServiceOrderSafely(supabase, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar registros" }, { status: 500 })
  }
}
