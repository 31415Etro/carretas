import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { dashboardWorks, mergeOperationalHierarchy } from "@/lib/work-dashboard-data"

export const dynamic = "force-dynamic"

type Row = Record<string, any>
type PointState = "idle" | "open" | "inProgress" | "finished"

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

function naturalCompare(left = "", right = "") {
  return String(left).localeCompare(String(right), "pt-BR", { numeric: true, sensitivity: "base" })
}

function parsePointIds(order: Row) {
  const line = String(order.notes || "").split(/\r?\n/).find((item) => item.trim().startsWith("Selecoes OS JSON:"))
  let selected: string[] = []
  if (line) {
    try {
      const parsed = JSON.parse(line.slice(line.indexOf(":") + 1).trim())
      if (Array.isArray(parsed.pointIds)) selected = parsed.pointIds.filter(Boolean)
    } catch {
      selected = []
    }
  }
  return Array.from(new Set([...selected, order.point_id].filter(Boolean)))
}

function aggregateState(states: PointState[]): PointState {
  if (!states.length || states.every((state) => state === "idle")) return "idle"
  if (states.every((state) => state === "finished")) return "finished"
  if (states.some((state) => state === "inProgress" || state === "finished")) return "inProgress"
  return "open"
}

function photoScopeId(notes = "") {
  return String(notes).match(/(?:^|\n)(?:equipment|point_id):([^\n]+)/)?.[1]?.trim() || ""
}

function displayablePhotoUrl(value: unknown) {
  const url = String(value || "").trim()
  return /^(?:https?:\/\/|data:image\/|\/)/i.test(url) ? url : ""
}

function floorSortValue(row: Row) {
  const source = `${row.level || ""} ${row.name || ""}`
  const number = source.match(/-?\d+(?:[.,]\d+)?/)?.[0]
  if (number) return Number(number.replace(",", "."))
  const value = normalize(source)
  if (/subsolo|garagem/.test(value)) return -100
  if (/terreo/.test(value)) return 0
  if (/mezanino/.test(value)) return 0.5
  if (/cobertura|reservatorio/.test(value)) return 10000
  return 1
}

