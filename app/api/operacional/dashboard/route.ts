import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Row = Record<string, any>

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === "year")?.value || "1970"
  const month = parts.find((part) => part.type === "month")?.value || "01"
  const day = parts.find((part) => part.type === "day")?.value || "01"
  return `${year}-${month}-${day}`
}

function addDays(dateValue: string, amount: number) {
  const [year, month, day] = dateValue.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + amount))
  return date.toISOString().slice(0, 10)
}

async function countRows(supabase: ReturnType<typeof createAdminClient>, table: string, build?: (query: any) => any) {
  let query = supabase.from(table).select("id", { count: "exact", head: true })
  if (build) query = build(query)

  const { count, error } = await query
  if (error) throw new Error(`${table}: ${error.message}`)
  return count || 0
}

async function rowsById(supabase: ReturnType<typeof createAdminClient>, table: string, ids: Array<string | null | undefined>, select: string) {
  const cleanIds = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!cleanIds.length) return new Map<string, Row>()

  const { data, error } = await supabase.from(table).select(select).in("id", cleanIds)
  if (error) throw new Error(`${table}: ${error.message}`)
  return new Map<string, Row>((data || []).map((row: Row) => [row.id, row]))
}

function label(row: Row | undefined, fallback = "-") {
  return row?.name || row?.full_name || row?.point_name || row?.environment_name || fallback
}

function isFinalStatus(status: string) {
  return ["Finalizada", "Cancelada"].includes(status)
}

function monthLabel(dateValue = "") {
  const month = Number(String(dateValue).slice(5, 7))
  return ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][month - 1] || ""
}

