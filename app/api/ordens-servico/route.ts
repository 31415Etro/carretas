import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { createAdminClient, createClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { ensureReceivableForFinishedOrder } from "@/lib/service-order-receivables"
import { syncStockOrdersForServiceOrder } from "@/lib/stock-order-service-sync"

class OrderValidationError extends Error {}

function nullableUuid(value?: string | null) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null
}

async function authorizedCompanyClient() {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) throw new OrderValidationError("Nao autenticado.")

  const companyId = await getSelectedSystemCompanyId()
  const unscoped = createAdminClient({ bypassCompanyScope: true })
  const [{ data: company, error: companyError }, { data: profile, error: profileError }] = await Promise.all([
    unscoped.from("system_companies").select("id,active").eq("id", companyId).maybeSingle(),
    unscoped.from("profiles").select("role,active").eq("id", user.id).maybeSingle(),
  ])
  if (companyError || !company || company.active === false) throw new OrderValidationError("A empresa selecionada e invalida ou esta inativa.")
  if (profileError || !profile || profile.active === false) throw new OrderValidationError("Usuario sem permissao para criar OS.")
  if (profile.role === "client") throw new OrderValidationError("O acesso de cliente e somente leitura.")

  return { companyId, supabase: createAdminClient({ companyId }) }
}

async function requireCompanyRecord(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  id: string,
  label: string,
) {
  const { data, error } = await supabase.from(table).select("id").eq("id", id).maybeSingle()
  if (error) throw new Error(`${table}: ${error.message}`)
  if (!data) throw new OrderValidationError(`${label} nao pertence a empresa ativa. Troque a empresa no topo da tela e selecione novamente.`)
}

async function requireCompanyWork(
  supabase: ReturnType<typeof createAdminClient>,
  workId: string,
  clientId: string,
) {
  const { data, error } = await supabase.from("works").select("id,client_id").eq("id", workId).maybeSingle()
  if (error) throw new Error(`works: ${error.message}`)
  if (!data) throw new OrderValidationError("Obra nao pertence a empresa ativa. Troque a empresa no topo da tela e selecione novamente.")
  if (data.client_id !== clientId) throw new OrderValidationError("A obra selecionada nao pertence ao cliente informado.")
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, name: string, rows: any[]) {
  let currentRows = Array.from(new Map(rows.filter((row) => row?.id).map((row) => [row.id, row])).values())
  if (!currentRows.length) return

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

  throw new Error(`${name}: ${error?.message || "erro ao salvar"}`)
}

async function uniqueWorkCode(supabase: ReturnType<typeof createAdminClient>, row: any) {
  if (!row?.code) return row
  const { data, error } = await supabase.from("works").select("id, code").eq("code", row.code)
  if (error) throw new Error(`works: ${error.message}`)
  const sameCodeOtherWork = (data || []).some((item) => item.id !== row.id)
  if (!sameCodeOtherWork) return row

  const base = String(row.code || row.name || "OBRA").trim() || "OBRA"
  for (let index = 2; index < 500; index++) {
    const code = `${base}-${index}`
    const { data: existing, error: lookupError } = await supabase.from("works").select("id").eq("code", code).maybeSingle()
    if (lookupError) throw new Error(`works: ${lookupError.message}`)
    if (!existing || existing.id === row.id) return { ...row, code }
  }

  return { ...row, code: `${base}-${Date.now()}` }
}

async function upsertWorkRow(supabase: ReturnType<typeof createAdminClient>, row: any) {
  let current = await uniqueWorkCode(supabase, row)
  try {
    await upsertRows(supabase, "works", [current])
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ""
    if (!message.includes("duplicate") && !message.includes("works_code_key") && !message.includes("code")) throw error
    current = await uniqueWorkCode(supabase, { ...current, code: `${current.code}-1` })
    await upsertRows(supabase, "works", [current])
  }
  return current
}

