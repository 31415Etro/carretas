import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { audit } from "@/lib/audit"
import { applyStockMovement } from "@/lib/stock-engine"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildQrUrl, checkStatusChange, computeNextDue, fromCents, illustrationLibrary, lastMaintenanceDate, normalizeIllustration, selectableStatuses, totalMaintenanceCost,
  validateMachine, validateMachineFile, validateMeterReading, validateOrder, type MachineStatus,
} from "@/lib/machines"

type Admin = ReturnType<typeof createAdminClient>
type Row = Record<string, any>
type Kind = "s" | "t" | "n" | "nn" | "i" | "d" | "b"
type Scope = "patrimony" | "cost" | ""
type Spec = [camel: string, snake: string, kind: Kind, scope?: Scope]

export const MACHINES_MIGRATION_HINT = "Módulo Máquinas e Equipamentos ainda não instalado no banco. Rode scripts/218_maquinas.sql no SQL Editor do Supabase."
export const MACHINE_BUCKET = "machine-files"
export class MachineError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
const isMissing = (message = "") => /Could not find the (table|column|function)|relation .* does not exist|function .* does not exist|schema cache/i.test(message)

/** Erro -> resposta HTTP. Mensagens CONFLITO:/BLOQUEIO:/INVALIDO: vêm das funções do banco. */
export function machineError(error: unknown, fallback = "Erro no módulo de máquinas.") {
  if (error instanceof MachineError) return NextResponse.json({ error: error.message }, { status: error.status })
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return NextResponse.json({ error: MACHINES_MIGRATION_HINT }, { status: 503 })
  const tagged = /^(CONFLITO|BLOQUEIO|INVALIDO):\s*([\s\S]*)$/.exec(message)
  if (tagged) return NextResponse.json({ error: tagged[2], code: tagged[1] }, { status: tagged[1] === "INVALIDO" ? 400 : 409 })
  if (/machines_code_uidx|machine_qr/.test(message)) return NextResponse.json({ error: "Conflito ao gerar o identificador. Tente novamente." }, { status: 409 })
  if (/machines_serial_uidx/.test(message)) return NextResponse.json({ error: "Já existe uma máquina deste fabricante com este número de série." }, { status: 409 })
  if (/machine_categories_name_uidx|machine_sectors_name_uidx/.test(message)) return NextResponse.json({ error: "Já existe um cadastro com este nome." }, { status: 409 })
  if (/machine_orders_open_plan_uidx/.test(message)) return NextResponse.json({ error: "Já existe uma ordem em aberto para este plano." }, { status: 409 })
  console.error("[maquinas]", message)
  return NextResponse.json({ error: message || fallback }, { status: 400 })
}

// ===== Contexto e permissões =====
export type Caps = { view: boolean; maintain: boolean; patrimony: boolean; admin: boolean }
export type Ctx = { admin: Admin; userId: string; responsible: string; role: string; caps: Caps }

/** Usuário interno autenticado, com o que ele pode fazer neste módulo (admin pode tudo; os demais, por permissão). */
export async function machinesContext(): Promise<Ctx | NextResponse> {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") {
    await audit({ module: "acesso", action: "Acesso negado", description: "Cliente externo tentou usar uma rota de máquinas.", result: "Negado", actorId: user.id, actorEmail: user.email || "" })
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 })
  }
  const profiles = createAdminClient({ bypassCompanyScope: true })
  const { data } = await profiles.from("profiles").select("page_permissions").eq("id", user.id).maybeSingle()
  const permissions: string[] = Array.isArray(data?.page_permissions) ? data!.page_permissions : []
  const admin = role === "admin"
  const caps: Caps = { admin, view: admin || permissions.includes("maquinas"), maintain: admin || permissions.includes("maquinas_manutencao"), patrimony: admin || permissions.includes("maquinas_patrimonio") }
  if (!caps.view && !caps.maintain && !caps.patrimony) {
    await audit({ module: "acesso", action: "Acesso negado", description: "Usuário sem permissão tentou usar o módulo de máquinas.", result: "Negado", actorId: user.id, actorEmail: user.email || "" })
    return NextResponse.json({ error: "Sem permissão para Máquinas e Equipamentos." }, { status: 403 })
  }
  const responsible = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Usuario")
  return { admin: createAdminClient(), userId: user.id, responsible, role, caps: { ...caps, view: true } }
}
const need = (allowed: boolean, message: string) => { if (!allowed) throw new MachineError(message, 403) }

// ===== Mapeamento banco <-> tela =====
const machineSpecs: Spec[] = [
  ["name", "name", "t"], ["categoryId", "category_id", "s"], ["equipmentType", "equipment_type", "s"], ["manufacturer", "manufacturer", "s"], ["brand", "brand", "s"], ["model", "model", "s"],
  ["serialNumber", "serial_number", "s"], ["manufactureYear", "manufacture_year", "i"], ["description", "description", "s"], ["illustrationKey", "illustration_key", "t"], ["photoPath", "photo_path", "s"],
  ["unitCompanyId", "unit_company_id", "s"], ["sectorId", "sector_id", "s"], ["locationDetail", "location_detail", "s"], ["responsibleName", "responsible_name", "s"], ["usesHourMeter", "uses_hour_meter", "b"],
  ["acquisitionDate", "acquisition_date", "d", "patrimony"], ["acquisitionValue", "acquisition_value", "n", "patrimony"], ["supplierId", "supplier_id", "s", "patrimony"], ["supplierName", "supplier_name", "s", "patrimony"],
  ["invoiceNumber", "invoice_number", "s", "patrimony"], ["freightCost", "freight_cost", "n", "patrimony"], ["installationCost", "installation_cost", "n", "patrimony"], ["otherCosts", "other_costs", "n", "patrimony"],
  ["residualValue", "residual_value", "n", "patrimony"], ["usefulLifeMonths", "useful_life_months", "i", "patrimony"], ["depreciationMethod", "depreciation_method", "t", "patrimony"],
  ["depreciationStartDate", "depreciation_start_date", "d", "patrimony"], ["depreciationAdjustments", "depreciation_adjustments", "n", "patrimony"],
  ["marketValue", "market_value", "nn", "patrimony"], ["marketValueDate", "market_value_date", "d", "patrimony"], ["replacementValue", "replacement_value", "nn", "patrimony"],
]
const orderSpecs: Spec[] = [
  ["maintenanceType", "maintenance_type", "t"], ["priority", "priority", "t"], ["description", "description", "t"], ["problem", "problem", "s"], ["solution", "solution", "s"], ["responsible", "responsible", "s"],
  ["technician", "technician", "s"], ["externalCompany", "external_company", "s"], ["dueDate", "due_date", "d"], ["performedAt", "performed_at", "d"], ["laborHours", "labor_hours", "n", "cost"],
  ["laborCost", "labor_cost", "n", "cost"], ["otherCost", "other_cost", "n", "cost"], ["downtimeHours", "downtime_hours", "n"], ["blocksOperation", "blocks_operation", "b"], ["requiresApproval", "requires_approval", "b"],
  ["supplierId", "supplier_id", "s", "cost"], ["invoiceNumber", "invoice_number", "s", "cost"], ["notes", "notes", "s"],
]
const planSpecs: Spec[] = [
  ["name", "name", "t"], ["description", "description", "s"], ["maintenanceType", "maintenance_type", "t"], ["intervalDays", "interval_days", "i"], ["intervalMonths", "interval_months", "i"], ["intervalHours", "interval_hours", "nn"],
  ["fixedDate", "fixed_date", "d"], ["combineRule", "combine_rule", "t"], ["autoCreateOrder", "auto_create_order", "b"], ["blocksOperation", "blocks_operation", "b"], ["active", "active", "b"],
]

