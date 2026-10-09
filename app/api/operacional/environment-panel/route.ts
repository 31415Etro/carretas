import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Row = Record<string, any>

type OrderSelection = {
  clientEnvironmentIds: string[]
  clientEquipmentIds: string[]
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

const PROGRESS_STATUSES = new Set(["em execucao", "pausada"])

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function parseSelection(notes = ""): OrderSelection {
  const line = String(notes).split(/\r?\n/).find((item) => item.trim().startsWith("Selecoes OS JSON:"))
  if (!line) return { clientEnvironmentIds: [], clientEquipmentIds: [] }

  try {
    const parsed = JSON.parse(line.slice(line.indexOf(":") + 1).trim())
    return {
      clientEnvironmentIds: Array.isArray(parsed.clientEnvironmentIds) ? parsed.clientEnvironmentIds.filter(Boolean) : [],
      clientEquipmentIds: Array.isArray(parsed.clientEquipmentIds) ? parsed.clientEquipmentIds.filter(Boolean) : [],
    }
  } catch {
    return { clientEnvironmentIds: [], clientEquipmentIds: [] }
  }
}

function equipmentIdFromNote(notes = "") {
  const match = String(notes).match(/^equipment:([0-9a-f-]{36})$/i)
  return match?.[1] || ""
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function naturalCompare(left = "", right = "") {
  return String(left).localeCompare(String(right), "pt-BR", { numeric: true, sensitivity: "base" })
}

function apartmentNumber(value = "") {
  const match = String(value).match(/\bap(?:to|artamento)?[\s.-]*(\d+)\b/i)
  return match ? Number(match[1]) : null
}

function orderRank(order: Row, today: string) {
  const status = normalize(order.status)
  if (PROGRESS_STATUSES.has(status)) return 0
  if (status === "cancelada") return 4
  if (String(order.scheduled_date || "") <= today) return 1
  return 2
}

function chooseCurrentOrder(orders: Row[], today: string) {
  return [...orders].sort((left, right) => {
    const rankDifference = orderRank(left, today) - orderRank(right, today)
    if (rankDifference) return rankDifference

    const leftDate = String(left.scheduled_date || "")
    const rightDate = String(right.scheduled_date || "")
    if (orderRank(left, today) === 2) return leftDate.localeCompare(rightDate)
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
    return String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
  })[0]
}

async function rowsInBatches(supabase: ReturnType<typeof createAdminClient>, table: string, column: string, ids: string[], select: string) {
  const rows: Row[] = []
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200)
    const { data, error } = await supabase.from(table).select(select).in(column, batch)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
  }
  return rows
}