async function rowsInBatches(supabase: ReturnType<typeof createAdminClient>, table: string, column: string, ids: string[], select = "*") {
  const rows: Row[] = []
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await supabase.from(table).select(select).in(column, ids.slice(index, index + 200))
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
    const { data: profile, error: profileError } = await supabase.from("profiles").select("role,client_id,active,page_permissions").eq("id", user.id).maybeSingle()
    if (profileError || !profile || profile.active === false) return NextResponse.json({ error: "Perfil sem acesso" }, { status: 403 })

    const url = new URL(request.url)
    const requestedClientId = url.searchParams.get("clientId") || ""
    const requestedWorkId = url.searchParams.get("workId") || ""
    const requestedOrderIds = Array.from(new Set((url.searchParams.get("orderIds") || "").split(",").map((value) => value.trim()).filter(Boolean)))
    const clientScoped = profile.role === "client"
    const permissions = Array.isArray(profile.page_permissions) ? profile.page_permissions.map(String) : []
    if (clientScoped && !permissions.includes("dashboard_obras")) return NextResponse.json({ error: "Sem acesso ao Dashboard de Obra" }, { status: 403 })
    const clientId = clientScoped ? String(profile.client_id || "") : requestedClientId
    if (clientScoped && !clientId) return NextResponse.json({ error: "Usuario cliente sem cliente vinculado" }, { status: 403 })

    let clientQuery = supabase.from("clients").select("id,name,corporate_name,trade_name").order("name")
    if (clientScoped) clientQuery = clientQuery.eq("id", clientId)
    const { data: clientRows, error: clientError } = await clientQuery
    if (clientError) throw new Error(`clients: ${clientError.message}`)
    const clients = (clientRows || []).map((row) => ({ id: row.id, name: row.name || row.trade_name || row.corporate_name || "Cliente" }))

    const { data: workRows, error: workError } = await supabase
      .from("budget_works")
      .select("*")
      .order("name")
    if (workError) throw new Error(`budget_works: ${workError.message}`)
    const { data: operationalWorks, error: operationalWorkError } = await supabase.from("works").select("id,client_id,name,type,code").order("name")
    if (operationalWorkError) throw new Error(`works: ${operationalWorkError.message}`)
    const works = dashboardWorks(workRows || [], operationalWorks || [], clientRows || [], clientId)
    const selectedWork = works.find((work) => work.id === requestedWorkId) || (works.length === 1 ? works[0] : null)

    const base = {
      viewer: { role: profile.role, clientScoped, clientId: clientId || null },
      clients: clientScoped ? clients.filter((client) => client.id === clientId) : clients,
      works,
      selectedWork,
      serviceOrders: [] as Row[],
      selectedOrderIds: [] as string[],
      summary: { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0, progress: 0 },
      towers: [] as Row[],
      orderFloors: [] as Row[],
      orderSummary: { total: 0, open: 0, inProgress: 0, finished: 0, progress: 0 },
      updatedAt: new Date().toISOString(),
    }
    if (!selectedWork) return NextResponse.json(base, { headers: { "Cache-Control": "private, no-store, max-age=0" } })

    const { data: budgetTowers, error: towerError } = await supabase.from("budget_towers").select("id,name,description").eq("budget_work_id", selectedWork.id)
    if (towerError) throw new Error(`budget_towers: ${towerError.message}`)
    const towerIds = (budgetTowers || []).map((row) => row.id)
    let floors = towerIds.length ? await rowsInBatches(supabase, "budget_floors", "budget_tower_id", towerIds, "id,budget_tower_id,name,level") : []
    const floorIds = floors.map((row) => row.id)
    let finals = floorIds.length ? await rowsInBatches(supabase, "budget_service_types", "budget_floor_id", floorIds, "id,budget_floor_id,name,description") : []
    const finalIds = finals.map((row) => row.id)
    let environments = finalIds.length ? await rowsInBatches(supabase, "budget_environments", "budget_service_type_id", finalIds, "id,budget_service_type_id,name,notes") : []
    const environmentIds = environments.map((row) => row.id)
    let points = environmentIds.length ? await rowsInBatches(supabase, "budget_points", "budget_environment_id", environmentIds, "id,budget_environment_id,name,point_number") : []
    const [operationalFloors, operationalEnvironments, operationalPoints] = await Promise.all([
      rowsInBatches(supabase, "work_floors", "work_id", [selectedWork.id]),
      rowsInBatches(supabase, "work_environments", "work_id", [selectedWork.id]),
      rowsInBatches(supabase, "work_points", "work_id", [selectedWork.id]),
    ])
    const merged = mergeOperationalHierarchy({ towers: budgetTowers || [], floors, finals, environments, points }, { floors: operationalFloors, environments: operationalEnvironments, points: operationalPoints }, selectedWork.id)
    const towers = merged.towers
    ;({ floors, finals, environments, points } = merged)
    const dashboardEnvironmentIds = environments.map((row) => String(row.id))
    const pointIds = new Set(points.map((row) => row.id))

    const { data: orders, error: orderError } = await supabase
      .from("service_orders")
      .select("id,order_number,floor_id,environment_id,point_id,status,description,scheduled_date,notes,created_at,updated_at,finished_at")
      .eq("work_id", selectedWork.id)
      .eq("order_type", "obra")
      .eq("client_id", selectedWork.clientId)
    if (orderError) throw new Error(`service_orders: ${orderError.message}`)
    const eligibleOrders = (orders || []).filter((order) => normalize(order.status) !== "cancelada")
    const eligibleOrderIds = new Set(eligibleOrders.map((order) => String(order.id)))
    const selectedOrderIds = requestedOrderIds.filter((id) => eligibleOrderIds.has(id))
    const selectedOrderIdSet = new Set(selectedOrderIds)
    const activeOrders = selectedOrderIds.length ? eligibleOrders.filter((order) => selectedOrderIdSet.has(String(order.id))) : eligibleOrders
    const activeOrderIds = activeOrders.map((order) => String(order.id))
    const [environmentPhotos, orderFiles] = await Promise.all([
      dashboardEnvironmentIds.length
        ? rowsInBatches(supabase, "environment_photos", "environment_id", dashboardEnvironmentIds, "id,environment_id,file_url,file_name,photo_type,description,created_at")
        : Promise.resolve([]),
      activeOrderIds.length
        ? rowsInBatches(supabase, "service_order_files", "service_order_id", activeOrderIds, "id,service_order_id,category,file_url,file_name,file_type,notes,created_at")
        : Promise.resolve([]),
    ])
    const serviceOrders = [...eligibleOrders]
      .sort((left, right) => {
        const leftDate = Date.parse(left.scheduled_date || left.created_at || left.updated_at || "") || 0
        const rightDate = Date.parse(right.scheduled_date || right.created_at || right.updated_at || "") || 0
        return rightDate - leftDate || naturalCompare(right.order_number, left.order_number)
      })
      .map((order) => ({
        id: order.id,
        number: order.order_number || "OS sem numero",
        status: order.status || "",
        scheduledDate: order.scheduled_date || null,
        createdAt: order.created_at || null,
      }))
    const environmentFloor = new Map(environments.map((environment) => [environment.id, finals.find((final) => final.id === environment.budget_service_type_id)?.budget_floor_id]))
    const pointFloor = new Map(points.map((point) => [point.id, environmentFloor.get(point.budget_environment_id)]))
    const orderFloors = new Map<string, Row>()
    const orderSummary = { total: 0, open: 0, inProgress: 0, finished: 0, progress: 0 }
    activeOrders.forEach((order) => {
      const status = normalize(order.status)
      const state = /finaliz|conclu/.test(status) ? "finished" : /execu|andamento|paus|parcial/.test(status) ? "inProgress" : "open"
      orderSummary.total += 1
      orderSummary[state] += 1
      const linkedFloors = Array.from(new Set([order.floor_id, environmentFloor.get(order.environment_id), ...parsePointIds(order).map((id) => pointFloor.get(id))].filter(Boolean)))
      if (!linkedFloors.length) linkedFloors.push("unassigned")
      linkedFloors.forEach((id) => {
        const floor = floors.find((row) => row.id === id)
        const tower = towers.find((row) => row.id === floor?.budget_tower_id)
        const group = orderFloors.get(id) || { id, name: floor?.name || "Sem pavimento vinculado", tower: tower?.name || "", orders: [], total: 0, finished: 0, progress: 0 }
        group.orders.push({ id: order.id, number: order.order_number, state, status: order.status, description: order.description || "", date: order.scheduled_date })
        group.total += 1
        if (state === "finished") group.finished += 1
        group.progress = Math.round(group.finished / group.total * 100)
        orderFloors.set(id, group)
      })
    })
    orderSummary.progress = orderSummary.total ? Math.round(orderSummary.finished / orderSummary.total * 100) : 0
    const pointProgress = new Map<string, { state: PointState; orders: Row[] }>()
    points.forEach((point) => pointProgress.set(point.id, { state: "idle", orders: [] }))
    activeOrders.forEach((order) => {
      const selectedPointIds = parsePointIds(order).filter((id) => pointIds.has(id))
      const status = normalize(order.status)
      const state: PointState = /finaliz|conclu/.test(status) ? "finished" : /execu|andamento|paus|parcial/.test(status) ? "inProgress" : "open"
      selectedPointIds.forEach((pointId) => {
        const current = pointProgress.get(pointId) || { state: "idle" as PointState, orders: [] }
        if (!current.orders.some((item) => item.id === order.id)) current.orders.push(order)
        current.state = aggregateState(current.orders.map((item) => {
          const itemStatus = normalize(item.status)
          return /finaliz|conclu/.test(itemStatus) ? "finished" : /execu|andamento|paus|parcial/.test(itemStatus) ? "inProgress" : "open"
        }))
        pointProgress.set(pointId, current)
      })
    })

    const pointsByEnvironment = new Map<string, Row[]>()
    points.forEach((point) => pointsByEnvironment.set(point.budget_environment_id, [...(pointsByEnvironment.get(point.budget_environment_id) || []), point]))
    const pointEnvironment = new Map(points.map((point) => [String(point.id), String(point.budget_environment_id)]))
    const orderById = new Map(activeOrders.map((order) => [String(order.id), order]))
    const photosByEnvironment = new Map<string, Row[]>()
    environmentPhotos.forEach((photo) => {
      const url = displayablePhotoUrl(photo.file_url || photo.file_name)
      if (!url) return
      const environmentId = String(photo.environment_id)
      photosByEnvironment.set(environmentId, [...(photosByEnvironment.get(environmentId) || []), { ...photo, url, source: "environment" }])
    })
    orderFiles.forEach((file) => {
      const url = displayablePhotoUrl(file.file_url)
      const isImage = /^image\//i.test(String(file.file_type || "")) || /foto|imagem/i.test(String(file.category || ""))
      if (!url || !isImage) return
      const order = orderById.get(String(file.service_order_id))
      const linkedPointIds = order ? parsePointIds(order).map(String).filter((id) => pointEnvironment.has(id)) : []
      const scopeId = photoScopeId(file.notes)
      const pointId = pointEnvironment.has(scopeId) ? scopeId : linkedPointIds.length === 1 ? linkedPointIds[0] : ""
      const environmentId = pointEnvironment.get(pointId)
      if (!environmentId) return
      photosByEnvironment.set(environmentId, [...(photosByEnvironment.get(environmentId) || []), { ...file, url, source: "service_order" }])
    })
    photosByEnvironment.forEach((photos) => photos.sort((left, right) => {
      if (left.source !== right.source) return left.source === "environment" ? -1 : 1
      return (Date.parse(right.created_at || "") || 0) - (Date.parse(left.created_at || "") || 0)
    }))
    const environmentsByFinal = new Map<string, Row[]>()
    environments.forEach((environment) => environmentsByFinal.set(environment.budget_service_type_id, [...(environmentsByFinal.get(environment.budget_service_type_id) || []), environment]))
    const finalsByFloor = new Map<string, Row[]>()
    finals.forEach((final) => finalsByFloor.set(final.budget_floor_id, [...(finalsByFloor.get(final.budget_floor_id) || []), final]))
    const floorsByTower = new Map<string, Row[]>()
    floors.forEach((floor) => floorsByTower.set(floor.budget_tower_id, [...(floorsByTower.get(floor.budget_tower_id) || []), floor]))

    const mappedTowers = (towers || []).sort((a, b) => naturalCompare(a.name, b.name)).map((tower) => {
      const towerFloors = [...(floorsByTower.get(tower.id) || [])].sort((a, b) => floorSortValue(b) - floorSortValue(a) || naturalCompare(b.name, a.name))
      const mappedFloors = towerFloors.map((floor) => {
        const mappedFinals = [...(finalsByFloor.get(floor.id) || [])].sort((a, b) => naturalCompare(a.name, b.name)).map((final) => {
          const mappedEnvironments = [...(environmentsByFinal.get(final.id) || [])].sort((a, b) => naturalCompare(a.name, b.name)).map((environment) => {
            const mappedPoints = [...(pointsByEnvironment.get(environment.id) || [])].sort((a, b) => Number(a.point_number || 0) - Number(b.point_number || 0) || naturalCompare(a.name, b.name)).map((point) => {
              const progress = pointProgress.get(point.id) || { state: "idle" as PointState, orders: [] }
              return {
                id: point.id,
                name: point.name || "Ponto",
                number: Number(point.point_number || 0),
                state: progress.state,
                orders: progress.orders.map((order) => ({ id: order.id, number: order.order_number, status: order.status, state: /finaliz|conclu/.test(normalize(order.status)) ? "finished" : /execu|andamento|paus|parcial/.test(normalize(order.status)) ? "inProgress" : "open" })),
              }
            })
            const states = mappedPoints.map((point) => point.state)
            const finished = states.filter((state) => state === "finished").length
            const photo = photosByEnvironment.get(String(environment.id))?.[0]
            return {
              id: environment.id,
              name: environment.name || "Ambiente",
              state: aggregateState(states),
              total: states.length,
              finished,
              photo: photo ? { url: photo.url, description: photo.description || photo.category || photo.photo_type || "" } : null,
              points: mappedPoints,
            }
          })
          const finalPoints = mappedEnvironments.flatMap((environment) => environment.points)
          const states = finalPoints.map((point) => point.state)
          const finished = states.filter((state) => state === "finished").length
          return { id: final.id, name: final.name || "Final", state: aggregateState(states), total: states.length, finished, progress: states.length ? Math.round((finished / states.length) * 100) : 0, environments: mappedEnvironments }
        })
        const floorPoints = mappedFinals.flatMap((final) => final.environments.flatMap((environment) => environment.points))
        const finished = floorPoints.filter((point) => point.state === "finished").length
        return { id: floor.id, name: floor.name || "Pavimento", level: floor.level || "", total: floorPoints.length, finished, progress: floorPoints.length ? Math.round((finished / floorPoints.length) * 100) : 0, finals: mappedFinals }
      })
      const towerPoints = mappedFloors.flatMap((floor) => floor.finals.flatMap((final) => final.environments.flatMap((environment) => environment.points)))
      const finished = towerPoints.filter((point) => point.state === "finished").length
      return { id: tower.id, name: tower.name || "Torre", description: tower.description || "", total: towerPoints.length, finished, progress: towerPoints.length ? Math.round((finished / towerPoints.length) * 100) : 0, floors: mappedFloors }
    })
    const allPoints = mappedTowers.flatMap((tower) => tower.floors.flatMap((floor) => floor.finals.flatMap((final) => final.environments.flatMap((environment) => environment.points))))
    const summary = allPoints.reduce((result, point) => {
      result.total += 1
      result[point.state] += 1
      return result
    }, { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0, progress: 0 })
    summary.progress = summary.total ? Math.round((summary.finished / summary.total) * 100) : 0

    const orderPoints = mappedTowers.flatMap((tower) => tower.floors.flatMap((floor) => floor.finals.flatMap((final) => final.environments.flatMap((environment) => environment.points
      .filter((point) => point.orders.length)
      .map((point) => ({
        id: point.id,
        name: point.name,
        path: [tower.name, floor.name, final.name, environment.name].filter(Boolean).join(" / "),
        state: point.state,
        orders: point.orders,
      }))))))

    return NextResponse.json({ ...base, serviceOrders, selectedOrderIds, summary, towers: mappedTowers, orderSummary, orderPoints, orderFloors: [...orderFloors.values()].sort((a, b) => naturalCompare(a.tower, b.tower) || naturalCompare(a.name, b.name)) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar Dashboard de Obra" }, { status: 500 })
  }
}
