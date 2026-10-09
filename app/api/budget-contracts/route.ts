import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createAdminClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"

export const dynamic = "force-dynamic"

type BudgetWork = { id: string; name: string; client: string; clientId?: string; notes: string; createdAt: string }
type BudgetTower = { id: string; workId: string; name: string; description: string }
type BudgetFloor = { id: string; towerId: string; name: string; level: string }
type BudgetFinal = { id: string; floorId: string; name: string; description: string }
type BudgetEnvironment = { id: string; typeId: string; name: string; pointsQuantity: number; notes: string }
type BudgetPointService = { id: string; name: string }
type BudgetPoint = { id: string; environmentId: string; name: string; number: number; serviceType: string; serviceTypeId?: string; serviceTypes?: BudgetPointService[]; kitId?: string; kitName?: string; infrastructureMeasure?: string; measurementConfirmation?: string; specifications?: string; notes: string }
type BudgetPlan = { id: string; workId: string; towerId: string; name: string; fileUrl: string; fileName: string; storagePath: string; pageCount: number; createdAt: string }
type BudgetPlanPlacement = { id: string; planId: string; pointId: string; pageNumber: number; x: number; y: number }
type BudgetState = {
  works: BudgetWork[]
  towers: BudgetTower[]
  floors: BudgetFloor[]
  types: BudgetFinal[]
  environments: BudgetEnvironment[]
  points: BudgetPoint[]
  plans: BudgetPlan[]
  planPlacements: BudgetPlanPlacement[]
}

type Contract = {
  id: string
  number: string
  client: string
  work: string
  title: string
  startDate: string
  endDate: string
  value: number
  status: string
  notes: string
  createdAt: string
}

type ContractTemplate = {
  id: string
  name: string
  type: string
  description: string
  status: string
}