async function resolveOperationalWork(
  supabase: ReturnType<typeof createAdminClient>,
  order: any,
  work: any,
) {
  const workType = order.orderType === "pmoc" ? "PMOC" : "Servicos diversos"
  const suppliedWork = mapWork(work, order.clientId)

  if (suppliedWork) {
    const savedWork = await upsertWorkRow(supabase, suppliedWork)
    return savedWork.id
  }

  const requestedWorkId = nullableUuid(order.workId)
  if (requestedWorkId) {
    const { data: requestedWork, error: requestedWorkError } = await supabase
      .from("works")
      .select("id, client_id")
      .eq("id", requestedWorkId)
      .maybeSingle()

    if (requestedWorkError) throw new Error(`works: ${requestedWorkError.message}`)
    if (requestedWork?.client_id === order.clientId) return requestedWork.id
  }

  const { data: existingWorks, error: existingWorkError } = await supabase
    .from("works")
    .select("id")
    .eq("client_id", order.clientId)
    .eq("type", workType)
    .limit(1)

  if (existingWorkError) throw new Error(`works: ${existingWorkError.message}`)
  if (existingWorks?.[0]?.id) return existingWorks[0].id

  const generatedWork = await upsertWorkRow(supabase, {
    id: requestedWorkId || randomUUID(),
    client_id: order.clientId,
    code: `${order.orderType === "pmoc" ? "PMOC" : "OS-SD"}-${String(order.clientId).slice(0, 8)}`,
    name: `${workType} - Cliente`,
    type: workType,
    status: "Ativa",
    notes: `Local operacional criado automaticamente para OS de ${workType}.`,
  })

  return generatedWork.id
}

async function ensureWorkFloorRow(supabase: ReturnType<typeof createAdminClient>, row: any) {
  if (!row?.id || !nullableUuid(row.id) || !nullableUuid(row.work_id)) return null

  const name = String(row.name || "Pavimento").trim() || "Pavimento"
  const normalizedRow = { ...row, name }

  const { data: sameId, error: sameIdError } = await supabase
    .from("work_floors")
    .select("id")
    .eq("id", normalizedRow.id)
    .maybeSingle()

  if (sameIdError) throw new Error(`work_floors: ${sameIdError.message}`)
  if (sameId) {
    await upsertRows(supabase, "work_floors", [normalizedRow])
    return normalizedRow
  }

  const { data: sameName, error: sameNameError } = await supabase
    .from("work_floors")
    .select("id")
    .eq("work_id", normalizedRow.work_id)
    .eq("name", name)
    .maybeSingle()

  if (sameNameError) throw new Error(`work_floors: ${sameNameError.message}`)

  if (sameName?.id) {
    const { error: updateError } = await supabase
      .from("work_floors")
      .update({ status: normalizedRow.status, notes: normalizedRow.notes })
      .eq("id", sameName.id)

    if (updateError) throw new Error(`work_floors: ${updateError.message}`)
    return { ...normalizedRow, id: sameName.id }
  }

  await upsertRows(supabase, "work_floors", [normalizedRow])
  return normalizedRow
}

async function ensureWorkPointRow(supabase: ReturnType<typeof createAdminClient>, row: any) {
  if (!row?.id || !nullableUuid(row.id) || !nullableUuid(row.work_id) || !nullableUuid(row.environment_id)) return null

  const pointNumber = Number(row.point_number || 0)
  const normalizedRow = { ...row, point_number: pointNumber }

  const { data: sameId, error: sameIdError } = await supabase
    .from("work_points")
    .select("id")
    .eq("id", normalizedRow.id)
    .maybeSingle()

  if (sameIdError) throw new Error(`work_points: ${sameIdError.message}`)
  if (sameId) {
    await upsertRows(supabase, "work_points", [normalizedRow])
    return normalizedRow
  }

  const { data: sameNumber, error: sameNumberError } = await supabase
    .from("work_points")
    .select("id")
    .eq("environment_id", normalizedRow.environment_id)
    .eq("point_number", pointNumber)
    .maybeSingle()

  if (sameNumberError) throw new Error(`work_points: ${sameNumberError.message}`)

  if (sameNumber?.id) {
    const { error: updateError } = await supabase
      .from("work_points")
      .update({
        work_id: normalizedRow.work_id,
        point_name: normalizedRow.point_name,
        service_type_id: normalizedRow.service_type_id,
        status: normalizedRow.status,
        equipment_expected: normalizedRow.equipment_expected,
        btus: normalizedRow.btus,
        brand: normalizedRow.brand,
        model: normalizedRow.model,
        serial_number: normalizedRow.serial_number,
        evaporator_location: normalizedRow.evaporator_location,
        condenser_location: normalizedRow.condenser_location,
        has_drain: normalizedRow.has_drain,
        has_electric_point: normalizedRow.has_electric_point,
        has_piping: normalizedRow.has_piping,
        infrastructure_measure: normalizedRow.infrastructure_measure,
        measurement_confirmation: normalizedRow.measurement_confirmation,
        technical_notes: normalizedRow.technical_notes,
      })
      .eq("id", sameNumber.id)

    if (updateError) throw new Error(`work_points: ${updateError.message}`)
    return { ...normalizedRow, id: sameNumber.id }
  }

  await upsertRows(supabase, "work_points", [normalizedRow])
  return normalizedRow
}