export async function GET(request: Request) {
  try {
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

    const supabase = createAdminClient()
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, client_id, page_permissions")
      .eq("id", user.id)
      .maybeSingle()
    if (profileError || !profile) return NextResponse.json({ error: "Perfil de usuario nao encontrado" }, { status: 403 })

    const requestedClientId = new URL(request.url).searchParams.get("clientId") || ""
    const searchParams = new URL(request.url).searchParams
    const requestedOrderId = searchParams.get("orderId") || ""
    const dateFrom = validDate(searchParams.get("dateFrom"))
    const dateTo = validDate(searchParams.get("dateTo"))
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ error: "A data inicial nao pode ser posterior a data final" }, { status: 400 })
    }
    const isClientUser = profile.role === "client"
    const permissions = Array.isArray(profile.page_permissions) ? profile.page_permissions.map(String) : []
    if (isClientUser && !permissions.includes("painel_ambientes")) return NextResponse.json({ error: "Sem acesso ao Painel de Ambientes" }, { status: 403 })
    const clientId = isClientUser ? String(profile.client_id || "") : requestedClientId

    let clientQuery = supabase
      .from("clients")
      .select("id, name, corporate_name, trade_name")
      .order("name", { ascending: true })
    if (isClientUser && clientId) clientQuery = clientQuery.eq("id", clientId)
    const { data: clientRows, error: clientsError } = await clientQuery
    if (clientsError) throw new Error(`clients: ${clientsError.message}`)

    const availableClients = (clientRows || []).map((client) => ({
      id: client.id,
      name: client.name || client.trade_name || client.corporate_name || "Cliente",
    }))

    if (isClientUser && !clientId) return NextResponse.json({ error: "Usuario cliente sem cliente vinculado" }, { status: 403 })
    if (clientId && !availableClients.some((client) => client.id === clientId)) {
      return NextResponse.json({ error: "Cliente nao encontrado" }, { status: 404 })
    }

    const viewer = {
      role: profile.role,
      clientScoped: isClientUser,
      clientId: clientId || null,
    }
    if (!clientId) {
      return NextResponse.json({
        viewer,
        selectedClient: null,
        availableClients,
        availableOrders: [],
        summary: { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0 },
        groups: [],
        updatedAt: new Date().toISOString(),
      })
    }

    const [environmentResult, equipmentResult, orderResult] = await Promise.all([
      supabase
        .from("client_environments")
        .select("id, client_id, name, location, floor, status")
        .eq("client_id", clientId)
        .order("name", { ascending: true }),
      supabase
        .from("client_equipment")
        .select("id, client_id, client_environment_id, tag, name, capacity, status")
        .eq("client_id", clientId),
      supabase
        .from("service_orders")
        .select("id, order_number, order_type, client_environment_id, client_equipment_id, status, scheduled_date, notes, updated_at")
        .eq("client_id", clientId)
        .in("order_type", ["pmoc", "servicos"]),
    ])
    if (environmentResult.error) throw new Error(`client_environments: ${environmentResult.error.message}`)
    if (equipmentResult.error) throw new Error(`client_equipment: ${equipmentResult.error.message}`)
    if (orderResult.error) throw new Error(`service_orders: ${orderResult.error.message}`)

    const allEnvironments = environmentResult.data || []
    const equipment = equipmentResult.data || []
    const allOrders = orderResult.data || []
    const availableOrders = [...allOrders]
      .sort((left, right) => {
        const dateDifference = String(right.scheduled_date || "").localeCompare(String(left.scheduled_date || ""))
        return dateDifference || naturalCompare(left.order_number, right.order_number)
      })
      .map((order) => ({
        id: order.id,
        number: order.order_number || "OS sem numero",
        type: order.order_type === "pmoc" ? "PMOC" : "Servicos diversos",
        status: order.status || "",
        scheduledDate: order.scheduled_date || "",
      }))
    const hasOrderFilter = Boolean(requestedOrderId)
    const hasDateFilter = Boolean(dateFrom || dateTo)
    const orders = allOrders.filter((order) => {
      if (requestedOrderId && order.id !== requestedOrderId) return false
      const scheduledDate = String(order.scheduled_date || "")
      if (dateFrom && (!scheduledDate || scheduledDate < dateFrom)) return false
      if (dateTo && (!scheduledDate || scheduledDate > dateTo)) return false
      return true
    })
    const equipmentById = new Map(equipment.map((item) => [item.id, item]))
    const equipmentByEnvironment = new Map<string, Row[]>()
    equipment.forEach((item) => {
      const current = equipmentByEnvironment.get(item.client_environment_id) || []
      current.push(item)
      equipmentByEnvironment.set(item.client_environment_id, current)
    })

    const orderEquipmentByEnvironment = new Map<string, Map<string, Set<string>>>()
    const ordersByEnvironment = new Map<string, Row[]>()
    orders.forEach((order) => {
      const selection = parseSelection(order.notes)
      const environmentIds = new Set<string>(selection.clientEnvironmentIds)
      const equipmentIds = new Set<string>(selection.clientEquipmentIds)
      if (order.client_environment_id) environmentIds.add(order.client_environment_id)
      if (order.client_equipment_id) equipmentIds.add(order.client_equipment_id)
      equipmentIds.forEach((equipmentId) => {
        const environmentId = equipmentById.get(equipmentId)?.client_environment_id
        if (environmentId) environmentIds.add(environmentId)
      })
      const byEnvironment = new Map<string, Set<string>>()
      equipmentIds.forEach((equipmentId) => {
        const environmentId = equipmentById.get(equipmentId)?.client_environment_id
        if (!environmentId) return
        const current = byEnvironment.get(environmentId) || new Set<string>()
        current.add(equipmentId)
        byEnvironment.set(environmentId, current)
      })
      orderEquipmentByEnvironment.set(order.id, byEnvironment)

      environmentIds.forEach((environmentId) => {
        const current = ordersByEnvironment.get(environmentId) || []
        current.push(order)
        ordersByEnvironment.set(environmentId, current)
      })
    })

    const environments = hasOrderFilter || hasDateFilter
      ? allEnvironments.filter((environment) => ordersByEnvironment.has(environment.id))
      : allEnvironments

    const currentOrderByEnvironment = new Map<string, Row>()
    const today = localDate()
    environments.forEach((environment) => {
      const current = chooseCurrentOrder(ordersByEnvironment.get(environment.id) || [], today)
      if (current) currentOrderByEnvironment.set(environment.id, current)
    })
    const currentOrderIds = Array.from(new Set(Array.from(currentOrderByEnvironment.values()).map((order) => order.id)))
    const executionPhotos = currentOrderIds.length
      ? await rowsInBatches(supabase, "service_order_files", "service_order_id", currentOrderIds, "id, service_order_id, category, notes, created_at")
      : []
    const initialPhotosByOrder = new Map<string, Row[]>()
    const finalPhotosByOrder = new Map<string, Row[]>()
    executionPhotos.forEach((file) => {
      const target = file.category === "Foto Inicial"
        ? initialPhotosByOrder
        : file.category === "Foto Final" ? finalPhotosByOrder : null
      if (!target) return
      const current = target.get(file.service_order_id) || []
      current.push(file)
      target.set(file.service_order_id, current)
    })

    const tiles = environments.map((environment) => {
      const environmentEquipment = [...(equipmentByEnvironment.get(environment.id) || [])]
        .sort((left, right) => naturalCompare(left.tag || left.name, right.tag || right.name))
      const order = currentOrderByEnvironment.get(environment.id)
      let state: "idle" | "open" | "inProgress" | "finished" = "idle"
      let photographedEquipment = 0
      let targetEquipment = 0

      if (order) {
        const targetIds = orderEquipmentByEnvironment.get(order.id)?.get(environment.id) || new Set<string>()
        const initialPhotos = initialPhotosByOrder.get(order.id) || []
        const finalPhotos = finalPhotosByOrder.get(order.id) || []
        const initialPhotographedIds = new Set(
          initialPhotos.map((photo) => equipmentIdFromNote(photo.notes)).filter((equipmentId) => equipmentById.get(equipmentId)?.client_environment_id === environment.id),
        )
        const photographedIds = new Set(
          finalPhotos.map((photo) => equipmentIdFromNote(photo.notes)).filter((equipmentId) => equipmentById.get(equipmentId)?.client_environment_id === environment.id),
        )
        targetEquipment = targetIds.size
        photographedEquipment = targetEquipment
          ? Array.from(targetIds).filter((equipmentId) => photographedIds.has(equipmentId)).length
          : photographedIds.size
        const hasOrderLevelInitialPhoto = initialPhotos.some((photo) => !equipmentIdFromNote(photo.notes))
        const hasOrderLevelFinalPhoto = finalPhotos.some((photo) => !equipmentIdFromNote(photo.notes))
        const hasInitialEvidence = targetEquipment > 0
          ? Array.from(targetIds).some((equipmentId) => initialPhotographedIds.has(equipmentId))
          : hasOrderLevelInitialPhoto || initialPhotographedIds.size > 0
        const finalEvidenceComplete = targetEquipment > 0
          ? photographedEquipment >= targetEquipment
          : hasOrderLevelFinalPhoto || photographedEquipment > 0
        const status = normalize(order.status)

        if (status !== "cancelada") {
          if (finalEvidenceComplete) state = "finished"
          else if (hasInitialEvidence) state = "inProgress"
          else state = "open"
        }
      }

      const group = environment.floor?.trim()
        || (/^ap(?:to)?\s*\d/i.test(environment.name || "") ? "Apartamentos" : "Ambientes")
      return {
        id: environment.id,
        name: environment.name || "Ambiente sem nome",
        location: environment.location || "",
        floor: environment.floor || "",
        group,
        state,
        equipmentCount: environmentEquipment.length,
        equipment: environmentEquipment.map((item) => ({
          id: item.id,
          label: [item.tag, item.name].filter(Boolean).join(" - ") || "Equipamento",
          capacity: item.capacity || "",
        })),
        order: order ? {
          id: order.id,
          number: order.order_number,
          type: order.order_type === "pmoc" ? "PMOC" : "Servicos diversos",
          status: order.status,
          scheduledDate: order.scheduled_date || "",
        } : null,
        photoProgress: { completed: photographedEquipment, total: targetEquipment },
      }
    }).sort((left, right) => {
      const groupDifference = naturalCompare(left.group, right.group)
      if (groupDifference) return groupDifference
      if (left.group === "Apartamentos") {
        const leftNumber = apartmentNumber(left.name)
        const rightNumber = apartmentNumber(right.name)
        if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber
        if (leftNumber !== null && rightNumber === null) return -1
        if (leftNumber === null && rightNumber !== null) return 1
        return naturalCompare(left.name, right.name)
      }
      return naturalCompare(left.location || left.name, right.location || right.name)
    })

    const groupMap = new Map<string, typeof tiles>()
    tiles.forEach((tile) => {
      const current = groupMap.get(tile.group) || []
      current.push(tile)
      groupMap.set(tile.group, current)
    })
    const groups = Array.from(groupMap.entries()).map(([name, items]) => ({ name, items }))
    const summary = tiles.reduce((result, tile) => {
      result.total += 1
      result[tile.state] += 1
      return result
    }, { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0 })

    return NextResponse.json({
      viewer,
      selectedClient: availableClients.find((client) => client.id === clientId) || null,
      availableClients: isClientUser ? availableClients.filter((client) => client.id === clientId) : availableClients,
      availableOrders,
      summary,
      groups,
      updatedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar painel de ambientes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