const read = (value: unknown, kind: Kind) => {
  if (kind === "b") return value === true || value === "true"
  if (kind === "n") return value === "" || value == null ? 0 : Number(String(value).replace(",", "."))
  if (kind === "nn") return value === "" || value == null ? null : Number(String(value).replace(",", "."))
  if (kind === "i") return value === "" || value == null ? null : Math.trunc(Number(value))
  const text = String(value ?? "").trim()
  return kind === "t" ? text : text || null
}
const allowedScope = (scope: Scope | undefined, caps: Caps) => !scope || (scope === "patrimony" ? caps.patrimony : caps.patrimony || caps.maintain)

function toRow(specs: Spec[], item: Row, caps: Caps, only?: Set<string>) {
  const row: Row = {}
  for (const [camel, snake, kind, scope] of specs) {
    if (!allowedScope(scope, caps) || !(camel in item) || (only && !only.has(camel))) continue
    row[snake] = read(item[camel], kind)
  }
  return row
}
function fromRow(specs: Spec[], row: Row, caps: Caps) {
  const out: Row = { id: row.id }
  for (const [camel, snake, kind, scope] of specs) {
    if (!allowedScope(scope, caps)) continue
    const value = row[snake]
    out[camel] = kind === "n" ? Number(value || 0) : kind === "nn" ? (value == null ? null : Number(value)) : kind === "i" ? (value == null ? "" : Number(value)) : kind === "b" ? Boolean(value) : value ?? ""
  }
  return out
}

export function mapMachine(row: Row, caps: Caps) {
  const out = fromRow(machineSpecs, row, caps)
  Object.assign(out, {
    code: row.code, codeKind: row.code_kind, adminStatus: row.admin_status, retiredAt: row.retired_at || "", retiredReason: row.retired_reason || "", operationalStatus: row.operational_status,
    statusSince: row.status_since, statusReason: row.status_reason || "", statusVersion: row.status_version, safetyLocked: Boolean(row.safety_locked), safetyLockReason: row.safety_lock_reason || "",
    hourMeter: Number(row.hour_meter || 0), hourMeterAt: row.hour_meter_at || "", lastMaintenanceAt: row.last_maintenance_at || "", createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by || "",
  })
  if (caps.patrimony || caps.maintain) out.totalMaintenanceCost = Number(row.total_maintenance_cost || 0)
  return out
}
export function mapOrder(row: Row, caps: Caps) {
  const out = fromRow(orderSpecs, row, caps)
  Object.assign(out, {
    machineId: row.machine_id, planId: row.plan_id || "", orderNumber: row.order_number || "", origin: row.origin, status: row.status, startedAt: row.started_at || "", completedAt: row.completed_at || "",
    approvedBy: row.approved_by || "", approvedAt: row.approved_at || "", validatedBy: row.validated_by || "", validatedAt: row.validated_at || "", checklist: Array.isArray(row.checklist) ? row.checklist : [],
    createdAt: row.created_at, createdBy: row.created_by || "",
  })
  if (caps.patrimony || caps.maintain) out.partsCost = Number(row.parts_cost || 0)
  return out
}
const mapPlan = (row: Row) => ({ ...fromRow(planSpecs, row, { admin: true, view: true, maintain: true, patrimony: true }), machineId: row.machine_id, checklist: Array.isArray(row.checklist) ? row.checklist : [], lastDoneDate: row.last_done_date || "", lastDoneHours: row.last_done_hours == null ? null : Number(row.last_done_hours), nextDueDate: row.next_due_date || "", nextDueHours: row.next_due_hours == null ? null : Number(row.next_due_hours) })
const mapHistory = (row: Row) => ({ id: row.id, fromStatus: row.from_status || "", toStatus: row.to_status, startedAt: row.started_at, endedAt: row.ended_at || "", reasonCode: row.reason_code || "", reason: row.reason || "", notes: row.notes || "", responsible: row.responsible || "", orderId: row.order_id || "", safetyLock: Boolean(row.safety_lock), safetyRelease: Boolean(row.safety_release), changedBy: row.changed_by || "" })

const today = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()
// o cliente do Supabase aqui não tem tipos gerados (como no resto do ERP): os dados chegam como `any`
const must = (result: { data: any; error: { message: string } | null }): any => {
  if (result.error) throw new Error(result.error.message)
  return result.data
}
const rows = (result: { data: any; error: { message: string } | null }): Row[] => {
  if (result.error) throw new Error(result.error.message)
  return result.data || []
}

// ===== Configurações =====
export async function loadSettings(admin: Admin) {
  const { data, error } = await admin.from("machine_settings").select("*").maybeSingle()
  if (error) throw new Error(error.message)
  return { codePrefix: data?.code_prefix || "ND", qrBaseUrl: data?.qr_base_url || "", dueSoonDays: Number(data?.due_soon_days || 15), highCostPercent: Number(data?.high_cost_percent || 30), autoCreateOrders: Boolean(data?.auto_create_orders) }
}

export async function saveSettings(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor ou administrador altera as configurações.")
  const qr = String(item.qrBaseUrl || "").trim().replace(/\/+$/, "")
  if (qr && !/^https:\/\/[^\s]+$/i.test(qr) && !/^http:\/\/localhost/i.test(qr)) throw new MachineError("A URL base do QR Code deve começar com https://", 400)
  const prefix = String(item.codePrefix || "ND").trim().toUpperCase()
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) throw new MachineError("O prefixo do código deve ter de 1 a 10 letras ou números.", 400)
  const percent = Number(item.highCostPercent) || 30
  const soon = Math.min(120, Math.max(1, Math.trunc(Number(item.dueSoonDays) || 15)))
  must(await ctx.admin.from("machine_settings").upsert({ code_prefix: prefix, qr_base_url: qr || null, due_soon_days: soon, high_cost_percent: percent, auto_create_orders: Boolean(item.autoCreateOrders), updated_by: ctx.responsible, updated_at: nowIso() }, { onConflict: "system_company_id" }).select("system_company_id").maybeSingle())
  return loadSettings(ctx.admin)
}

