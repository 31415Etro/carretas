import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createAdminClient, createClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { defaultOperationalState, type OperationalState } from "@/lib/operational-storage"
import { materialErpFields } from "@/lib/material-fields"
import { readAllPages } from "@/lib/supabase-pagination"

export const dynamic = "force-dynamic"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value))
}

function nullableUuid(value?: string) {
  return isUuid(value) ? value : null
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`operational:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string, companyId = "") {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(`${companyId}:${value}`)
}

/** Ids gerados fora do padrão UUID são convertidos de forma estável antes de gravar. */
function normalizeOperationalStateIds(state: OperationalState, companyId = ""): OperationalState {
  const ref = (id?: string) => (id ? normalizeId(id, companyId) : "")
  return {
    ...state,
    clients: state.clients.map((x) => ({ ...x, id: ref(x.id) })),
    suppliers: (state.suppliers || []).map((x) => ({ ...x, id: ref(x.id) })),
    providers: state.providers.map((x) => ({ ...x, id: ref(x.id) })),
    vehicles: state.vehicles.map((x) => ({ ...x, id: ref(x.id) })),
    vehicleMaintenance: state.vehicleMaintenance.map((x) => ({ ...x, id: ref(x.id), vehicleId: ref(x.vehicleId) })),
    auditLogs: state.auditLogs.map((x) => ({ ...x, id: ref(x.id), userId: ref(x.userId), entityId: ref(x.entityId) })),
  }
}

type Admin = ReturnType<typeof createAdminClient>
const missingTable = (message: string) => /Could not find the table|relation .* does not exist/i.test(message)

async function load(supabase: Admin, name: string, columns = "*", optional = false) {
  try {
    return await readAllPages<any>((from, to) => supabase.from(name).select(columns).order("id").range(from, to))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (optional && missingTable(message)) return []
    throw new Error(`${name}: ${message}`)
  }
}

async function upsertRows(supabase: Admin, name: string, rows: any[]) {
  const deduped = Array.from(new Map(rows.filter((row) => row?.id).map((row) => [row.id, row])).values())
  if (!deduped.length) return
  let current = deduped
  let error: any = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await supabase.from(name).upsert(current, { onConflict: "id" })
    error = result.error
    if (!error) return
    const missingColumn = error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!missingColumn) break
    current = current.map((row) => {
      const { [missingColumn]: _ignored, ...rest } = row
      return rest
    })
  }
  throw new Error(`${name}: ${error.message}`)
}

function fromDb(rows: Record<string, any[]>): OperationalState {
  const profiles = rows.profiles || []
  const systemUsers = profiles.length ? profiles : rows.system_users || []
  return {
    ...defaultOperationalState(),
    clients: rows.clients.map((x) => ({ id: x.id, type: x.type, name: x.name, document: x.document || "", corporateName: x.corporate_name || "", tradeName: x.trade_name || "", stateRegistration: x.state_registration || "", responsibleName: x.responsible_name || "", phone: x.phone || "", mobile: x.mobile || "", email: x.email || "", zipCode: x.zip_code || "", street: x.street || "", number: x.number || "", complement: x.complement || "", district: x.district || "", city: x.city || "", state: x.state || "", status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    suppliers: rows.suppliers.map((x) => ({ id: x.id, name: x.name, document: x.document || "", contactName: x.contact_name || "", phone: x.phone || "", email: x.email || "", category: x.category || "", categoryIds: Array.isArray(x.category_ids) ? x.category_ids : [], city: x.city || "", state: x.state || "", status: x.status || "Ativo", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    providers: rows.providers.map((x) => ({ id: x.id, fullName: x.full_name, cpf: x.cpf || "", rg: x.rg || "", birthDate: x.birth_date || "", phone: x.phone || "", email: x.email || "", zipCode: x.zip_code || "", street: x.street || "", number: x.number || "", complement: x.complement || "", district: x.district || "", city: x.city || "", state: x.state || "", role: x.role || "", relationshipType: x.relationship_type || "", status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    vehicles: rows.vehicles.map((x) => ({ id: x.id, plate: x.plate, model: x.model, brand: x.brand, year: x.year || "", color: x.color || "", currentKm: Number(x.current_km || 0), frontRightTire: x.front_right_tire, frontLeftTire: x.front_left_tire, rearRightTire: x.rear_right_tire, rearLeftTire: x.rear_left_tire, lastOilChangeDate: x.last_oil_change_date || "", lastOilChangeKm: Number(x.last_oil_change_km || 0), status: x.status, renavam: x.renavam || "", licensingDueDate: x.licensing_due_date || "", insuranceInfo: x.insurance_info || "", notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    vehicleMaintenance: rows.vehicle_maintenance.map((x) => ({ id: x.id, vehicleId: x.vehicle_id, type: x.type, date: x.start_date, km: Number(x.km || 0), cost: Number(x.cost || 0), description: x.description || "", nextMaintenance: x.end_date || x.next_maintenance || "", status: x.status, attachmentName: x.attachment_url || "" })),
    materials: rows.materials.map((x) => ({ id: x.id, name: x.name, category: x.category || "", unit: x.unit, internalCode: x.internal_code || "", minimumStock: Number(x.minimum_stock || 0), currentStock: Number(x.current_stock || 0), status: x.status, notes: x.notes || "", ...materialErpFields(x), createdAt: x.created_at, updatedAt: x.updated_at })),
    serviceOrders: rows.service_orders.map((x) => ({ id: x.id, orderNumber: x.order_number, clientId: x.client_id || "", status: x.status, orderKind: x.order_kind || "", description: x.description || "", totalAmount: Number(x.total_amount || 0) })),
    systemUsers: systemUsers.map((x) => profiles.length
      ? ({ id: x.id, name: x.full_name || x.email, email: x.email, phone: x.phone || "", profile: x.role === "admin" ? "Administrador" : x.role === "manager" ? "Supervisor" : x.role === "sdr" ? "Atendimento" : x.role === "client" ? "Cliente" : "Tecnico", temporaryPassword: "", status: x.active === false ? "Inativo" : "Ativo", permissions: x.page_permissions || [], clientId: x.client_id || "" })
      : ({ id: x.id, name: x.name, email: x.email, phone: x.phone || "", profile: x.profile, temporaryPassword: "", status: x.status, permissions: x.permissions || [], clientId: x.client_id || "" })),
    auditLogs: rows.audit_logs.map((x) => ({ id: x.id, userId: x.user_id || "", entityType: x.entity_type, entityId: x.entity_id || "", action: x.action, description: x.description || "", createdAt: x.created_at })),
  }
}

/** Tabelas que as telas de cadastro gravam; materiais, usuários e OS têm rotas próprias. */
function toDb(state: OperationalState) {
  const valid = <T extends { id: string }>(items: T[]) => items.filter((x) => isUuid(x.id))
  return {
    clients: valid(state.clients).map((x) => ({ id: x.id, type: x.type, name: x.name, document: x.document, corporate_name: x.corporateName, trade_name: x.tradeName, state_registration: x.stateRegistration, responsible_name: x.responsibleName, phone: x.phone, mobile: x.mobile, email: x.email, zip_code: x.zipCode, street: x.street, number: x.number, complement: x.complement, district: x.district, city: x.city, state: x.state, status: x.status, notes: x.notes })),
    suppliers: valid(state.suppliers || []).map((x) => ({ id: x.id, name: x.name, document: x.document, contact_name: x.contactName, phone: x.phone, email: x.email, category: x.category, category_ids: (x.categoryIds || []).filter(isUuid), city: x.city, state: x.state, status: x.status, notes: x.notes })),
    providers: valid(state.providers).map((x) => ({ id: x.id, full_name: x.fullName, cpf: x.cpf, rg: x.rg, birth_date: x.birthDate || null, phone: x.phone, email: x.email, zip_code: x.zipCode, street: x.street, number: x.number, complement: x.complement, district: x.district, city: x.city, state: x.state, role: x.role, relationship_type: x.relationshipType, status: x.status, notes: x.notes })),
    vehicles: valid(state.vehicles).map((x) => ({ id: x.id, plate: x.plate, model: x.model, brand: x.brand, year: x.year, color: x.color, current_km: x.currentKm, front_right_tire: x.frontRightTire, front_left_tire: x.frontLeftTire, rear_right_tire: x.rearRightTire, rear_left_tire: x.rearLeftTire, last_oil_change_date: x.lastOilChangeDate || null, last_oil_change_km: x.lastOilChangeKm, status: x.status, renavam: x.renavam, licensing_due_date: x.licensingDueDate || null, insurance_info: x.insuranceInfo, notes: x.notes })),
    vehicle_maintenance: valid(state.vehicleMaintenance).filter((x) => isUuid(x.vehicleId)).map((x) => ({ id: x.id, vehicle_id: x.vehicleId, type: x.type, start_date: x.date || null, date: x.date || null, km: x.km, cost: x.cost, description: x.description, end_date: x.nextMaintenance || null, next_maintenance: x.nextMaintenance || null, status: x.status, attachment_url: x.attachmentName })),
    audit_logs: valid(state.auditLogs).map((x) => ({ id: x.id, user_id: null, entity_type: x.entityType, entity_id: nullableUuid(x.entityId), action: x.action, description: x.description })),
  }
}

const writeOrder = ["clients", "suppliers", "providers", "vehicles", "vehicle_maintenance", "audit_logs"] as const

async function internalUser() {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Nao autenticado" }, { status: 401 }) } as const
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle()
  if (!profile || profile.active === false || profile.role === "client") return { error: NextResponse.json({ error: "Sem permissao para acessar estes cadastros" }, { status: 403 }) } as const
  return { admin } as const
}

export async function GET() {
  try {
    const access = await internalUser()
    if ("error" in access) return access.error
    const supabase = access.admin
    const [clients, suppliers, providers, vehicles, vehicleMaintenance, materials, orders, profiles, systemUsers, auditLogs] = await Promise.all([
      load(supabase, "clients"),
      load(supabase, "suppliers", "*", true),
      load(supabase, "providers"),
      load(supabase, "vehicles"),
      load(supabase, "vehicle_maintenance"),
      load(supabase, "materials"),
      load(supabase, "service_orders", "id,order_number,client_id,status,order_kind,description,total_amount"),
      load(supabase, "profiles", "*", true),
      load(supabase, "system_users", "*", true),
      load(supabase, "audit_logs"),
    ])
    const state = fromDb({ clients, suppliers, providers, vehicles, vehicle_maintenance: vehicleMaintenance, materials, service_orders: orders, profiles, system_users: systemUsers, audit_logs: auditLogs })
    return NextResponse.json({ state, source: "supabase" })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar Supabase" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const access = await internalUser()
    if ("error" in access) return access.error
    const companyId = await getSelectedSystemCompanyId()
    const { state } = await request.json() as { state: OperationalState }
    const rows = toDb(normalizeOperationalStateIds(state, companyId))
    for (const name of writeOrder) await upsertRows(access.admin, name, rows[name])
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar Supabase" }, { status: 500 })
  }
}