const budgetContractTableNames = ["budget_works", "budget_towers", "budget_floors", "budget_service_types", "budget_environments", "budget_points", "budget_plans", "budget_plan_points", "contracts", "contract_templates"] as const
const budgetContractCacheTtlMs = 30_000
const budgetContractCache = new Map<string, { payload: any; expiresAt: number }>()
const budgetContractLoads = new Map<string, Promise<any>>()

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value))
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`budget:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string, companyId = "") {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(`${companyId}:${value}`)
}

async function table(supabase: ReturnType<typeof createAdminClient>, name: string) {
  return readAllPages<any>((from, to) => supabase.from(name).select("*").order("id").range(from, to))
}

async function optionalTable(supabase: ReturnType<typeof createAdminClient>, name: string) {
  const { data, error } = await supabase.from(name).select("*")
  if (error && /does not exist|schema cache|relation/i.test(error.message)) return []
  if (error) throw new Error(`${name}: ${error.message}`)
  return data || []
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, name: string, rows: any[]) {
  if (!rows.length) return
  const { error } = await supabase.from(name).upsert(rows, { onConflict: "id" })
  if (!error) return
  const missingBudgetWorkClientId = name === "budget_works" && /client_id/i.test(error.message)
  if (missingBudgetWorkClientId) {
    const fallbackRows = rows.map(({ client_id, ...row }) => row)
    const fallback = await supabase.from(name).upsert(fallbackRows, { onConflict: "id" })
    if (!fallback.error) return
    throw new Error(`${name}: ${fallback.error.message}`)
  }
  throw new Error(`${name}: ${error.message}`)
}

async function deleteMissingRows(supabase: ReturnType<typeof createAdminClient>, name: string, keepIds: string[], optional = false) {
  const { data, error } = await supabase.from(name).select("id")
  if (error && optional && /does not exist|schema cache|relation/i.test(error.message)) return
  if (error) throw new Error(`${name}: ${error.message}`)
  const keep = new Set(keepIds)
  const staleIds = (data || []).map((row: any) => row.id).filter((id: string) => !keep.has(id))
  for (let index = 0; index < staleIds.length; index += 200) {
    const { error: deleteError } = await supabase.from(name).delete().in("id", staleIds.slice(index, index + 200))
    if (deleteError) throw new Error(`${name}: ${deleteError.message}`)
  }
}

async function validateBudgetPoints(supabase: ReturnType<typeof createAdminClient>, points: BudgetPoint[]) {
  if (!points.length) return
  const saved: any[] = []
  for (let index = 0; index < points.length; index += 200) {
    const ids = points.slice(index, index + 200).map((point) => point.id)
    const { data, error } = await supabase
      .from("budget_points")
      .select("id,infrastructure_measure,measurement_confirmation")
      .in("id", ids)
    if (error) throw new Error(`budget_points: ${error.message}. Execute a migracao 134 antes de salvar o orcamento.`)
    saved.push(...(data || []))
  }
  const savedById = new Map(saved.map((row) => [row.id, row]))
  for (const point of points) {
    const row = savedById.get(point.id)
    if (!row) throw new Error(`budget_points: o ponto ${point.name} nao foi confirmado no banco.`)
    if (String(row.infrastructure_measure || "") !== String(point.infrastructureMeasure || "") || String(row.measurement_confirmation || "") !== String(point.measurementConfirmation || "")) {
      throw new Error(`budget_points: as medidas do ponto ${point.name} nao foram confirmadas no banco.`)
    }
  }
}

function missingOptionalTable(message = "") {
  return /does not exist|schema cache|relation/i.test(message)
}

async function syncStockServiceOrders(supabase: ReturnType<typeof createAdminClient>, budget: BudgetState) {
  const environments = new Map(budget.environments.map((item) => [item.id, item]))
  const finals = new Map(budget.types.map((item) => [item.id, item]))
  const floors = new Map(budget.floors.map((item) => [item.id, item]))
  const towers = new Map(budget.towers.map((item) => [item.id, item]))
  const works = new Map(budget.works.map((item) => [item.id, item]))
  const pointIds = budget.points.map((point) => point.id)

  const existingRows: any[] = []
  for (let index = 0; index < pointIds.length; index += 200) {
    const { data, error } = await supabase.from("stock_service_orders").select("*").in("budget_point_id", pointIds.slice(index, index + 200))
    if (error && missingOptionalTable(error.message)) return
    if (error) throw new Error(`stock_service_orders: ${error.message}`)
    existingRows.push(...(data || []))
  }
  const existingByPoint = new Map((existingRows || []).map((row: any) => [row.budget_point_id, row]))

  const rows = budget.points.filter((point) => point.kitId || point.kitName).map((point) => {
    const environment = environments.get(point.environmentId)
    const final = environment ? finals.get(environment.typeId) : undefined
    const floor = final ? floors.get(final.floorId) : undefined
    const tower = floor ? towers.get(floor.towerId) : undefined
    const work = tower ? works.get(tower.workId) : undefined
    const existing = existingByPoint.get(point.id) as any
    const kitChanged = Boolean(existing) && (
      String(existing.kit_id || "") !== String(isUuid(point.kitId) ? point.kitId : "")
      || String(existing.kit_name || "") !== String(point.kitName || "")
      || String(existing.infrastructure_measure || "") !== String(point.infrastructureMeasure || "")
    )
    return {
      id: existing?.id || uuidFromText(`stock-service-order:${point.id}`),
      budget_work_id: work?.id,
      budget_point_id: point.id,
      kit_id: isUuid(point.kitId) ? point.kitId : null,
      status: kitChanged ? "Aberto" : existing?.status || "Aberto",
      work_name: work?.name || "",
      tower_name: tower?.name || "",
      floor_name: floor?.name || "",
      final_name: final?.name || "",
      environment_name: environment?.name || "",
      point_name: point.name || "",
      kit_name: point.kitName || "",
      infrastructure_measure: point.infrastructureMeasure || "",
      has_welding: existing?.has_welding ?? null,
      guide_passage: existing?.guide_passage ?? null,
      linked_service_order_id: kitChanged ? null : existing?.linked_service_order_id || null,
      used_at: kitChanged ? null : existing?.used_at || null,
    }
  }).filter((row) => row.budget_work_id)

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase.from("stock_service_orders").upsert(rows.slice(index, index + 200), { onConflict: "budget_point_id" })
    if (error && missingOptionalTable(error.message)) return
    if (error) throw new Error(`stock_service_orders: ${error.message}`)
  }

  const activeKitPointIds = new Set(rows.map((row) => row.budget_point_id))
  const removedKitRows = (existingRows || []).filter((row: any) => !activeKitPointIds.has(row.budget_point_id)).map((row: any) => row.id)
  if (removedKitRows.length) {
    const { error } = await supabase.from("stock_service_orders").delete().in("id", removedKitRows)
    if (error && !missingOptionalTable(error.message)) throw new Error(`stock_service_orders: ${error.message}`)
  }
}

function normalizeBudgetIds(budget: BudgetState, companyId = ""): BudgetState {
  const map = new Map<string, string>()
  const remember = (id?: string) => {
    if (id) map.set(id, normalizeId(id, companyId))
  }
  const ref = (id?: string) => id ? map.get(id) || normalizeId(id, companyId) : ""

  budget.works.forEach((x) => remember(x.id))
  budget.towers.forEach((x) => remember(x.id))
  budget.floors.forEach((x) => remember(x.id))
  budget.types.forEach((x) => remember(x.id))
  budget.environments.forEach((x) => remember(x.id))
  budget.points.forEach((x) => remember(x.id))
  ;(budget.plans || []).forEach((x) => remember(x.id))
  ;(budget.planPlacements || []).forEach((x) => remember(x.id))

  return {
    works: budget.works.map((x) => ({ ...x, id: ref(x.id) })),
    towers: budget.towers.map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId) })),
    floors: budget.floors.map((x) => ({ ...x, id: ref(x.id), towerId: ref(x.towerId) })),
    types: budget.types.map((x) => ({ ...x, id: ref(x.id), floorId: ref(x.floorId) })),
    environments: budget.environments.map((x) => ({ ...x, id: ref(x.id), typeId: ref(x.typeId) })),
    points: budget.points.map((x) => ({ ...x, id: ref(x.id), environmentId: ref(x.environmentId) })),
    plans: (budget.plans || []).map((x) => ({ ...x, id: ref(x.id), workId: ref(x.workId), towerId: ref(x.towerId) })),
    planPlacements: (budget.planPlacements || []).map((x) => ({ ...x, id: ref(x.id), planId: ref(x.planId), pointId: ref(x.pointId) })),
  }
}

function normalizePointServices(point: BudgetPoint): BudgetPointService[] {
  if (Array.isArray(point.serviceTypes) && point.serviceTypes.length) {
    return point.serviceTypes
      .map((service) => ({ id: service.id || service.name, name: service.name }))
      .filter((service) => service.name)
  }
  return String(point.serviceType || "")
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: name, name }))
}

function dbPointServices(value: unknown, fallback: string): BudgetPointService[] {
  if (Array.isArray(value)) {
    return value
      .map((service: any) => ({ id: String(service?.id || service?.name || ""), name: String(service?.name || "") }))
      .filter((service) => service.name)
  }
  return String(fallback || "")
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: name, name }))
}

function fromDb(rows: Record<string, any[]>) {
  const budget: BudgetState = {
    works: rows.budget_works.map((x) => ({ id: x.id, name: x.name, client: x.client_name || "", clientId: x.client_id || "", notes: x.notes || "", createdAt: x.created_at })),
    towers: rows.budget_towers.map((x) => ({ id: x.id, workId: x.budget_work_id, name: x.name, description: x.description || "" })),
    floors: rows.budget_floors.map((x) => ({ id: x.id, towerId: x.budget_tower_id, name: x.name, level: x.level || "" })),
    types: rows.budget_service_types.map((x) => ({ id: x.id, floorId: x.budget_floor_id, name: x.name, description: x.description || "" })),
    environments: rows.budget_environments.map((x) => ({ id: x.id, typeId: x.budget_service_type_id, name: x.name, pointsQuantity: Number(x.points_quantity || 0), notes: x.notes || "" })),
    points: rows.budget_points.map((x) => {
      const serviceTypes = dbPointServices(x.service_types, x.service_type || "")
      return { id: x.id, environmentId: x.budget_environment_id, name: x.name, number: Number(x.point_number || 0), serviceType: serviceTypes.map((service) => service.name).join("; "), serviceTypeId: serviceTypes[0]?.id || "", serviceTypes, kitId: x.kit_id || "", kitName: x.kit_name || "", infrastructureMeasure: x.infrastructure_measure || "", measurementConfirmation: x.measurement_confirmation || "", specifications: x.specifications || "", notes: x.notes || "" }
    }),
    plans: (rows.budget_plans || []).map((x) => ({ id: x.id, workId: x.budget_work_id, towerId: x.budget_tower_id || "", name: x.name, fileUrl: x.file_url, fileName: x.file_name, storagePath: x.storage_path, pageCount: Number(x.page_count || 1), createdAt: x.created_at })),
    planPlacements: (rows.budget_plan_points || []).map((x) => ({ id: x.id, planId: x.budget_plan_id, pointId: x.budget_point_id, pageNumber: Number(x.page_number || 1), x: Number(x.x || 0), y: Number(x.y || 0) })),
  }

  const contracts: Contract[] = rows.contracts.map((x) => ({
    id: x.id,
    number: x.contract_number,
    client: x.client_name || "",
    work: x.work_name || "",
    title: x.title || "",
    startDate: x.start_date || "",
    endDate: x.end_date || "",
    value: Number(x.value || 0),
    status: x.status || "Em elaboração",
    notes: x.notes || "",
    createdAt: x.created_at,
  }))

  const templates: ContractTemplate[] = rows.contract_templates.map((x) => ({
    id: x.id,
    name: x.name,
    type: x.type || "",
    description: x.description || "",
    status: x.status || "Ativo",
  }))

  return { budget, contracts, templates }
}

async function replaceBudgets(supabase: ReturnType<typeof createAdminClient>, budgetInput: BudgetState, companyId: string) {
  const budget = normalizeBudgetIds(budgetInput, companyId)
  await upsertRows(supabase, "budget_works", budget.works.map((x) => ({ id: x.id, client_id: isUuid(x.clientId) ? x.clientId : null, client_name: x.client, name: x.name, notes: x.notes, status: "Ativo" })))
  await upsertRows(supabase, "budget_towers", budget.towers.map((x) => ({ id: x.id, budget_work_id: x.workId, name: x.name, description: x.description, status: "Ativo" })))
  await upsertRows(supabase, "budget_floors", budget.floors.map((x) => ({ id: x.id, budget_tower_id: x.towerId, name: x.name, level: x.level, status: "Ativo" })))
  await upsertRows(supabase, "budget_service_types", budget.types.map((x) => ({ id: x.id, budget_floor_id: x.floorId, name: x.name, description: x.description, status: "Ativo" })))
  await upsertRows(supabase, "budget_environments", budget.environments.map((x) => ({ id: x.id, budget_service_type_id: x.typeId, name: x.name, points_quantity: x.pointsQuantity, notes: x.notes, status: "Ativo" })))
  await upsertRows(supabase, "budget_points", budget.points.map((x) => {
    const serviceTypes = normalizePointServices(x)
    return { id: x.id, budget_environment_id: x.environmentId, name: x.name, point_number: x.number, service_type: serviceTypes.map((service) => service.name).join("; "), service_types: serviceTypes, kit_id: isUuid(x.kitId) ? x.kitId : null, kit_name: x.kitName || "", infrastructure_measure: x.infrastructureMeasure || "", measurement_confirmation: x.measurementConfirmation || "", specifications: x.specifications || "", notes: x.notes, status: "Ativo" }
  }))
  if (budget.plans.length) await upsertRows(supabase, "budget_plans", budget.plans.map((x) => ({ id: x.id, budget_work_id: x.workId, budget_tower_id: isUuid(x.towerId) ? x.towerId : null, name: x.name, file_url: x.fileUrl, file_name: x.fileName, storage_path: x.storagePath, page_count: Math.max(1, Number(x.pageCount || 1)) })))
  if (budget.planPlacements.length) await upsertRows(supabase, "budget_plan_points", budget.planPlacements.map((x) => ({ id: x.id, budget_plan_id: x.planId, budget_point_id: x.pointId, page_number: Math.max(1, Number(x.pageNumber || 1)), x: x.x, y: x.y })))
  await validateBudgetPoints(supabase, budget.points)
  await syncStockServiceOrders(supabase, budget)

  await deleteMissingRows(supabase, "budget_plan_points", budget.planPlacements.map((x) => x.id), true)
  await deleteMissingRows(supabase, "budget_plans", budget.plans.map((x) => x.id), true)
  await deleteMissingRows(supabase, "budget_points", budget.points.map((x) => x.id))
  await deleteMissingRows(supabase, "budget_environments", budget.environments.map((x) => x.id))
  await deleteMissingRows(supabase, "budget_service_types", budget.types.map((x) => x.id))
  await deleteMissingRows(supabase, "budget_floors", budget.floors.map((x) => x.id))
  await deleteMissingRows(supabase, "budget_towers", budget.towers.map((x) => x.id))
  await deleteMissingRows(supabase, "budget_works", budget.works.map((x) => x.id))
}

async function replaceContracts(supabase: ReturnType<typeof createAdminClient>, contracts: Contract[], companyId: string) {
  await supabase.from("contracts").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await upsertRows(supabase, "contracts", contracts.map((x) => ({
    id: normalizeId(x.id, companyId),
    contract_number: x.number,
    client_name: x.client,
    work_name: x.work,
    title: x.title,
    start_date: x.startDate || null,
    end_date: x.endDate || null,
    value: x.value || 0,
    status: x.status || "Em elaboração",
    notes: x.notes,
  })))
}

async function replaceTemplates(supabase: ReturnType<typeof createAdminClient>, templates: ContractTemplate[], companyId: string) {
  await supabase.from("contract_templates").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  await upsertRows(supabase, "contract_templates", templates.map((x) => ({
    id: normalizeId(x.id, companyId),
    name: x.name,
    type: x.type,
    description: x.description,
    status: x.status || "Ativo",
  })))
}

async function loadBudgetContracts() {
  const supabase = createAdminClient()
  const entries = await Promise.all(budgetContractTableNames.map(async (name) => {
    const rows = ["budget_plans", "budget_plan_points"].includes(name) ? await optionalTable(supabase, name) : await table(supabase, name)
    return [name, rows] as const
  }))
  return fromDb(Object.fromEntries(entries) as Record<string, any[]>)
}

export async function GET(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1"
    const cached = budgetContractCache.get(companyId)
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload)
    if (!budgetContractLoads.has(companyId)) budgetContractLoads.set(companyId, loadBudgetContracts())
    const payload = await budgetContractLoads.get(companyId)!
    budgetContractCache.set(companyId, { payload, expiresAt: Date.now() + budgetContractCacheTtlMs })
    budgetContractLoads.delete(companyId)
    return NextResponse.json(payload)
  } catch (error) {
    budgetContractLoads.delete(await getSelectedSystemCompanyId())
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar orçamentos e contratos" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const payload = await request.json()
    const supabase = createAdminClient()
    if (payload.budget) await replaceBudgets(supabase, payload.budget, companyId)
    if (payload.contracts) await replaceContracts(supabase, payload.contracts, companyId)
    if (payload.templates) await replaceTemplates(supabase, payload.templates, companyId)
    budgetContractCache.delete(companyId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar orçamentos e contratos" }, { status: 500 })
  }
}

export async function POST() {
  return NextResponse.json({ error: "A transformacao de orcamento em contrato foi desativada." }, { status: 410 })
}
