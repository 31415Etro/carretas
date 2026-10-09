import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/server"
import { finishedStatuses } from "@/lib/os-workflow"

type AdminClient = ReturnType<typeof createAdminClient>
const BUSINESS_TIME_ZONE = "America/Sao_Paulo"

function businessMonth(value?: string | null) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value || ""
  const month = parts.find((part) => part.type === "month")?.value || ""
  return year && month ? `${year}-${month}` : ""
}

function openedInCurrentMonth(order: any) {
  return businessMonth(order.created_at) === businessMonth()
}

function finishedRecently(order: any) {
  const finishedAt = new Date(order.finished_at || "").getTime()
  return Number.isFinite(finishedAt) && Math.abs(Date.now() - finishedAt) <= 10 * 60 * 1000
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`operational:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export function serviceOrderReceivableId(orderId: string) {
  return uuidFromText(`accounts_receivable:${orderId}`)
}

function receivableFromOrder(order: any) {
  const dueDate = String(order.payment_due_date || order.finished_at || order.scheduled_date || new Date().toISOString()).slice(0, 10)
  return {
    id: serviceOrderReceivableId(order.id),
    client_id: order.client_id || null,
    work_id: order.work_id || null,
    environment_id: order.environment_id || null,
    point_id: order.point_id || null,
    service_order_id: order.id,
    description: `OS ${order.order_number} - ${order.description || "Servico concluido"}`,
    category_id: null,
    subcategory_id: null,
    cost_center_id: null,
    dre_account_id: null,
    competence_date: String(order.finished_at || order.scheduled_date || dueDate).slice(0, 10),
    due_date: dueDate,
    received_date: null,
    expected_amount: Math.max(0, Number(order.total_amount || 0)),
    received_amount: 0,
    receipt_method: order.payment_method || "",
    bank_account_id: null,
    status: "Aberta",
    origin: "OS",
    notes: `Conta gerada automaticamente ao finalizar a OS ${order.order_number}.`,
    attachment_url: "",
  }
}

export async function ensureReceivableForFinishedOrder(admin: AdminClient, orderId: string) {
  const { data: order, error: orderError } = await admin
    .from("service_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle()
  if (orderError) throw new Error(`service_orders: ${orderError.message}`)
  if (!order?.id) throw new Error("OS nao encontrada para gerar a conta a receber.")

  if (!finishedStatuses.has(order.status)) {
    const { error } = await admin
      .from("accounts_receivable")
      .delete()
      .eq("service_order_id", orderId)
      .eq("origin", "OS")
      .eq("status", "Aberta")
    if (error) throw new Error(`accounts_receivable cleanup: ${error.message}`)
    return null
  }

  const id = serviceOrderReceivableId(order.id)
  const { data: existing, error: lookupError } = await admin
    .from("accounts_receivable")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (lookupError) throw new Error(`accounts_receivable lookup: ${lookupError.message}`)
  if (existing?.id) return existing.id

  const { error } = await admin.from("accounts_receivable").insert(receivableFromOrder(order))
  if (error?.code === "23505") return id
  if (error) throw new Error(`accounts_receivable: ${error.message}`)
  return id
}

export async function syncReceivablesForServiceOrders(admin: AdminClient, orders: any[]) {
  const validOrders = orders.filter((order) => order?.id)
  if (!validOrders.length) return { created: 0 }

  const nonFinishedIds = validOrders.filter((order) => !finishedStatuses.has(order.status)).map((order) => order.id)
  if (nonFinishedIds.length) {
    const { error } = await admin
      .from("accounts_receivable")
      .delete()
      .in("service_order_id", nonFinishedIds)
      .eq("origin", "OS")
      .eq("status", "Aberta")
    if (error) throw new Error(`accounts_receivable cleanup: ${error.message}`)
  }

  const finishedIds = validOrders.filter((order) => finishedStatuses.has(order.status)).map((order) => order.id)
  if (!finishedIds.length) return { created: 0 }

  const { data: persistedOrders, error: orderLookupError } = await admin
    .from("service_orders")
    .select("*")
    .in("id", finishedIds)
  if (orderLookupError) throw new Error(`service_orders lookup: ${orderLookupError.message}`)
  const finished = (persistedOrders || []).filter((order) => openedInCurrentMonth(order) || finishedRecently(order))
  if (!finished.length) return { created: 0 }

  const eligibleOrderIds = finished.map((order) => order.id)
  const { data: existing, error: lookupError } = await admin
    .from("accounts_receivable")
    .select("service_order_id")
    .eq("origin", "OS")
    .in("service_order_id", eligibleOrderIds)
  if (lookupError) throw new Error(`accounts_receivable lookup: ${lookupError.message}`)

  const existingOrderIds = new Set((existing || []).map((item) => item.service_order_id))
  const rows = finished.filter((order) => !existingOrderIds.has(order.id)).map(receivableFromOrder)
  if (!rows.length) return { created: 0 }

  const { error } = await admin.from("accounts_receivable").upsert(rows, { onConflict: "id", ignoreDuplicates: true })
  if (error) throw new Error(`accounts_receivable: ${error.message}`)
  return { created: rows.length }
}