function periodBounds(year: string, month: string) {
  if (month === "todos") return { start: `${year}-01-01`, end: `${year}-12-31` }
  const monthNumber = Number(month)
  const nextYear = monthNumber === 12 ? Number(year) + 1 : Number(year)
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
  const end = new Date(`${nextStart}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  return { start: `${year}-${month}-01`, end: end.toISOString().slice(0, 10) }
}

function normalizeOrderType(value = "") {
  const normalized = String(value || "obra").toLowerCase()
  if (normalized.includes("pmoc")) return "PMOC"
  if (normalized.includes("serv")) return "Servicos diversos"
  return "Obra"
}

function normalizedEventStep(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const session = await createClient()
    const { data: { user: authUser } } = await session.auth.getUser()
    if (!authUser) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, client_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (profileError || !profile) return NextResponse.json({ error: "Perfil de usuario nao encontrado" }, { status: 403 })

    const today = saoPauloDate()
    const url = new URL(request.url)
    const requestedClientId = url.searchParams.get("clientId") || ""
    const isClientUser = profile.role === "client"
    const scopedClientId = isClientUser ? (profile.client_id || "") : (profile.role === "admin" ? requestedClientId : "")
    if (isClientUser && !scopedClientId) return NextResponse.json({ error: "Usuario cliente sem cliente vinculado" }, { status: 403 })

    const { data: clientRows, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, corporate_name, trade_name")
      .order("name", { ascending: true })
    if (clientsError) throw new Error(`clients: ${clientsError.message}`)
    const availableClients = (clientRows || []).map((client) => ({
      id: client.id,
      name: client.name || client.trade_name || client.corporate_name || "Cliente",
    }))
    const selectedClient = availableClients.find((client) => client.id === scopedClientId) || null
    const scopeOrders = (query: any) => scopedClientId ? query.eq("client_id", scopedClientId) : query
    const scopeWorks = (query: any) => scopedClientId ? query.eq("client_id", scopedClientId) : query
    let scopedWorkIds: string[] = []
    if (scopedClientId) {
      const { data: workRows, error: workError } = await supabase.from("works").select("id").eq("client_id", scopedClientId)
      if (workError) throw new Error(`works: ${workError.message}`)
      scopedWorkIds = (workRows || []).map((work) => work.id)
    }

    const currentYear = today.slice(0, 4)
    const requestedYear = url.searchParams.get("year") || currentYear
    const requestedMonth = url.searchParams.get("month") || "todos"
    const chartYear = /^\d{4}$/.test(requestedYear) ? requestedYear : currentYear
    const chartMonth = /^(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : "todos"
    const chartPeriod = periodBounds(chartYear, chartMonth)
    const chartPeriodEndExclusive = addDays(chartPeriod.end, 1)
    const requestedExecutionStart = url.searchParams.get("executionStart") || ""
    const requestedExecutionEnd = url.searchParams.get("executionEnd") || ""
    const hasValidExecutionPeriod = /^\d{4}-\d{2}-\d{2}$/.test(requestedExecutionStart)
      && /^\d{4}-\d{2}-\d{2}$/.test(requestedExecutionEnd)
      && requestedExecutionStart <= requestedExecutionEnd
    const executionPeriod = hasValidExecutionPeriod
      ? { start: requestedExecutionStart, end: requestedExecutionEnd }
      : chartPeriod
    const executionPeriodEndExclusive = addDays(executionPeriod.end, 1)
    const scheduledInPeriod = (query: any) => query.gte("scheduled_date", chartPeriod.start).lte("scheduled_date", chartPeriod.end)
    const createdInPeriod = (query: any) => query.gte("created_at", chartPeriod.start).lt("created_at", chartPeriodEndExclusive)

    const [
      openOrders,
      inProgressOrders,
      finishedOrders,
      delayedOrders,
      activeWorks,
      environments,
      points,
      pausedOrders,
    ] = await Promise.all([
      countRows(supabase, "service_orders", (query) => scopeOrders(scheduledInPeriod(query).in("status", ["Criada", "Agendada"]))),
      countRows(supabase, "service_orders", (query) => scopeOrders(scheduledInPeriod(query).in("status", ["Em execução", "Em execucao"]))),
      countRows(supabase, "service_orders", (query) => scopeOrders(query.gte("finished_at", chartPeriod.start).lt("finished_at", chartPeriodEndExclusive))),
      countRows(supabase, "service_orders", (query) => scopeOrders(scheduledInPeriod(query).lt("scheduled_date", today).neq("status", "Finalizada").neq("status", "Cancelada"))),
      countRows(supabase, "works", (query) => scopeWorks(createdInPeriod(query).eq("status", "Ativa"))),
      scopedClientId ? (scopedWorkIds.length ? countRows(supabase, "work_environments", (query) => createdInPeriod(query).in("work_id", scopedWorkIds)) : 0) : countRows(supabase, "work_environments", createdInPeriod),
      scopedClientId ? (scopedWorkIds.length ? countRows(supabase, "work_points", (query) => createdInPeriod(query).in("work_id", scopedWorkIds)) : 0) : countRows(supabase, "work_points", createdInPeriod),
      countRows(supabase, "service_orders", (query) => scopeOrders(scheduledInPeriod(query).eq("status", "Pausada"))),
    ])

    let todayOrdersQuery = supabase
      .from("service_orders")
      .select("id, order_number, client_id, work_id, environment_id, point_id, service_type_id, main_provider_id, scheduled_start_time, status, updated_at")
      .eq("scheduled_date", today)
      .order("scheduled_start_time", { ascending: true })
      .limit(50)
    todayOrdersQuery = scopeOrders(todayOrdersQuery)
    const { data: ordersData, error: ordersError } = await todayOrdersQuery

    if (ordersError) throw new Error(`service_orders: ${ordersError.message}`)

    const todayOrders = ordersData || []
    const [clients, works, environmentsMap, pointsMap, serviceTypes, providers] = await Promise.all([
      rowsById(supabase, "clients", todayOrders.map((order) => order.client_id), "id, name, corporate_name, trade_name"),
      rowsById(supabase, "works", todayOrders.map((order) => order.work_id), "id, name"),
      rowsById(supabase, "work_environments", todayOrders.map((order) => order.environment_id), "id, floor, final, environment_name"),
      rowsById(supabase, "work_points", todayOrders.map((order) => order.point_id), "id, point_name, point_number"),
      rowsById(supabase, "service_types", todayOrders.map((order) => order.service_type_id), "id, name"),
      rowsById(supabase, "providers", todayOrders.map((order) => order.main_provider_id), "id, full_name"),
    ])

    const servicesToday = todayOrders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      scheduledStartTime: order.scheduled_start_time || "-",
      clientName: label(clients.get(order.client_id), "Sem cliente"),
      workName: label(works.get(order.work_id), "Sem obra/local"),
      serviceTypeName: label(serviceTypes.get(order.service_type_id), "Sem serviço"),
      providerName: label(providers.get(order.main_provider_id), "Sem prestador"),
      status: order.status || "-",
    }))

    let periodOrdersQuery = supabase
      .from("service_orders")
      .select("id, order_type, status, scheduled_date, finished_at, total_amount")
      .gte("scheduled_date", chartPeriod.start)
      .lte("scheduled_date", chartPeriod.end)
    periodOrdersQuery = scopeOrders(periodOrdersQuery)
    const { data: periodOrders, error: periodOrdersError } = await periodOrdersQuery

    if (periodOrdersError) throw new Error(`service_orders: ${periodOrdersError.message}`)

    const statusMap = new Map<string, number>()
    const typeMap = new Map<string, number>()
    const typeStatusMap = new Map<string, { type: string; aberta: number; andamento: number; finalizada: number; cancelada: number; total: number }>()
    const monthlyMap = new Map<string, { month: string; abertas: number; andamento: number; finalizadas: number; canceladas: number; total: number }>()
    const dailyOperationsMap = new Map<number, {
      pmocAbertas: number
      pmocAndamento: number
      pmocFinalizadas: number
      pmocCanceladas: number
      servicosAbertas: number
      servicosAndamento: number
      servicosFinalizadas: number
      servicosCanceladas: number
    }>()
    ;(periodOrders || []).forEach((order) => {
      const status = order.status || "Sem status"
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
      const type = normalizeOrderType(order.order_type)
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
      if (["PMOC", "Servicos diversos"].includes(type)) {
        const day = Number(String(order.scheduled_date || "").slice(8, 10))
        if (day >= 1 && day <= 31) {
          const daily = dailyOperationsMap.get(day) || {
            pmocAbertas: 0,
            pmocAndamento: 0,
            pmocFinalizadas: 0,
            pmocCanceladas: 0,
            servicosAbertas: 0,
            servicosAndamento: 0,
            servicosFinalizadas: 0,
            servicosCanceladas: 0,
          }
          if (type === "PMOC") {
            if (["Criada", "Agendada", "A caminho"].includes(status)) daily.pmocAbertas += 1
            else if (status === "Finalizada") daily.pmocFinalizadas += 1
            else if (status === "Cancelada") daily.pmocCanceladas += 1
            else daily.pmocAndamento += 1
          } else {
            if (["Criada", "Agendada", "A caminho"].includes(status)) daily.servicosAbertas += 1
            else if (status === "Finalizada") daily.servicosFinalizadas += 1
            else if (status === "Cancelada") daily.servicosCanceladas += 1
            else daily.servicosAndamento += 1
          }
          dailyOperationsMap.set(day, daily)
        }
      }
      if (["PMOC", "Servicos diversos"].includes(type)) {
        const typeStatus = typeStatusMap.get(type) || { type, aberta: 0, andamento: 0, finalizada: 0, cancelada: 0, total: 0 }
        typeStatus.total += 1
        if (["Criada", "Agendada", "A caminho"].includes(status)) typeStatus.aberta += 1
        else if (status === "Finalizada") typeStatus.finalizada += 1
        else if (status === "Cancelada") typeStatus.cancelada += 1
        else typeStatus.andamento += 1
        typeStatusMap.set(type, typeStatus)
      }
      const month = monthLabel(order.scheduled_date)
      if (!month) return
      const row = monthlyMap.get(month) || { month, abertas: 0, andamento: 0, finalizadas: 0, canceladas: 0, total: 0 }
      row.total += 1
      if (["Criada", "Agendada", "A caminho"].includes(status)) row.abertas += 1
      else if (status === "Finalizada") row.finalizadas += 1
      else if (status === "Cancelada") row.canceladas += 1
      else row.andamento += 1
      monthlyMap.set(month, row)
    })

    const monthOrder = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    const orderCharts = {
      status: Array.from(statusMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      types: Array.from(typeMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      typeStatus: ["PMOC", "Servicos diversos"].map((type) => typeStatusMap.get(type) || { type, aberta: 0, andamento: 0, finalizada: 0, cancelada: 0, total: 0 }),
      monthly: monthOrder
        .map((month, index) => ({ month, monthNumber: String(index + 1).padStart(2, "0") }))
        .filter((item) => chartMonth === "todos" || item.monthNumber === chartMonth)
        .map(({ month }) => monthlyMap.get(month) || { month, abertas: 0, andamento: 0, finalizadas: 0, canceladas: 0, total: 0 }),
      dailyOperations: Array.from({ length: 31 }, (_, index) => ({
        day: index + 1,
        ...(dailyOperationsMap.get(index + 1) || {
          pmocAbertas: 0,
          pmocAndamento: 0,
          pmocFinalizadas: 0,
          pmocCanceladas: 0,
          servicosAbertas: 0,
          servicosAndamento: 0,
          servicosFinalizadas: 0,
          servicosCanceladas: 0,
        }),
      })),
      executionTime: [] as Array<{
        orderId: string
        orderNumber: string
        orderType: string
        startedAt: string
        finishedAt: string
        durationMinutes: number
      }>,
    }

    let completedOrdersQuery = supabase
      .from("service_orders")
      .select("id, order_number, order_type, finished_at")
      .not("finished_at", "is", null)
      .gte("finished_at", executionPeriod.start)
      .lt("finished_at", executionPeriodEndExclusive)
      .order("finished_at", { ascending: false })
      .limit(1000)
    completedOrdersQuery = scopeOrders(completedOrdersQuery)
    const { data: completedOrders, error: completedOrdersError } = await completedOrdersQuery
    if (completedOrdersError) throw new Error(`service_orders: ${completedOrdersError.message}`)

    const completedOrderIds = (completedOrders || []).map((order) => order.id)
    let executionEvents: Row[] = []
    if (completedOrderIds.length) {
      const chunks = Array.from({ length: Math.ceil(completedOrderIds.length / 100) }, (_, index) => completedOrderIds.slice(index * 100, (index + 1) * 100))
      const eventResults = await Promise.all(chunks.map((ids) => supabase
        .from("service_order_events")
        .select("service_order_id, step_name, event_datetime")
        .in("service_order_id", ids)
        .order("event_datetime", { ascending: true })))
      const executionEventsError = eventResults.find((result) => result.error)?.error
      if (executionEventsError) throw new Error(`service_order_events: ${executionEventsError.message}`)
      executionEvents = eventResults.flatMap((result) => result.data || [])
    }

    const startedAtByOrder = new Map<string, string>()
    executionEvents.forEach((event) => {
      if (normalizedEventStep(event.step_name) !== "iniciar servico") return
      if (!startedAtByOrder.has(event.service_order_id)) startedAtByOrder.set(event.service_order_id, event.event_datetime)
    })

    const executionDurations = (completedOrders || []).flatMap((order) => {
      const startedAt = startedAtByOrder.get(order.id)
      const startedTime = startedAt ? new Date(startedAt).getTime() : Number.NaN
      const finishedTime = order.finished_at ? new Date(order.finished_at).getTime() : Number.NaN
      const durationMinutes = Math.round((finishedTime - startedTime) / 60000)
      if (!Number.isFinite(durationMinutes) || durationMinutes < 0) return []
      return [{
        orderId: order.id,
        orderNumber: order.order_number || "OS sem numero",
        orderType: normalizeOrderType(order.order_type),
        startedAt: startedAt || "",
        finishedAt: order.finished_at || "",
        durationMinutes,
      }]
    })
    const averageExecutionMinutes = executionDurations.length
      ? Math.round(executionDurations.reduce((total, order) => total + order.durationMinutes, 0) / executionDurations.length)
      : 0
    orderCharts.executionTime = executionDurations

    const fieldTeams = todayOrders
      .filter((order) => order.main_provider_id)
      .map((order) => {
        const environment = environmentsMap.get(order.environment_id)
        const point = pointsMap.get(order.point_id)
        const location = [
          environment?.floor,
          environment?.final,
          environment?.environment_name,
          point?.point_name || (point?.point_number ? `Ponto ${point.point_number}` : ""),
        ].filter(Boolean).join(" / ")

        return {
          id: order.id,
          providerName: label(providers.get(order.main_provider_id), "Sem prestador"),
          orderNumber: order.order_number,
          clientName: label(clients.get(order.client_id), "Sem cliente"),
          location: location || "-",
          status: order.status || "-",
          updatedAt: order.updated_at || "",
        }
      })

    const [
      ordersWithoutProvider,
      ordersWithoutVehicle,
      delayedList,
      worksForAddressCheck,
      providersForPhoneCheck,
    ] = await Promise.all([
      scopeOrders(supabase.from("service_orders").select("order_number").is("main_provider_id", null).limit(5)),
      scopeOrders(supabase.from("service_orders").select("order_number").is("vehicle_id", null).limit(5)),
      scopeOrders(supabase.from("service_orders").select("order_number, scheduled_date, status").lt("scheduled_date", today).neq("status", "Finalizada").neq("status", "Cancelada").limit(5)),
      scopeWorks(supabase.from("works").select("name, street, city, status").eq("status", "Ativa").limit(50)),
      isClientUser ? Promise.resolve({ data: [] }) : supabase.from("providers").select("full_name, phone, status").eq("status", "Ativo").limit(50),
    ])

    const alerts = [
      ...((ordersWithoutProvider.data || []) as Row[]).map((order) => `${order.order_number} sem prestador vinculado`),
      ...((ordersWithoutVehicle.data || []) as Row[]).map((order) => `${order.order_number} sem veículo vinculado`),
      ...((delayedList.data || []) as Row[]).map((order) => `${order.order_number} atrasada desde ${order.scheduled_date}`),
      ...((worksForAddressCheck.data || []) as Row[])
        .filter((work) => !work.street || !work.city)
        .slice(0, 5)
        .map((work) => `${work.name} sem endereço completo`),
      ...((providersForPhoneCheck.data || []) as Row[])
        .filter((provider) => !provider.phone)
        .slice(0, 5)
        .map((provider) => `${provider.full_name} sem telefone cadastrado`),
    ]

    return NextResponse.json({
      metrics: {
        openOrders,
        inProgressOrders,
        finishedOrders,
        delayedOrders,
        activeWorks,
        environments,
        points,
        pausedOrders,
        averageExecutionMinutes,
        measuredExecutionOrders: executionDurations.length,
      },
      orderCharts,
      chartPeriod: { year: chartYear, month: chartMonth },
      executionPeriod,
      todayServices: servicesToday,
      fieldTeams,
      alerts: isClientUser ? [] : alerts,
      viewer: {
        role: profile.role,
        clientScoped: Boolean(scopedClientId),
        clientId: scopedClientId || null,
        clientName: selectedClient?.name || null,
      },
      availableClients: isClientUser ? (selectedClient ? [selectedClient] : []) : availableClients,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar dashboard operacional"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