function mapWork(work: any, clientId: string) {
  if (!work?.id || !nullableUuid(work.id) || !nullableUuid(clientId || work.clientId)) return null
  return {
    id: work.id,
    client_id: clientId || work.clientId,
    code: work.uniqueNumber || work.code || work.name || "ORC",
    name: work.name || "Obra",
    type: work.type || "Orçamento",
    status: work.status || "Ativa",
    zip_code: work.zipCode || "",
    street: work.street || "",
    number: work.number || "",
    complement: work.complement || "",
    district: work.district || "",
    city: work.city || "",
    state: work.state || "",
    responsible_name: work.responsibleName || "",
    responsible_phone: work.responsiblePhone || "",
    responsible_email: work.responsibleEmail || "",
    responsible_role: work.responsibleRole || "",
    notes: work.notes || "",
  }
}

function mapOrder(order: any) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    order_type: order.orderType || "obra",
    service_category: order.serviceCategory || "",
    client_id: order.clientId,
    work_id: order.workId,
    client_environment_id: nullableUuid(order.clientEnvironmentId),
    client_equipment_id: nullableUuid(order.clientEquipmentId),
    floor_id: nullableUuid(order.floorId),
    environment_id: nullableUuid(order.environmentId),
    point_id: nullableUuid(order.pointId),
    service_type_id: nullableUuid(order.serviceTypeId),
    simple_service: Boolean(order.simpleService),
    priority: order.priority || "Media",
    description: order.description || "",
    scheduled_date: order.scheduledDate || null,
    scheduled_start_time: order.scheduledStartTime || null,
    scheduled_end_time: order.scheduledEndTime || null,
    estimated_duration: order.estimatedDuration || "",
    allow_reschedule: Boolean(order.allowReschedule),
    schedule_notes: order.scheduleNotes || "",
    main_provider_id: nullableUuid(order.mainProviderId),
    helper_provider_id: nullableUuid(order.helperProviderId),
    supervisor_id: nullableUuid(order.supervisorId),
    vehicle_id: nullableUuid(order.vehicleId),
    initial_km: Number(order.initialKm || 0),
    final_km: Number(order.finalKm || 0),
    total_amount: Number(order.totalAmount || 0),
    payment_method: order.paymentMethod || "",
    payment_type: order.paymentType || "",
    payment_term: order.paymentTerm || "",
    payment_due_date: order.paymentDueDate || null,
    financial_notes: order.financialNotes || "",
    status: order.status || "Criada",
    customer_responsible_name: order.customerResponsibleName || "",
    customer_responsible_phone: order.customerResponsiblePhone || "",
    team_notes: order.teamNotes || "",
    notes: order.notes || "",
    pause_reason: order.pauseReason || "",
    cancellation_reason: order.cancellationReason || "",
    partial_reason: order.partialReason || "",
    finished_at: order.finishedAt || null,
    cancelled_at: order.cancelledAt || null,
  }
}

