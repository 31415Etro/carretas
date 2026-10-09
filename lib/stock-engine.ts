import { createAdminClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"

type AdminClient = ReturnType<typeof createAdminClient>

export const stockMovementTypes = [
  "Entrada por compra",
  "Saida por venda",
  "Consumo em OS",
  "Consumo em kit",
  "Transferencia",
  "Devolucao",
  "Ajuste de inventario",
  "Perda",
  "Saldo inicial",
] as const

export type StockMovementType = (typeof stockMovementTypes)[number]

export type StockMovementInput = {
  materialId: string
  movementType: StockMovementType
  quantity: number
  fromWarehouseId?: string
  toWarehouseId?: string
  unitCost?: number | null
  occurredAt?: string
  responsible?: string
  documentReference?: string
  reason?: string
  notes?: string
  serviceOrderId?: string
  reservationId?: string
  lotNumber?: string
  serialNumber?: string
  expiryDate?: string
}

export const STOCK_MIGRATION_HINT = "Controle de estoque por movimentações ainda não instalado: rode scripts/202_estoque_movimentacoes.sql no Supabase."

export function isStockEngineMissing(message = "") {
  return /apply_stock_movement|stock_movements|stock_reservations|stock_balances|warehouses/.test(message)
    && /does not exist|Could not find|schema cache/i.test(message)
}

export function toMovement(row: any) {
  return {
    id: row.id,
    materialId: row.material_id,
    movementType: row.movement_type as StockMovementType,
    quantity: Number(row.quantity || 0),
    fromWarehouseId: row.from_warehouse_id || "",
    toWarehouseId: row.to_warehouse_id || "",
    unitCost: Number(row.unit_cost || 0),
    totalCost: Number(row.total_cost || 0),
    balanceAfter: row.balance_after === null || row.balance_after === undefined ? null : Number(row.balance_after),
    occurredAt: row.occurred_at,
    responsible: row.responsible || "",
    documentReference: row.document_reference || "",
    reason: row.reason || "",
    notes: row.notes || "",
    serviceOrderId: row.service_order_id || "",
    reservationId: row.reservation_id || "",
    lotNumber: row.lot_number || "",
    serialNumber: row.serial_number || "",
    expiryDate: row.expiry_date || "",
  }
}

/** Grava a movimentação pela função do banco (saldo, custo médio e histórico na mesma transação). */
export async function applyStockMovement(admin: AdminClient, input: StockMovementInput) {
  const { data, error } = await admin.rpc("apply_stock_movement", {
    p: {
      material_id: input.materialId,
      movement_type: input.movementType,
      quantity: input.quantity,
      from_warehouse_id: input.fromWarehouseId || "",
      to_warehouse_id: input.toWarehouseId || "",
      unit_cost: input.unitCost === null || input.unitCost === undefined || Number.isNaN(Number(input.unitCost)) ? "" : String(input.unitCost),
      occurred_at: input.occurredAt || "",
      responsible: input.responsible || "",
      document_reference: input.documentReference || "",
      reason: input.reason || "",
      notes: input.notes || "",
      service_order_id: input.serviceOrderId || "",
      reservation_id: input.reservationId || "",
      lot_number: input.lotNumber || "",
      serial_number: input.serialNumber || "",
      expiry_date: input.expiryDate || "",
    },
  })
  if (error) throw new Error(isStockEngineMissing(error.message) ? STOCK_MIGRATION_HINT : error.message)
  return toMovement(data)
}

type OrderMaterialRow = { material_id: string | null; expected_quantity: number | null; used_quantity: number | null; status: string | null }

function sumBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const totals = new Map<string, number>()
  rows.forEach((row) => {
    const id = key(row)
    if (!id) return
    totals.set(id, (totals.get(id) || 0) + value(row))
  })
  return totals
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Mantém o estoque coerente com a OS:
 * - OS aberta/em andamento: reserva as peças previstas (quantidade prevista dos materiais da OS);
 * - OS finalizada: dá baixa ("Consumo em OS") do que foi utilizado e encerra as reservas;
 * - OS cancelada: libera as reservas.
 * É idempotente: compara com reservas e consumos já registrados e só aplica a diferença.
 */
export async function syncStockForServiceOrder(admin: AdminClient, orderId: string, responsible = "Sistema") {
  const { data: order, error: orderError } = await admin.from("service_orders").select("id,order_number,status").eq("id", orderId).maybeSingle()
  if (orderError) throw new Error(`service_orders: ${orderError.message}`)
  if (!order?.id) return { warnings: [] as string[] }

  const reservationsResult = await admin.from("stock_reservations").select("id,material_id,warehouse_id,quantity,status").eq("service_order_id", orderId)
  if (reservationsResult.error) {
    if (isStockEngineMissing(reservationsResult.error.message)) return { warnings: [STOCK_MIGRATION_HINT] }
    throw new Error(`stock_reservations: ${reservationsResult.error.message}`)
  }
  const activeReservations = (reservationsResult.data || []).filter((row) => row.status === "Ativa")
  const warnings: string[] = []

  if (order.status === "Cancelada") {
    if (activeReservations.length) {
      const { error } = await admin.from("stock_reservations").update({ status: "Cancelada" }).in("id", activeReservations.map((row) => row.id))
      if (error) throw new Error(`stock_reservations: ${error.message}`)
    }
    return { warnings }
  }

  const orderMaterials = await readAllPages<OrderMaterialRow>((from, to) => admin
    .from("service_order_materials")
    .select("material_id,expected_quantity,used_quantity,status")
    .eq("service_order_id", orderId)
    .order("id")
    .range(from, to))
  const linked = orderMaterials.filter((row) => row.material_id && row.status !== "Devolvido")

  const { data: consumedRows, error: consumedError } = await admin
    .from("stock_movements")
    .select("material_id,quantity,movement_type")
    .eq("service_order_id", orderId)
    .in("movement_type", ["Consumo em OS", "Devolucao"])
  if (consumedError) throw new Error(`stock_movements: ${consumedError.message}`)
  const consumed = sumBy<any>(consumedRows || [], (row) => row.material_id, (row) => (row.movement_type === "Devolucao" ? -1 : 1) * Number(row.quantity || 0))

  if (order.status !== "Finalizada") {
    const expected = sumBy(linked, (row) => row.material_id || "", (row) => Number(row.expected_quantity || row.used_quantity || 0))
    const reserved = sumBy<any>(activeReservations, (row) => row.material_id, (row) => Number(row.quantity || 0))
    const materialIds = new Set([...expected.keys(), ...reserved.keys()])
    for (const materialId of materialIds) {
      // OS reaberta depois de finalizada: o que já saiu do estoque não é reservado de novo.
      const target = round3(Math.max(0, (expected.get(materialId) || 0) - (consumed.get(materialId) || 0)))
      if (round3(reserved.get(materialId) || 0) === target) continue
      // Quantidade mudou ou material saiu da OS: troca as reservas do item por uma com o total previsto.
      const stale = activeReservations.filter((row) => row.material_id === materialId).map((row) => row.id)
      if (stale.length) {
        const { error } = await admin.from("stock_reservations").update({ status: "Cancelada" }).in("id", stale)
        if (error) throw new Error(`stock_reservations: ${error.message}`)
      }
      if (target <= 0) continue
      const { error } = await admin.from("stock_reservations").insert({ material_id: materialId, service_order_id: orderId, quantity: target, responsible, notes: `Reserva automática da OS ${order.order_number}` })
      if (error) throw new Error(`stock_reservations: ${error.message}`)
    }
    return { warnings }
  }

  // OS finalizada: consumo = quantidade utilizada; sem registro de uso, vale o que estava reservado.
  const used = sumBy(linked, (row) => row.material_id || "", (row) => Number(row.used_quantity || 0))
  const reservedByMaterial = sumBy<any>(activeReservations, (row) => row.material_id, (row) => Number(row.quantity || 0))
  reservedByMaterial.forEach((quantity, materialId) => {
    if (!used.has(materialId) || !used.get(materialId)) used.set(materialId, quantity)
  })

  for (const [materialId, quantity] of used) {
    const missing = round3(quantity - (consumed.get(materialId) || 0))
    if (missing <= 0) continue
    const reservation = activeReservations.find((row) => row.material_id === materialId)
    try {
      await applyStockMovement(admin, {
        materialId,
        movementType: "Consumo em OS",
        quantity: missing,
        fromWarehouseId: reservation?.warehouse_id || "",
        responsible,
        documentReference: `OS ${order.order_number}`,
        reason: "Baixa automática na finalização da OS",
        serviceOrderId: orderId,
        reservationId: reservation?.id || "",
      })
    } catch (error) {
      // Não impede finalizar a OS; a baixa é refeita no próximo salvamento.
      warnings.push(error instanceof Error ? error.message : "Falha na baixa de estoque da OS.")
    }
  }

  if (activeReservations.length && !warnings.length) {
    const { error } = await admin.from("stock_reservations").update({ status: "Consumida" }).in("id", activeReservations.map((row) => row.id))
    if (error) throw new Error(`stock_reservations: ${error.message}`)
  }
  return { warnings }
}

/** Uso em rotas: não derruba o salvamento da OS por causa do estoque. */
export async function syncStockForServiceOrderSafely(admin: AdminClient, orderId: string, responsible = "Sistema") {
  try {
    const result = await syncStockForServiceOrder(admin, orderId, responsible)
    if (result.warnings.length) console.warn(`Estoque da OS ${orderId}:`, result.warnings.join(" | "))
    return result.warnings
  } catch (error) {
    console.error(`Estoque da OS ${orderId}`, error)
    return [error instanceof Error ? error.message : "Falha ao sincronizar estoque da OS."]
  }
}

export function toWarehouse(row: any) {
  return {
    id: row.id,
    code: row.code || "",
    name: row.name,
    address: row.address || "",
    responsible: row.responsible || "",
    isDefault: Boolean(row.is_default),
    status: row.status || "Ativo",
    notes: row.notes || "",
  }
}

/** OS novas ou com status diferente do banco. Chamar ANTES de gravar as OS. */
export async function serviceOrdersNeedingStockSync(admin: AdminClient, orders: Array<{ id: string; status: string }>) {
  const ids = orders.map((order) => order.id).filter(Boolean)
  const stored = new Map<string, string>()
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await admin.from("service_orders").select("id,status").in("id", ids.slice(index, index + 200))
    if (error) throw new Error(`service_orders: ${error.message}`)
    ;(data || []).forEach((row) => stored.set(row.id, row.status))
  }
  return orders.filter((order) => stored.get(order.id) !== order.status).map((order) => order.id)
}
