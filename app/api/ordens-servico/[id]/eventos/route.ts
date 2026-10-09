import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { createAdminClient, createAdminClientForServiceOrder } from "@/lib/supabase/server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { ensureReceivableForFinishedOrder, serviceOrderReceivableId } from "@/lib/service-order-receivables"
import { syncStockOrdersForServiceOrder } from "@/lib/stock-order-service-sync"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

function isUuid(value?: string | null) {
  return Boolean(value && uuidPattern.test(value))
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`operational:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string | null) {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(value)
}

function nullableUuid(value?: string | null) {
  return value ? normalizeId(value) : null
}

function selectionFromNotes(notes?: string | null) {
  const line = String(notes || "").split("\n").find((item) => item.startsWith("Selecoes OS JSON:"))
  if (!line) return { clientEquipmentIds: [] as string[], clientEnvironmentIds: [] as string[] }
  try {
    const parsed = JSON.parse(line.replace("Selecoes OS JSON:", "").trim())
    return {
      clientEquipmentIds: Array.isArray(parsed.clientEquipmentIds) ? parsed.clientEquipmentIds.filter(isUuid) : [],
      clientEnvironmentIds: Array.isArray(parsed.clientEnvironmentIds) ? parsed.clientEnvironmentIds.filter(isUuid) : [],
    }
  } catch {
    return { clientEquipmentIds: [] as string[], clientEnvironmentIds: [] as string[] }
  }
}

async function requiredPhotoScopes(supabase: ReturnType<typeof createAdminClient>, order: any) {
  if (order.order_type === "obra") return [""]
  const selection = selectionFromNotes(order.notes)
  const equipmentIds = new Set<string>(selection.clientEquipmentIds)
  if (isUuid(order.client_equipment_id)) equipmentIds.add(order.client_equipment_id)

  if (order.order_type === "pmoc") {
    const { data: schedules, error: scheduleError } = await supabase
      .from("pmoc_schedules")
      .select("pmoc_equipment_id")
      .eq("service_order_id", order.id)
    if (scheduleError) throw scheduleError
    const pmocEquipmentIds = (schedules || []).map((item) => item.pmoc_equipment_id).filter(isUuid)
    if (pmocEquipmentIds.length) {
      const { data: equipment, error: equipmentError } = await supabase
        .from("pmoc_equipment")
        .select("client_equipment_id")
        .in("id", pmocEquipmentIds)
      if (equipmentError) throw equipmentError
      for (const item of equipment || []) {
        if (isUuid(item.client_equipment_id)) equipmentIds.add(item.client_equipment_id)
      }
    }
  }

  if (equipmentIds.size) return [...equipmentIds]
  const environmentIds = new Set<string>(selection.clientEnvironmentIds)
  if (isUuid(order.client_environment_id)) environmentIds.add(order.client_environment_id)
  return environmentIds.size ? [...environmentIds] : [""]
}

async function validateFinalization(supabase: ReturnType<typeof createAdminClient>, order: any, notes: string) {
  if (!notes.trim()) throw new RequestError("Informe a observacao do evento antes de finalizar o servico.", 400)
  const scopes = await requiredPhotoScopes(supabase, order)
  const { data: files, error } = await supabase
    .from("service_order_files")
    .select("category,notes")
    .eq("service_order_id", order.id)
    .in("category", ["Foto Inicial", "Foto Final"])
  if (error) throw error

  const missing = scopes.flatMap((scope) => (["Foto Inicial", "Foto Final"] as const)
    .filter((category) => !(files || []).some((file) => file.category === category && String(file.notes || "") === (scope ? `equipment:${scope}` : "")))
    .map((category) => scope ? `${category} do equipamento/ambiente ${scope}` : category))
  if (missing.length) throw new RequestError(`Envie as fotos obrigatorias antes de finalizar: ${missing.join(", ")}.`, 400)
}

async function removeOpenGeneratedReceivable(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { error } = await supabase
    .from("accounts_receivable")
    .delete()
    .eq("id", serviceOrderReceivableId(orderId))
    .eq("status", "Aberta")
    .eq("origin", "OS")
  if (error) console.error("[OS receivable cleanup]", error.message)
}

function toEvent(row: any) {
  return {
    id: row.id,
    serviceOrderId: row.service_order_id,
    stepName: row.step_name,
    status: row.status,
    providerId: row.provider_id || "",
    eventDatetime: row.event_datetime,
    latitude: row.latitude ? String(row.latitude) : "",
    longitude: row.longitude ? String(row.longitude) : "",
    notes: row.notes || "",
    fileId: row.file_id || "",
    createdAt: row.created_at,
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params
    const id = normalizeId(rawId)
    const supabase = (await createAdminClientForServiceOrder(id)).client
    const { data: events, error } = await supabase
      .from("service_order_events")
      .select("*")
      .eq("service_order_id", id)
      .order("event_datetime", { ascending: false })
    if (error) throw new Error(error.message)

    const { data: order, error: orderError } = await supabase
      .from("service_orders")
      .select("id,status,updated_at,finished_at")
      .eq("id", id)
      .maybeSingle()
    if (orderError) throw new Error(orderError.message)

    return NextResponse.json({ events: (events || []).map(toEvent), order })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar eventos" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params
    const id = normalizeId(rawId)
    const body = await request.json()
    const event = body.event || {}
    const status = body.status || event.status
    const finishedAt = body.finishedAt || null
    const allowUpsert = Boolean(body.upsert)

    if (!id) throw new RequestError("OS invalida.", 400)
    if (!event.id) throw new RequestError("Evento sem ID valido.", 400)
    if (!event.stepName) throw new RequestError("Etapa obrigatoria.", 400)

    const supabase = (await createAdminClientForServiceOrder(id)).client
    const { data: orderExists, error: orderLookupError } = await supabase
      .from("service_orders")
      .select("id,order_type,point_id,client_equipment_id,client_environment_id,notes")
      .eq("id", id)
      .maybeSingle()
    if (orderLookupError) throw new Error(orderLookupError.message)
    if (!orderExists?.id) throw new RequestError("OS nao encontrada no banco de dados.", 404)

    if (status === "Finalizada" || finishedAt) {
      await validateFinalization(supabase, orderExists, String(event.notes || ""))
    }

    const { data: existing, error: existingError } = await supabase
      .from("service_order_events")
      .select("id")
      .eq("service_order_id", id)
      .eq("step_name", event.stepName)
      .maybeSingle()
    if (existingError) throw new Error(existingError.message)
    const row = {
      id: existing?.id || normalizeId(event.id),
      service_order_id: id,
      step_name: event.stepName,
      status,
      provider_id: nullableUuid(event.providerId),
      event_datetime: event.eventDatetime || new Date().toISOString(),
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      notes: event.notes || "",
      file_id: nullableUuid(event.fileId),
    }

    if (existing?.id && !allowUpsert) throw new RequestError("Esta etapa ja foi registrada para esta OS.", 409)

    const { data: saved, error } = existing?.id
      ? await supabase.from("service_order_events").update(row).eq("id", existing.id).select("*").single()
      : await supabase.from("service_order_events").insert(row).select("*").single()
    if (error) throw new Error(error.message)

    const orderUpdate: Record<string, any> = { status, updated_at: new Date().toISOString() }
    if (finishedAt) orderUpdate.finished_at = finishedAt
    const { error: orderError } = await supabase.from("service_orders").update(orderUpdate).eq("id", id)
    if (orderError) throw new Error(orderError.message)
    if (status === "Finalizada" || finishedAt) await ensureReceivableForFinishedOrder(supabase, id)
    await syncStockOrdersForServiceOrder(supabase, { ...orderExists, status })

    return NextResponse.json({ event: toEvent(saved), order: { id, ...orderUpdate } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao registrar evento" }, { status: error instanceof RequestError ? error.status : 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Somente administradores podem resetar ou excluir registros." }, { status: 403 })
    const { id: rawId } = await params
    const id = normalizeId(rawId)
    const body = await request.json().catch(() => ({}))
    const resetStatus = body.status || "Agendada"

    if (!id) throw new Error("OS invalida.")

    const supabase = (await createAdminClientForServiceOrder(id)).client
    const { data: orderExists, error: orderLookupError } = await supabase
      .from("service_orders")
      .select("id,order_type,point_id,notes")
      .eq("id", id)
      .maybeSingle()
    if (orderLookupError) throw new Error(orderLookupError.message)
    if (!orderExists?.id) throw new Error("OS nao encontrada no banco de dados.")

    const { error: deleteError } = await supabase
      .from("service_order_events")
      .delete()
      .eq("service_order_id", id)
    if (deleteError) throw new Error(deleteError.message)

    const orderUpdate = {
      status: resetStatus,
      updated_at: new Date().toISOString(),
      finished_at: null,
      cancelled_at: null,
      pause_reason: "",
      cancellation_reason: "",
      partial_reason: "",
    }
    const { error: orderError } = await supabase.from("service_orders").update(orderUpdate).eq("id", id)
    if (orderError) throw new Error(orderError.message)
    await removeOpenGeneratedReceivable(supabase, id)
    await syncStockOrdersForServiceOrder(supabase, { ...orderExists, status: resetStatus })

    return NextResponse.json({ events: [], order: { id, ...orderUpdate } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao resetar eventos" }, { status: 500 })
  }
}