async function ensureUniqueOrderNumber(supabase: ReturnType<typeof createAdminClient>, order: any) {
  let orderNumber = String(order.orderNumber || "").trim()
  if (!orderNumber) orderNumber = "OS-0001"

  const match = orderNumber.match(/^(.*?)(\d+)$/)
  const prefix = match?.[1] || `${orderNumber}-`
  const width = match?.[2]?.length || 4
  let counter = match ? Number(match[2]) : 1

  for (let attempt = 0; attempt < 200; attempt++) {
    const { data, error } = await supabase
      .from("service_orders")
      .select("id")
      .eq("order_number", orderNumber)
      .maybeSingle()

    if (error) throw new Error(`service_orders: ${error.message}`)
    if (!data || data.id === order.id) return { ...order, orderNumber }

    counter += 1
    orderNumber = `${prefix}${String(counter).padStart(width, "0")}`
  }

  return { ...order, orderNumber: `${prefix}${Date.now()}` }
}

export async function POST(request: Request) {
  try {
    const { companyId, supabase } = await authorizedCompanyClient()
    const body = await request.json()
    const { order, work, floor, environment, point, checklistItems = [], serviceOrderMaterials = [], materialUpdates = [], auditDescription, includeChildren = false } = body

    if (!order?.id || !nullableUuid(order.id)) throw new OrderValidationError("OS sem ID valido.")
    if (!nullableUuid(order.clientId)) throw new OrderValidationError("Cliente invalido na OS.")

    await requireCompanyRecord(supabase, "clients", order.clientId, "Cliente")
    if (nullableUuid(order.serviceTypeId)) await requireCompanyRecord(supabase, "service_types", order.serviceTypeId, "Tipo de servico")
    if (nullableUuid(order.clientEnvironmentId)) await requireCompanyRecord(supabase, "client_environments", order.clientEnvironmentId, "Ambiente do cliente")
    if (nullableUuid(order.clientEquipmentId)) await requireCompanyRecord(supabase, "client_equipment", order.clientEquipmentId, "Equipamento do cliente")
    const savedOrder = await ensureUniqueOrderNumber(supabase, order)
    const workRow = mapWork(work, savedOrder.clientId)
    if (savedOrder.orderType === "obra") {
      if (!nullableUuid(savedOrder.workId)) throw new OrderValidationError("Obra invalida na OS.")
      await requireCompanyWork(supabase, savedOrder.workId, savedOrder.clientId)
      if (workRow) await upsertWorkRow(supabase, workRow)
    } else {
      savedOrder.workId = await resolveOperationalWork(supabase, savedOrder, work)
    }

    if (!nullableUuid(savedOrder.workId)) throw new OrderValidationError("Local operacional invalido na OS.")

    let savedFloor = null as any
    if (floor?.id && nullableUuid(floor.id) && nullableUuid(floor.workId || savedOrder.workId)) {
      savedFloor = await ensureWorkFloorRow(supabase, {
        id: floor.id,
        work_id: floor.workId || savedOrder.workId,
        name: floor.name || "Pavimento",
        status: floor.status || "Ativo",
        notes: floor.notes || "",
      })
      if (savedFloor?.id && savedOrder.floorId === floor.id) savedOrder.floorId = savedFloor.id
    }

    let savedEnvironment = null as any
    if (environment?.id && nullableUuid(environment.id) && nullableUuid(environment.workId || savedOrder.workId)) {
      await upsertRows(supabase, "work_environments", [{
        id: environment.id,
        work_id: environment.workId || savedOrder.workId,
        floor_id: nullableUuid(savedFloor?.id || environment.floorId || savedOrder.floorId),
        floor: environment.floor || "",
        final: environment.final || "",
        environment_name: environment.environmentName || "Ambiente",
        service_type_id: nullableUuid(environment.serviceTypeId),
        points_quantity: Number(environment.pointsQuantity || 0),
        status: environment.status || "Ativo",
        notes: environment.notes || "",
      }])
      savedEnvironment = environment
      if (savedOrder.environmentId !== environment.id) savedOrder.environmentId = environment.id
    }

    let savedPoint = null as any
    if (point?.id && nullableUuid(point.id) && nullableUuid(point.workId || savedOrder.workId) && nullableUuid(point.environmentId || savedOrder.environmentId)) {
      const pointEnvironmentId = nullableUuid(savedEnvironment?.id || point.environmentId || savedOrder.environmentId)
      savedPoint = await ensureWorkPointRow(supabase, {
        id: point.id,
        work_id: point.workId || savedOrder.workId,
        environment_id: pointEnvironmentId,
        point_number: Number(point.pointNumber || 0),
        point_name: point.pointName || "Ponto",
        service_type_id: nullableUuid(point.serviceTypeId || savedOrder.serviceTypeId),
        status: point.status || "Ativo",
        equipment_expected: point.equipmentExpected || "",
        btus: point.btus || "",
        brand: point.brand || "",
        model: point.model || "",
        serial_number: point.serialNumber || "",
        evaporator_location: point.evaporatorLocation || "",
        condenser_location: point.condenserLocation || "",
        has_drain: Boolean(point.hasDrain),
        has_electric_point: Boolean(point.hasElectricPoint),
        has_piping: Boolean(point.hasPiping),
        infrastructure_measure: point.infrastructureMeasure || "",
        measurement_confirmation: point.measurementConfirmation || "",
        technical_notes: point.technicalNotes || "",
      })
      if (savedPoint?.id && savedOrder.pointId === point.id) savedOrder.pointId = savedPoint.id
    }

    try {
      await upsertRows(supabase, "service_orders", [mapOrder(savedOrder)])
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.toLowerCase().includes("duplicate") && !message.toLowerCase().includes("order_number")) throw error
      const retryOrder = await ensureUniqueOrderNumber(supabase, { ...savedOrder, orderNumber: `${savedOrder.orderNumber}-1` })
      Object.assign(savedOrder, retryOrder)
      await upsertRows(supabase, "service_orders", [mapOrder(savedOrder)])
    }

    if (includeChildren) {
      await upsertRows(supabase, "service_order_checklist_items", checklistItems.map((item: any) => ({
        id: item.id,
        service_order_id: savedOrder.id,
        task_name: item.taskName,
        required: Boolean(item.required),
        requires_photo: Boolean(item.requiresPhoto),
        status: item.status || "Pendente",
        responsible_provider_id: nullableUuid(item.responsibleProviderId),
        notes: item.notes || "",
        completed_at: item.completedAt || null,
      })))

      await upsertRows(supabase, "service_order_materials", serviceOrderMaterials.map((item: any) => ({
        id: item.id,
        service_order_id: savedOrder.id,
        material_id: nullableUuid(item.materialId),
        item_name: item.itemName,
        expected_quantity: Number(item.expectedQuantity || 0),
        used_quantity: Number(item.usedQuantity || 0),
        unit: item.unit || "unidade",
        status: item.status || "Utilizado",
        notes: item.notes || "",
      })))

      await upsertRows(supabase, "materials", materialUpdates.map((item: any) => ({
        id: item.id,
        name: item.name,
        category: item.category || "",
        unit: item.unit || "unidade",
        internal_code: item.internalCode || "",
        minimum_stock: Number(item.minimumStock || 0),
        current_stock: Number(item.currentStock || 0),
        composes_kit: Boolean(item.composesKit),
        status: item.status || "Ativo",
        notes: item.notes || "",
      })))
    }

    await upsertRows(supabase, "audit_logs", [{
      id: randomUUID(),
      user_id: null,
      entity_type: "service_order",
      entity_id: savedOrder.id,
      action: includeChildren ? "Criada" : "Editada",
      description: auditDescription || `${savedOrder.orderNumber} salva`,
    }])

    if (savedOrder.status === "Finalizada") await ensureReceivableForFinishedOrder(supabase, savedOrder.id)
    await syncStockOrdersForServiceOrder(supabase, savedOrder)

    return NextResponse.json({ data: savedOrder, companyId })
  } catch (error) {
    const status = error instanceof OrderValidationError
      ? error.message === "Nao autenticado." ? 401 : error.message.includes("somente leitura") || error.message.includes("sem permissao") ? 403 : 400
      : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar OS" }, { status })
  }
}
