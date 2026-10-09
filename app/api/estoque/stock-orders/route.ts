import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"
import { backfillStockOrders } from "@/lib/stock-order-sync"

export const dynamic = "force-dynamic"

const statuses = ["Aberto", "Produção", "Pronta para uso", "Usada"] as const

function isMissingTable(message = "") {
  return /Could not find the table|relation .* does not exist/i.test(message)
}

function selectedPointIds(notes: string) {
  const marker = "Selecoes OS JSON:"
  const start = notes.indexOf(marker)
  if (start < 0) return [] as string[]
  const source = notes.slice(start + marker.length).trim()
  try {
    const parsed = JSON.parse(source)
    return Array.isArray(parsed?.pointIds) ? parsed.pointIds.filter((id: unknown) => typeof id === "string") : []
  } catch {
    return [] as string[]
  }
}

async function synchronizeUsedOrders(supabase: ReturnType<typeof createAdminClient>) {
  const stockRows = await readAllPages<any>((from, to) => supabase
    .from("stock_service_orders")
    .select("id,budget_point_id,status,linked_service_order_id")
    .order("id").range(from, to))
  const stockPointIds = new Set((stockRows || []).map((row) => row.budget_point_id))
  if (!stockPointIds.size) return

  const orders = await readAllPages<any>((from, to) => supabase
    .from("service_orders")
    .select("id,point_id,notes")
    .eq("order_type", "obra")
    .eq("status", "Finalizada").order("id").range(from, to))

  const usedOrdersByPoint = new Map<string, string>()
  for (const order of orders || []) {
    for (const pointId of selectedPointIds(String(order.notes || ""))) {
      if (stockPointIds.has(pointId)) usedOrdersByPoint.set(pointId, order.id)
    }
    if (order.point_id && stockPointIds.has(order.point_id)) usedOrdersByPoint.set(order.point_id, order.id)
  }

  const orphanedUsedIds = (stockRows || [])
    .filter((row) => row.status === "Usada" && row.linked_service_order_id && !usedOrdersByPoint.has(row.budget_point_id))
    .map((row) => row.id)
  for (let index = 0; index < orphanedUsedIds.length; index += 200) {
    const { error: reopenError } = await supabase
      .from("stock_service_orders")
      .update({ status: "Aberto", linked_service_order_id: null, used_at: null })
      .in("id", orphanedUsedIds.slice(index, index + 200))
    if (reopenError) throw new Error(`stock_service_orders: ${reopenError.message}`)
  }

  const pointIdsByServiceOrder = new Map<string, string[]>()
  for (const [pointId, serviceOrderId] of usedOrdersByPoint) {
    if (stockRows.some((row) => row.budget_point_id === pointId && row.status === "Usada" && row.linked_service_order_id === serviceOrderId)) continue
    pointIdsByServiceOrder.set(serviceOrderId, [...(pointIdsByServiceOrder.get(serviceOrderId) || []), pointId])
  }
  for (const [serviceOrderId, pointIds] of pointIdsByServiceOrder) {
    for (let index = 0; index < pointIds.length; index += 200) {
      const { error: updateError } = await supabase
        .from("stock_service_orders")
        .update({
          status: "Usada",
          linked_service_order_id: serviceOrderId,
          used_at: new Date().toISOString(),
        })
        .in("budget_point_id", pointIds.slice(index, index + 200))
      if (updateError && !isMissingTable(updateError.message)) {
        throw new Error(`stock_service_orders: ${updateError.message}`)
      }
    }
  }
}

async function authorizeStockAccess() {
  const { user, role } = await currentUserRole()
  if (!user) return { error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) }
  if (role === "client") return { error: NextResponse.json({ error: "Acesso restrito ao estoque." }, { status: 403 }) }
  return { user, role }
}

function stockOrderSearch(query: any, search: string) {
  const clean = search.replace(/[,()%]/g, " ").trim()
  if (!clean) return query
  const pattern = `%${clean}%`
  return query.or([
    `work_name.ilike.${pattern}`,
    `tower_name.ilike.${pattern}`,
    `floor_name.ilike.${pattern}`,
    `final_name.ilike.${pattern}`,
    `environment_name.ilike.${pattern}`,
    `point_name.ilike.${pattern}`,
    `kit_name.ilike.${pattern}`,
  ].join(","))
}

async function readStockOrderPage(
  supabase: ReturnType<typeof createAdminClient>,
  status: typeof statuses[number],
  offset: number,
  limit: number,
  search: string,
) {
  let query = supabase
    .from("stock_service_orders")
    .select("*", { count: "exact" })
    .eq("status", status)
  query = stockOrderSearch(query, search)
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + limit - 1)
  if (error) throw new Error(`stock_service_orders: ${error.message}`)
  return { orders: data || [], count: count || 0 }
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeStockAccess()
    if (authorization.error) return authorization.error
    const url = new URL(request.url)
    const requestedStatus = url.searchParams.get("status")
    if (requestedStatus && !statuses.includes(requestedStatus as typeof statuses[number])) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 })
    }
    const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0)
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10))
    const search = url.searchParams.get("search") || ""
    const shouldSynchronize = url.searchParams.get("sync") === "1"
    const supabase = createAdminClient()
    if (shouldSynchronize) {
      try {
        await backfillStockOrders(supabase)
      } catch (error) {
        if (error instanceof Error && isMissingTable(error.message)) return NextResponse.json({ orders: [], counts: {}, setupRequired: true })
        throw error
      }
      await synchronizeUsedOrders(supabase)
    }
    if (requestedStatus) {
      const page = await readStockOrderPage(supabase, requestedStatus as typeof statuses[number], offset, limit, search)
      return NextResponse.json({ ...page, status: requestedStatus, offset, limit })
    }
    const pages = await Promise.all(statuses.map(async (status) => ({ status, ...(await readStockOrderPage(supabase, status, 0, limit, search)) })))
    return NextResponse.json({
      orders: pages.flatMap((page) => page.orders),
      counts: Object.fromEntries(pages.map((page) => [page.status, page.count])),
      limit,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar OS de estoque" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeStockAccess()
    if (authorization.error) return authorization.error
    const payload = await request.json()
    if (!payload?.id) return NextResponse.json({ error: "OS de estoque inválida." }, { status: 400 })
    if (payload.status && !statuses.includes(payload.status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 })
    }

    const changes: Record<string, unknown> = {}
    for (const key of ["hasWelding", "guidePassage"]) {
      if (Object.hasOwn(payload, key) && payload[key] !== null && typeof payload[key] !== "boolean") {
        return NextResponse.json({ error: "Marcacao invalida." }, { status: 400 })
      }
    }
    if (payload.status) changes.status = payload.status
    if (Object.prototype.hasOwnProperty.call(payload, "hasWelding")) changes.has_welding = payload.hasWelding
    if (Object.prototype.hasOwnProperty.call(payload, "guidePassage")) changes.guide_passage = payload.guidePassage
    if (payload.status === "Usada") changes.used_at = new Date().toISOString()
    if (payload.status && payload.status !== "Usada") {
      changes.used_at = null
      changes.linked_service_order_id = null
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("stock_service_orders")
      .update(changes)
      .eq("id", payload.id)
      .select("*")
      .single()
    if (error) throw new Error(`stock_service_orders: ${error.message}`)
    return NextResponse.json({ order: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar OS de estoque" }, { status: 500 })
  }
}