// ===== Listagem geral =====
export async function loadOverview(ctx: Ctx) {
  const { admin, caps } = ctx
  const [machines, sectors, categories, plans, orders, units, settings] = await Promise.all([
    admin.from("machines").select("*").order("code"),
    admin.from("machine_sectors").select("*").order("sort_order").order("name"),
    admin.from("machine_categories").select("*").order("name"),
    admin.from("machine_maintenance_plans").select("*").order("next_due_date", { nullsFirst: false }),
    admin.from("machine_orders").select("*").order("created_at", { ascending: false }).limit(3000),
    createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name").order("name"),
    loadSettings(admin),
  ])
  return {
    machines: rows(machines).map((row) => mapMachine(row, caps)),
    sectors: rows(sectors).map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order, active: row.active })),
    categories: rows(categories).map((row) => ({ id: row.id, name: row.name, codeKind: row.code_kind, illustrationKey: row.illustration_key, active: row.active })),
    plans: rows(plans).map(mapPlan),
    orders: rows(orders).map((row) => mapOrder(row, caps)),
    units: rows(units).map((row) => ({ id: row.id, name: row.trade_name || row.name })),
    settings, caps, serverTime: nowIso(), today: today(),
  }
}

export async function loadDetail(ctx: Ctx, id: string) {
  const { admin, caps } = ctx
  const machine = must(await admin.from("machines").select("*").eq("id", id).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  const [history, readings, orders, docs, plans, locations, qr, settings] = await Promise.all([
    admin.from("machine_status_history").select("*").eq("machine_id", id).order("started_at", { ascending: false }).limit(300),
    admin.from("machine_meter_readings").select("*").eq("machine_id", id).order("read_at", { ascending: false }).limit(60),
    admin.from("machine_orders").select("*").eq("machine_id", id).order("created_at", { ascending: false }).limit(500),
    admin.from("machine_documents").select("*").eq("machine_id", id).order("created_at", { ascending: false }),
    admin.from("machine_maintenance_plans").select("*").eq("machine_id", id).order("name"),
    admin.from("machine_location_history").select("*").eq("machine_id", id).order("moved_at", { ascending: false }).limit(50),
    admin.from("machine_qr_tokens").select("id,active,print_count,last_printed_at,revoked_at,revoked_reason,created_at").eq("machine_id", id).order("created_at", { ascending: false }),
    loadSettings(admin),
  ])
  const orderRows = rows(orders)
  const parts = orderRows.length ? rows(await admin.from("machine_order_parts").select("*").in("order_id", orderRows.map((row) => row.id))) : []
  return {
    machine: mapMachine(machine, caps),
    history: rows(history).map(mapHistory),
    readings: rows(readings).map((row) => ({ id: row.id, reading: Number(row.reading), readAt: row.read_at, isCorrection: row.is_correction, note: row.note || "", readBy: row.read_by || "" })),
    orders: orderRows.map((row) => ({ ...mapOrder(row, caps), parts: parts.filter((part) => part.order_id === row.id).map((part) => ({ id: part.id, materialId: part.material_id || "", description: part.description, quantity: Number(part.quantity), unitCost: caps.patrimony || caps.maintain ? Number(part.unit_cost) : 0, stockStatus: part.stock_status })) })),
    documents: rows(docs).filter((row) => caps.patrimony || !row.restricted).map((row) => ({ id: row.id, docType: row.doc_type, description: row.description || "", restricted: row.restricted, expiryDate: row.expiry_date || "", filePath: row.file_path, fileName: row.file_name || "", createdAt: row.created_at, orderId: row.order_id || "" })),
    plans: rows(plans).map(mapPlan),
    locations: rows(locations).map((row) => ({ id: row.id, sectorId: row.sector_id || "", locationDetail: row.location_detail || "", responsibleName: row.responsible_name || "", movedAt: row.moved_at, movedBy: row.moved_by || "" })),
    qr: caps.maintain ? rows(qr).map((row) => ({ id: row.id, active: row.active, printCount: row.print_count, lastPrintedAt: row.last_printed_at || "", revokedAt: row.revoked_at || "", revokedReason: row.revoked_reason || "", createdAt: row.created_at })) : [],
    settings: { dueSoonDays: (await settings).dueSoonDays, highCostPercent: (await settings).highCostPercent },
    caps, serverTime: nowIso(), today: today(),
  }
}

// ===== Cadastro =====
const newToken = () => randomBytes(24).toString("base64url")

async function insertQrToken(admin: Admin, machineId: string, by: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await admin.from("machine_qr_tokens").insert({ machine_id: machineId, token: newToken(), created_by: by })
    if (!error) return
    if (!/machine_qr_token_uidx/.test(error.message)) throw new Error(error.message)
  }
  throw new MachineError("Não foi possível gerar o QR Code. Tente novamente.", 409)
}

export async function saveMachine(ctx: Ctx, item: Row) {
  const { admin, caps } = ctx
  need(caps.maintain || caps.patrimony, "Sem permissão para cadastrar ou editar máquinas.")
  const message = validateMachine({ ...item, codeKind: item.codeKind }, today())
  if (message) throw new MachineError(message)
  const row = toRow(machineSpecs, item, caps)
  if ("illustrationKey" in item) row.illustration_key = normalizeIllustration(String(item.illustrationKey || ""))
  if (!item.id && !row.depreciation_method) row.depreciation_method = "Linear"

  if (!item.id) {
    const kind = item.codeKind === "EQP" ? "EQP" : "MAQ"
    const code = must(await admin.rpc("machine_next_code", { p_kind: kind })) as unknown as string
    const created = must(await admin.from("machines").insert({ ...row, code, code_kind: kind, created_by: ctx.responsible }).select("*").single())
    await insertQrToken(admin, created.id, ctx.responsible)
    if (created.sector_id || created.location_detail || created.responsible_name) {
      await admin.from("machine_location_history").insert({ machine_id: created.id, sector_id: created.sector_id, location_detail: created.location_detail, responsible_name: created.responsible_name, moved_by: ctx.responsible })
    }
    return mapMachine(created, caps)
  }

  // edição: código, status operacional, horímetro e consolidados nunca mudam por aqui
  const current = must(await admin.from("machines").select("*").eq("id", item.id).maybeSingle())
  if (!current) throw new MachineError("Máquina não encontrada.", 404)
  let query = admin.from("machines").update({ ...row, updated_at: nowIso() }).eq("id", item.id)
  if (item.updatedAt) query = query.eq("updated_at", item.updatedAt)
  const updated = must(await query.select("*").maybeSingle())
  if (!updated) throw new MachineError("Este cadastro foi alterado por outra pessoa. Atualize a tela e tente novamente.", 409)
  const moved = ["sector_id", "location_detail", "responsible_name"].some((key) => (current[key] || null) !== (updated[key] || null))
  if (moved) await admin.from("machine_location_history").insert({ machine_id: updated.id, sector_id: updated.sector_id, location_detail: updated.location_detail, responsible_name: updated.responsible_name, moved_by: ctx.responsible })
  return mapMachine(updated, caps)
}

/** Estado administrativo (Ativo / Inativo / Baixado), separado do status operacional. Códigos de máquinas baixadas nunca são reutilizados. */
export async function setAdminStatus(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor ou administrador altera o estado administrativo.")
  const status = String(item.adminStatus)
  if (!["Ativo", "Inativo", "Baixado"].includes(status)) throw new MachineError("Estado inválido.")
  if (status === "Baixado" && (!item.retiredAt || !String(item.reason || "").trim())) throw new MachineError("Informe a data e o motivo da baixa.")
  const current = must(await ctx.admin.from("machines").select("admin_status,operational_status").eq("id", item.id).maybeSingle())
  if (!current) throw new MachineError("Máquina não encontrada.", 404)
  if (current.admin_status === "Baixado") throw new MachineError("Máquina baixada não pode ser reativada.", 409)
  const update: Row = { admin_status: status, updated_at: nowIso() }
  if (status === "Baixado") Object.assign(update, { retired_at: item.retiredAt, retired_reason: String(item.reason).trim() })
  const updated = must(await ctx.admin.from("machines").update(update).eq("id", item.id).select("*").single())
  return mapMachine(updated, ctx.caps)
}

// ===== Status operacional =====
export async function changeStatus(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor autorizado altera o status da máquina.")
  const to = String(item.toStatus) as MachineStatus
  if (!selectableStatuses.includes(to as never)) throw new MachineError("Status inválido.")
  const reason = String(item.reason || "").trim()
  if (!reason) throw new MachineError("Informe o motivo da alteração.")
  const release = Boolean(item.safetyRelease)
  const machine = must(await ctx.admin.from("machines").select("admin_status,operational_status,safety_locked").eq("id", item.machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  const { count } = await ctx.admin.from("machine_orders").select("id", { count: "exact", head: true }).eq("machine_id", item.machineId).eq("blocks_operation", true).in("status", ["Aberta", "Aguardando aprovacao", "Em execucao", "Aguardando pecas", "Suspensa"])
  const pre = checkStatusChange({ adminStatus: machine.admin_status, current: machine.operational_status, safetyLocked: machine.safety_locked, to, blockingOpenOrders: count || 0, canReleaseSafety: release, reason })
  if (pre) throw new MachineError(pre, 409)
  const updated = must(await ctx.admin.rpc("machine_change_status", {
    p: {
      machine_id: item.machineId, to_status: to, effective_at: item.effectiveAt || "", reason_code: item.reasonCode || "", reason, notes: item.notes || "", responsible: item.responsible || ctx.responsible,
      order_id: item.orderId || "", expected_version: item.expectedVersion ?? "", safety_lock: Boolean(item.safetyLock), safety_release: release, changed_by: ctx.responsible,
    },
  })) as unknown as Row
  return mapMachine(updated, ctx.caps)
}

// ===== Horímetro =====
export async function addMeterReading(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor atualiza o horímetro.")
  const machine = must(await ctx.admin.from("machines").select("id,hour_meter,uses_hour_meter,admin_status").eq("id", item.machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  if (!machine.uses_hour_meter) throw new MachineError("Esta máquina não usa horímetro. Ative o horímetro no cadastro.")
  const reading = Math.round(Number(item.reading) * 10) / 10
  const correction = Boolean(item.isCorrection)
  const message = validateMeterReading(Number(machine.hour_meter), reading, correction, String(item.note || ""))
  if (message) throw new MachineError(message)
  // atualização condicional: se outra pessoa lançou um valor maior no meio tempo, esta leitura é recusada
  let query = ctx.admin.from("machines").update({ hour_meter: reading, hour_meter_at: nowIso(), updated_at: nowIso() }).eq("id", machine.id)
  query = correction ? query.eq("hour_meter", machine.hour_meter) : query.lte("hour_meter", reading)
  const updated = must(await query.select("*").maybeSingle())
  if (!updated) throw new MachineError("O horímetro foi atualizado por outra pessoa. Confira o valor atual e tente de novo.", 409)
  must(await ctx.admin.from("machine_meter_readings").insert({ machine_id: machine.id, reading, is_correction: correction, note: String(item.note || "").trim() || null, read_by: ctx.responsible }).select("id").single())
  return mapMachine(updated, ctx.caps)
}

// ===== Planos preventivos =====
async function planBase(admin: Admin, machineId: string) {
  const machine = must(await admin.from("machines").select("hour_meter,uses_hour_meter").eq("id", machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  return machine
}

export async function savePlan(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor cadastra planos de manutenção.")
  const row = toRow(planSpecs, item, ctx.caps)
  if (!String(row.name || "").trim()) throw new MachineError("Informe o nome do plano.")
  if (!row.interval_days && !row.interval_months && !row.interval_hours && !row.fixed_date) throw new MachineError("Informe ao menos uma regra: dias, meses, horas ou data específica.")
  if (row.interval_hours) {
    const machine = await planBase(ctx.admin, item.machineId)
    if (!machine.uses_hour_meter) throw new MachineError("Plano por horas exige que a máquina use horímetro.")
  }
  row.checklist = Array.isArray(item.checklist) ? item.checklist.map((entry: any) => String(entry).trim()).filter(Boolean) : []
  const lastDate = item.lastDoneDate ? String(item.lastDoneDate) : null
  if (lastDate && lastDate > today()) throw new MachineError("A data da última execução não pode estar no futuro.")
  const machine = await planBase(ctx.admin, item.machineId)
  const lastHours = item.lastDoneHours === "" || item.lastDoneHours == null ? null : Number(item.lastDoneHours)
  const due = computeNextDue({ intervalDays: row.interval_days, intervalMonths: row.interval_months, intervalHours: row.interval_hours, fixedDate: row.fixed_date, combineRule: row.combine_rule, lastDoneDate: lastDate, lastDoneHours: lastHours, baseDate: today(), baseHours: Number(machine.hour_meter || 0) })
  const payload = { ...row, last_done_date: lastDate, last_done_hours: lastHours, next_due_date: due.dueDate || null, next_due_hours: due.dueHours, updated_at: nowIso() }
  const saved = item.id
    ? must(await ctx.admin.from("machine_maintenance_plans").update(payload).eq("id", item.id).select("*").maybeSingle())
    : must(await ctx.admin.from("machine_maintenance_plans").insert({ ...payload, machine_id: item.machineId, created_by: ctx.responsible }).select("*").single())
  if (!saved) throw new MachineError("Plano não encontrado.", 404)
  return mapPlan(saved)
}

export async function deletePlan(ctx: Ctx, id: string) {
  need(ctx.caps.maintain, "Somente o manutentor exclui planos.")
  must(await ctx.admin.from("machine_maintenance_plans").update({ active: false, updated_at: nowIso() }).eq("id", id).select("id").maybeSingle())
  return { ok: true }
}

// ===== Ordens, ocorrências e histórico =====
type PartInput = { materialId?: string; description?: string; quantity?: number; unitCost?: number }
const readParts = (value: unknown): PartInput[] => (Array.isArray(value) ? value : []).map((part: any) => ({ materialId: String(part.materialId || ""), description: String(part.description || "").trim(), quantity: Number(part.quantity) || 0, unitCost: Number(part.unitCost) || 0 })).filter((part) => part.quantity > 0 && (part.description || part.materialId))

const partsTotal = (parts: Array<{ quantity?: number; unitCost?: number }>) => fromCents(parts.reduce((total, part) => total + Math.round((part.quantity || 0) * (part.unitCost || 0) * 100), 0))

async function materialNames(admin: Admin, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; cost: number }>()
  const data = rows(await admin.from("materials").select("id,name,average_cost,cost_price").in("id", ids))
  return new Map(data.map((row) => [row.id as string, { name: String(row.name), cost: Number(row.average_cost || row.cost_price || 0) }]))
}

/** Recalcula último serviço e custo acumulado da máquina a partir de TODAS as ordens válidas (idempotente). */
export async function refreshConsolidated(admin: Admin, machineId: string) {
  const data = rows(await admin.from("machine_orders").select("status,origin,maintenance_type,performed_at,completed_at,created_at,labor_cost,parts_cost,other_cost").eq("machine_id", machineId))
  const list = data.map((row) => ({ status: row.status, origin: row.origin, maintenanceType: row.maintenance_type, performedAt: row.performed_at, completedAt: row.completed_at, createdAt: row.created_at, laborCost: Number(row.labor_cost), partsCost: Number(row.parts_cost), otherCost: Number(row.other_cost) }))
  const last = lastMaintenanceDate(list)
  await admin.from("machines").update({ last_maintenance_at: last || null, total_maintenance_cost: totalMaintenanceCost(list), updated_at: nowIso() }).eq("id", machineId)
}

export async function saveOrder(ctx: Ctx, item: Row) {
  const { admin, caps } = ctx
  const origin = String(item.origin || "Ordem")
  if (!["Ordem", "Ocorrencia", "Historico"].includes(origin)) throw new MachineError("Tipo de lançamento inválido.")
  // qualquer usuário do módulo pode reportar problema; o restante é do manutentor
  need(origin === "Ocorrencia" || caps.maintain, "Somente o manutentor lança ordens e manutenções.")
  const machine = must(await admin.from("machines").select("id,admin_status,operational_status").eq("id", item.machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)

  if (origin === "Ocorrencia") {
    const description = String(item.description || item.problem || "").trim()
    if (!description) throw new MachineError("Descreva o problema.")
    const created = must(await admin.from("machine_orders").insert({
      machine_id: machine.id, origin, maintenance_type: "Corretiva", priority: ["Baixa", "Media", "Alta", "Urgente"].includes(String(item.priority)) ? item.priority : "Media", status: "Aberta",
      description, problem: description, responsible: ctx.responsible, created_by: ctx.responsible,
    }).select("*").single())
    return mapOrder(created, caps)
  }

  const message = validateOrder({ ...item, origin }, today())
  if (message) throw new MachineError(message)
  const row = toRow(orderSpecs, item, caps)
  const parts = readParts(item.parts)
  const names = await materialNames(admin, parts.map((part) => part.materialId!).filter(Boolean))
  const resolved = parts.map((part) => ({ ...part, description: part.description || names.get(part.materialId!)?.name || "Material", unitCost: part.unitCost || names.get(part.materialId!)?.cost || 0 }))
  const partsCost = partsTotal(resolved)

  if (item.id) {
    const current = must(await admin.from("machine_orders").select("*").eq("id", item.id).maybeSingle())
    if (!current) throw new MachineError("Ordem não encontrada.", 404)
    if (["Concluida", "Cancelada"].includes(current.status)) throw new MachineError("Ordem concluída ou cancelada não pode ser editada.", 409)
    const posted = rows(await admin.from("machine_order_parts").select("id").eq("order_id", current.id).in("stock_status", ["baixado", "postando"]))
    if (posted.length) throw new MachineError("Há peças já baixadas do estoque nesta ordem; não é possível alterar a lista de peças.", 409)
    let query = admin.from("machine_orders").update({ ...row, parts_cost: partsCost, updated_at: nowIso() }).eq("id", current.id).eq("status", current.status)
    if (item.updatedAt) query = query.eq("updated_at", item.updatedAt)
    const updated = must(await query.select("*").maybeSingle())
    if (!updated) throw new MachineError("Esta ordem foi alterada por outra pessoa. Atualize a tela.", 409)
    await admin.from("machine_order_parts").delete().eq("order_id", current.id)
    if (resolved.length) must(await admin.from("machine_order_parts").insert(resolved.map((part) => ({ order_id: current.id, material_id: part.materialId || null, description: part.description, quantity: part.quantity, unit_cost: part.unitCost }))).select("id"))
    return mapOrder(updated, caps)
  }

  const historic = origin === "Historico"
  // histórico anterior: nenhuma baixa de estoque ou lançamento financeiro retroativo sem autorização explícita (somente administrador)
  const postStock = historic && Boolean(item.postStock) && caps.admin
  const orderNumber = historic ? null : (must(await admin.rpc("machine_next_order_number")) as unknown as string)
  const created = must(await admin.from("machine_orders").insert({
    ...row, machine_id: machine.id, origin, order_number: orderNumber, parts_cost: partsCost, created_by: ctx.responsible,
    status: historic ? "Concluida" : row.requires_approval ? "Aguardando aprovacao" : "Aberta",
    completed_at: historic ? `${row.performed_at}T12:00:00-03:00` : null, performed_at: historic ? row.performed_at : null,
    validated_by: historic ? ctx.responsible : null, validated_at: historic ? nowIso() : null,
    maintenance_type: ["Preventiva", "Corretiva", "Preditiva", "Inspecao"].includes(String(row.maintenance_type)) ? row.maintenance_type : "Corretiva",
    priority: ["Baixa", "Media", "Alta", "Urgente"].includes(String(row.priority)) ? row.priority : "Media",
    checklist: Array.isArray(item.checklist) ? item.checklist.map((entry: any) => ({ text: String(entry.text ?? entry).trim(), done: Boolean(entry.done) })).filter((entry: any) => entry.text) : [],
  }).select("*").single())
  if (resolved.length) must(await admin.from("machine_order_parts").insert(resolved.map((part) => ({ order_id: created.id, material_id: part.materialId || null, description: part.description, quantity: part.quantity, unit_cost: part.unitCost, stock_status: historic && !postStock ? "sem_baixa" : "pendente" }))).select("id"))
  if (item.fromOccurrenceId && !historic) {
    // a ocorrência vira ordem: fica registrada como atendida (não conta como manutenção concluída)
    await admin.from("machine_orders").update({ status: "Concluida", completed_at: nowIso(), notes: `Convertida na ${created.order_number}`, updated_at: nowIso() }).eq("id", item.fromOccurrenceId).eq("origin", "Ocorrencia").eq("status", "Aberta")
  }
  if (historic) {
    await refreshConsolidated(admin, machine.id)
    if (postStock) await postOrderStock(ctx, created.id, created.order_number || `HIST-${created.id.slice(0, 8)}`)
  }
  return mapOrder(created, caps)
}

/** Baixa de estoque idempotente: cada peça é "reivindicada" (pendente -> postando) antes do movimento e só vira "baixado" com o id da movimentação. */
async function postOrderStock(ctx: Ctx, orderId: string, reference: string) {
  const pending = rows(await ctx.admin.from("machine_order_parts").select("*").eq("order_id", orderId).eq("stock_status", "pendente").not("material_id", "is", null))
  for (const part of pending) {
    const claimed = must(await ctx.admin.from("machine_order_parts").update({ stock_status: "postando" }).eq("id", part.id).eq("stock_status", "pendente").select("id").maybeSingle())
    if (!claimed) continue // outra requisição já está baixando esta peça
    try {
      const movement = await applyStockMovement(ctx.admin, { materialId: part.material_id, movementType: "Consumo em OS", quantity: Number(part.quantity), unitCost: Number(part.unit_cost) || null, responsible: ctx.responsible, documentReference: reference, reason: `Manutenção de máquina ${reference}` })
      await ctx.admin.from("machine_order_parts").update({ stock_status: "baixado", stock_movement_id: movement.id }).eq("id", part.id)
    } catch (error) {
      await ctx.admin.from("machine_order_parts").update({ stock_status: "pendente" }).eq("id", part.id)
      throw new MachineError(`Estoque: ${error instanceof Error ? error.message : "falha na baixa"}. A ordem não foi concluída; corrija e tente novamente (peças já baixadas não são baixadas de novo).`, 409)
    }
  }
}

const transitions: Record<string, string[]> = {
  Aberta: ["Em execucao", "Aguardando aprovacao", "Aguardando pecas", "Suspensa", "Cancelada", "Concluida"],
  "Aguardando aprovacao": ["Aberta", "Cancelada"],
  "Em execucao": ["Aguardando pecas", "Suspensa", "Cancelada", "Concluida"],
  "Aguardando pecas": ["Em execucao", "Suspensa", "Cancelada"],
  Suspensa: ["Aberta", "Em execucao", "Cancelada"],
}

export async function orderAction(ctx: Ctx, item: Row) {
  const { admin, caps } = ctx
  need(caps.maintain, "Somente o manutentor altera ordens de manutenção.")
  const order = must(await admin.from("machine_orders").select("*").eq("id", item.id).maybeSingle())
  if (!order) throw new MachineError("Ordem não encontrada.", 404)
  const to = String(item.toStatus)
  const allowed = transitions[order.status] || []
  if (!allowed.includes(to)) throw new MachineError(`Ordem ${order.status.toLowerCase()}: não é possível mudar para ${to}.`, 409)
  if (order.status === "Aguardando aprovacao" && to === "Aberta") {
    need(caps.admin || caps.patrimony, "A aprovação é do administrador ou de quem tem permissão patrimonial.")
  }
  if (order.requires_approval && !order.approved_at && to !== "Cancelada" && to !== "Aberta" && order.status !== "Aguardando aprovacao") {
    throw new MachineError("Esta ordem exige aprovação antes de iniciar.", 409)
  }
  if (to === "Cancelada" && !String(item.reason || "").trim()) throw new MachineError("Informe o motivo do cancelamento.")

  const update: Row = { status: to, updated_at: nowIso() }
  if (order.status === "Aguardando aprovacao" && to === "Aberta") Object.assign(update, { approved_by: ctx.responsible, approved_at: nowIso() })
  if (to === "Em execucao" && !order.started_at) update.started_at = nowIso()
  if (to === "Cancelada") update.notes = [order.notes, `Cancelada: ${String(item.reason).trim()}`].filter(Boolean).join("\n")

  if (to === "Concluida") {
    if (order.origin === "Ocorrencia") throw new MachineError("Ocorrência não é concluída diretamente: abra uma ordem de manutenção a partir dela.", 409)
    const done = String(item.performedAt || today())
    if (done > today()) throw new MachineError("A data de conclusão não pode estar no futuro.")
    if (!String(item.solution || order.solution || "").trim()) throw new MachineError("Informe a solução aplicada para concluir.")
    const checklist: Array<{ text: string; done: boolean }> = Array.isArray(item.checklist) ? item.checklist : Array.isArray(order.checklist) ? order.checklist : []
    if (checklist.some((entry) => typeof entry === "object" && entry && !entry.done) && !item.forceChecklist) throw new MachineError("Há itens do checklist sem conclusão. Marque todos ou confirme a conclusão mesmo assim.", 409)
    await postOrderStock(ctx, order.id, order.order_number || order.id.slice(0, 8))
    const totalParts = rows(await admin.from("machine_order_parts").select("quantity,unit_cost").eq("order_id", order.id)).map((part) => ({ quantity: Number(part.quantity), unitCost: Number(part.unit_cost) }))
    Object.assign(update, {
      performed_at: done, completed_at: nowIso(), solution: String(item.solution || order.solution || "").trim(), validated_by: ctx.responsible, validated_at: nowIso(), parts_cost: partsTotal(totalParts),
      checklist, labor_hours: item.laborHours != null ? Number(item.laborHours) || 0 : order.labor_hours, labor_cost: item.laborCost != null ? Number(item.laborCost) || 0 : order.labor_cost,
      other_cost: item.otherCost != null ? Number(item.otherCost) || 0 : order.other_cost, downtime_hours: item.downtimeHours != null ? Number(item.downtimeHours) || 0 : order.downtime_hours,
    })
  }
  // transição condicional: se outra pessoa mudou a ordem entre a leitura e a gravação, nada é gravado
  const saved = must(await admin.from("machine_orders").update(update).eq("id", order.id).eq("status", order.status).select("*").maybeSingle())
  if (!saved) throw new MachineError("A ordem foi alterada por outra pessoa. Atualize a tela e confira o status.", 409)

  let releaseSuggested = false
  if (to === "Concluida") {
    await refreshConsolidated(admin, order.machine_id)
    const machine = must(await admin.from("machines").select("hour_meter,operational_status").eq("id", order.machine_id).single())
    if (order.plan_id) await closePlanCycle(admin, order.plan_id, update.performed_at, Number(machine.hour_meter || 0))
    // não coloca em operação sozinho: apenas indica que a liberação precisa ser confirmada por quem tem autorização
    releaseSuggested = machine.operational_status === "Em manutencao"
  }
  return { order: mapOrder(saved, caps), releaseSuggested }
}

async function closePlanCycle(admin: Admin, planId: string, doneDate: string, hours: number) {
  const plan = must(await admin.from("machine_maintenance_plans").select("*").eq("id", planId).maybeSingle())
  if (!plan) return
  const due = computeNextDue({ intervalDays: plan.interval_days, intervalMonths: plan.interval_months, intervalHours: plan.interval_hours == null ? null : Number(plan.interval_hours), fixedDate: plan.fixed_date, combineRule: plan.combine_rule, lastDoneDate: doneDate, lastDoneHours: hours })
  await admin.from("machine_maintenance_plans").update({ last_done_date: doneDate, last_done_hours: hours, next_due_date: due.dueDate || null, next_due_hours: due.dueHours, updated_at: nowIso() }).eq("id", planId)
}

/** Abre ordem a partir de um plano (manual ou automática). O índice único impede duas ordens abertas do mesmo plano. */
export async function createOrderFromPlan(admin: Admin, planId: string, by: string) {
  const plan = must(await admin.from("machine_maintenance_plans").select("*").eq("id", planId).maybeSingle())
  if (!plan || !plan.active) throw new MachineError("Plano não encontrado ou inativo.", 404)
  const open = must(await admin.from("machine_orders").select("id,order_number").eq("plan_id", planId).not("status", "in", "(Concluida,Cancelada)").maybeSingle())
  if (open) throw new MachineError(`Já existe a ordem ${open.order_number} em aberto para este plano.`, 409)
  const number = must(await admin.rpc("machine_next_order_number")) as unknown as string
  const created = must(await admin.from("machine_orders").insert({
    machine_id: plan.machine_id, plan_id: plan.id, origin: "Ordem", order_number: number, maintenance_type: plan.maintenance_type === "Inspecao" ? "Inspecao" : plan.maintenance_type, priority: "Media", status: "Aberta",
    description: plan.name + (plan.description ? ` — ${plan.description}` : ""), due_date: plan.next_due_date, blocks_operation: plan.blocks_operation, created_by: by,
    checklist: (Array.isArray(plan.checklist) ? plan.checklist : []).map((text: string) => ({ text, done: false })),
  }).select("*").single())
  return created
}

export async function orderFromPlan(ctx: Ctx, planId: string) {
  need(ctx.caps.maintain, "Somente o manutentor abre ordens.")
  return mapOrder(await createOrderFromPlan(ctx.admin, planId, ctx.responsible), ctx.caps)
}

/** Agendador: abre ordens dos planos automáticos vencidos (ou perto de vencer) que ainda não têm ordem aberta. */
export async function generateDueOrders(admin: Admin, by = "Agendador") {
  const settings = await loadSettings(admin)
  const limit = new Date(Date.now() + settings.dueSoonDays * 86400000).toISOString().slice(0, 10)
  const plans = rows(await admin.from("machine_maintenance_plans").select("id,machine_id,next_due_date,next_due_hours,auto_create_order").eq("active", true).eq("auto_create_order", true))
  const machines = new Map(rows(await admin.from("machines").select("id,hour_meter,admin_status")).map((row) => [row.id as string, row]))
  let created = 0
  let skipped = 0
  for (const plan of plans) {
    const machine = machines.get(plan.machine_id)
    if (!machine || machine.admin_status !== "Ativo") continue
    const dueByDate = plan.next_due_date && plan.next_due_date <= limit
    const dueByHours = plan.next_due_hours != null && Number(machine.hour_meter) >= Number(plan.next_due_hours) - 20
    if (!dueByDate && !dueByHours) continue
    try {
      await createOrderFromPlan(admin, plan.id, by)
      created += 1
    } catch (error) {
      if (error instanceof MachineError && error.status === 409) skipped += 1
      else if (/machine_orders_open_plan_uidx/.test(error instanceof Error ? error.message : "")) skipped += 1
      else throw error
    }
  }
  return { created, skipped }
}

// ===== QR Code =====
export async function baseUrlFor(admin: Admin, requestOrigin: string) {
  const settings = await loadSettings(admin)
  return (settings.qrBaseUrl || process.env.NEXT_PUBLIC_APP_URL || requestOrigin).replace(/\/+$/, "")
}

export async function qrInfo(ctx: Ctx, machineId: string, origin: string) {
  need(ctx.caps.maintain, "Somente o manutentor gera etiquetas.")
  const machine = must(await ctx.admin.from("machines").select("id,code,name").eq("id", machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  let token = must(await ctx.admin.from("machine_qr_tokens").select("*").eq("machine_id", machineId).eq("active", true).maybeSingle())
  if (!token) {
    await insertQrToken(ctx.admin, machineId, ctx.responsible)
    token = must(await ctx.admin.from("machine_qr_tokens").select("*").eq("machine_id", machineId).eq("active", true).single())
  }
  return { code: machine.code, name: machine.name, url: buildQrUrl(await baseUrlFor(ctx.admin, origin), token.token), printCount: token.print_count }
}

export async function qrMarkPrinted(ctx: Ctx, machineId: string) {
  need(ctx.caps.maintain, "Somente o manutentor gera etiquetas.")
  const token = must(await ctx.admin.from("machine_qr_tokens").select("id,print_count").eq("machine_id", machineId).eq("active", true).maybeSingle())
  if (token) await ctx.admin.from("machine_qr_tokens").update({ print_count: Number(token.print_count) + 1, last_printed_at: nowIso() }).eq("id", token.id)
  return { ok: true }
}

/** Revoga o QR atual e emite um novo; o código patrimonial não muda. */
export async function qrReissue(ctx: Ctx, machineId: string, reason: string) {
  need(ctx.caps.maintain, "Somente o manutentor reemite o QR Code.")
  if (!reason.trim()) throw new MachineError("Informe o motivo da revogação.")
  const revoked = must(await ctx.admin.from("machine_qr_tokens").update({ active: false, revoked_at: nowIso(), revoked_by: ctx.responsible, revoked_reason: reason.trim() }).eq("machine_id", machineId).eq("active", true).select("id").maybeSingle())
  await insertQrToken(ctx.admin, machineId, ctx.responsible)
  await audit({ module: "maquinas", action: "Alteração de configuração", description: `QR Code da máquina ${machineId} revogado e reemitido.`, tableName: "machine_qr_tokens", recordId: machineId, reason: reason.trim() })
  return { ok: true, revoked: Boolean(revoked) }
}

/** Resolve o QR lido no celular. Exige login (sessão existente) e a mesma empresa; token revogado não abre. */
export async function qrResolve(ctx: Ctx, token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw new MachineError("QR Code inválido.", 404)
  const found = must(await ctx.admin.from("machine_qr_tokens").select("machine_id,active,revoked_at").eq("token", token).maybeSingle())
  if (!found) throw new MachineError("QR Code não reconhecido nesta empresa. Confira se você está na empresa correta.", 404)
  if (!found.active) throw new MachineError("Este QR Code foi revogado. Peça ao manutentor a etiqueta nova.", 410)
  return { machineId: found.machine_id as string }
}

// ===== Setores e categorias =====
export async function saveSector(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor altera setores.")
  const name = String(item.name || "").trim()
  if (!name) throw new MachineError("Informe o nome do setor.")
  const row = { name, sort_order: Math.trunc(Number(item.sortOrder) || 0), active: item.active !== false, updated_at: nowIso() }
  return item.id ? must(await ctx.admin.from("machine_sectors").update(row).eq("id", item.id).select("*").maybeSingle()) : must(await ctx.admin.from("machine_sectors").insert(row).select("*").single())
}

export async function saveCategory(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain, "Somente o manutentor altera categorias.")
  const name = String(item.name || "").trim()
  if (!name) throw new MachineError("Informe o nome da categoria.")
  const row = { name, code_kind: item.codeKind === "EQP" ? "EQP" : "MAQ", illustration_key: normalizeIllustration(String(item.illustrationKey || "")), active: item.active !== false, updated_at: nowIso() }
  return item.id ? must(await ctx.admin.from("machine_categories").update(row).eq("id", item.id).select("*").maybeSingle()) : must(await ctx.admin.from("machine_categories").insert(row).select("*").single())
}

/** Cria categorias com base na biblioteca de ilustrações (só quando o manutentor pede; são cadastros de apoio, não dados de operação). */
export async function seedCategories(ctx: Ctx) {
  need(ctx.caps.maintain, "Somente o manutentor altera categorias.")
  const existing = new Set(rows(await ctx.admin.from("machine_categories").select("name")).map((row) => String(row.name).toLowerCase()))
  const toCreate = illustrationLibrary.filter((item) => item.key !== "generica" && !existing.has(item.label.toLowerCase()))
  if (toCreate.length) must(await ctx.admin.from("machine_categories").insert(toCreate.map((item) => ({ name: item.label, code_kind: "MAQ", illustration_key: item.key }))).select("id"))
  return { created: toCreate.length }
}

// ===== Documentos e arquivos =====
const safeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"

export async function uploadFile(ctx: Ctx, form: FormData) {
  need(ctx.caps.maintain || ctx.caps.patrimony, "Sem permissão para enviar arquivos.")
  const file = form.get("file")
  const machineId = String(form.get("machineId") || "")
  if (!(file instanceof File)) throw new MachineError("Selecione um arquivo.")
  const check = validateMachineFile(file.type, file.size)
  if (!check.ok) throw new MachineError(check.error!)
  if (!/^[0-9a-f-]{36}$/i.test(machineId)) throw new MachineError("Máquina inválida.")
  const machine = must(await ctx.admin.from("machines").select("id,system_company_id").eq("id", machineId).maybeSingle())
  if (!machine) throw new MachineError("Máquina não encontrada.", 404)
  const path = `${machine.system_company_id}/${machineId}/${Date.now()}-${safeName(file.name)}`
  const { error } = await ctx.admin.storage.from(MACHINE_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) throw new MachineError(/bucket/i.test(error.message) ? MACHINES_MIGRATION_HINT : error.message)
  return { path, name: file.name }
}

export async function saveDocument(ctx: Ctx, item: Row) {
  need(ctx.caps.maintain || ctx.caps.patrimony, "Sem permissão para anexar documentos.")
  if (!item.filePath || !String(item.filePath).includes(`/${item.machineId}/`)) throw new MachineError("Arquivo inválido para esta máquina.")
  const saved = must(await ctx.admin.from("machine_documents").insert({ machine_id: item.machineId, order_id: item.orderId || null, doc_type: String(item.docType || "Outro"), description: String(item.description || "").trim() || null, restricted: Boolean(item.restricted) || ["Nota fiscal", "Garantia"].includes(String(item.docType)), expiry_date: item.expiryDate || null, file_path: item.filePath, file_name: item.fileName || null, created_by: ctx.responsible }).select("*").single())
  return { id: saved.id }
}

export async function deleteDocument(ctx: Ctx, id: string) {
  need(ctx.caps.maintain || ctx.caps.patrimony, "Sem permissão para excluir documentos.")
  const doc = must(await ctx.admin.from("machine_documents").select("id,file_path").eq("id", id).maybeSingle())
  if (!doc) throw new MachineError("Documento não encontrado.", 404)
  await ctx.admin.from("machine_documents").delete().eq("id", id)
  await ctx.admin.storage.from(MACHINE_BUCKET).remove([doc.file_path])
  return { ok: true }
}

/** URL assinada de curta duração. Só abre arquivo que pertence a um documento ou foto de máquina DESTA empresa; documento restrito exige permissão patrimonial. */
export async function signedFileUrl(ctx: Ctx, path: string) {
  if (!path || path.includes("..")) throw new MachineError("Arquivo inválido.")
  const doc = must(await ctx.admin.from("machine_documents").select("restricted").eq("file_path", path).maybeSingle())
  if (doc) {
    if (doc.restricted && !ctx.caps.patrimony) throw new MachineError("Documento restrito.", 403)
  } else {
    const photo = must(await ctx.admin.from("machines").select("id").eq("photo_path", path).maybeSingle())
    if (!photo) throw new MachineError("Arquivo não encontrado.", 404)
  }
  const { data, error } = await ctx.admin.storage.from(MACHINE_BUCKET).createSignedUrl(path, 300)
  if (error || !data) throw new MachineError("Arquivo não encontrado.", 404)
  return data.signedUrl
}

export async function searchMaterials(ctx: Ctx, query: string) {
  need(ctx.caps.maintain, "Somente o manutentor consulta o estoque.")
  let request = ctx.admin.from("materials").select("id,name,internal_code,unit,average_cost,cost_price,current_stock,reserved_stock,status").neq("status", "Inativo").order("name").limit(40)
  const term = query.trim().replace(/[%,()]/g, " ")
  if (term) request = request.or(`name.ilike.%${term}%,internal_code.ilike.%${term}%`)
  return rows(await request).map((row) => ({ id: row.id, name: row.name, code: row.internal_code || "", unit: row.unit || "", cost: Number(row.average_cost || row.cost_price || 0), available: Number(row.current_stock || 0) - Number(row.reserved_stock || 0) }))
}

export async function searchSuppliers(ctx: Ctx) {
  need(ctx.caps.patrimony || ctx.caps.maintain, "Sem permissão.")
  return rows(await ctx.admin.from("suppliers").select("id,name").order("name").limit(500)).map((row) => ({ id: row.id, name: row.name }))
}

/** Histórico de status de todas as máquinas no período (para indisponibilidade e frequência de paradas). */
export async function loadStatusHistory(ctx: Ctx, start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new MachineError("Período inválido.")
  const data = rows(await ctx.admin.from("machine_status_history").select("machine_id,to_status,started_at,ended_at,reason_code,reason").lte("started_at", `${end}T23:59:59-03:00`).or(`ended_at.is.null,ended_at.gte.${start}T00:00:00-03:00`).order("started_at").limit(20000))
  return data.map((row) => ({ machineId: row.machine_id, toStatus: row.to_status, startedAt: row.started_at, endedAt: row.ended_at || "", reasonCode: row.reason_code || "", reason: row.reason || "" }))
}
