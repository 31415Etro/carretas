import { NextResponse } from "next/server"
import { stockContext, stockError } from "@/lib/stock-api"
import { readAllPages } from "@/lib/supabase-pagination"

function toReservation(row: any) {
  return {
    id: row.id,
    materialId: row.material_id,
    materialName: row.material?.name || "",
    unit: row.material?.unit || "",
    warehouseId: row.warehouse_id || "",
    serviceOrderId: row.service_order_id || "",
    orderNumber: row.order?.order_number || "",
    quantity: Number(row.quantity || 0),
    status: row.status,
    responsible: row.responsible || "",
    notes: row.notes || "",
    createdAt: row.created_at,
  }
}

export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const status = new URL(request.url).searchParams.get("status") || "Ativa"
    const rows = await readAllPages<any>((from, to) => context.admin
      .from("stock_reservations")
      .select("*, material:materials(name,unit)")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to))
    const orderIds = Array.from(new Set(rows.map((row) => row.service_order_id).filter(Boolean)))
    const orders = new Map<string, string>()
    for (let index = 0; index < orderIds.length; index += 200) {
      const { data } = await context.admin.from("service_orders").select("id,order_number").in("id", orderIds.slice(index, index + 200))
      ;(data || []).forEach((order) => orders.set(order.id, order.order_number))
    }
    return NextResponse.json({ reservations: rows.map((row) => toReservation({ ...row, order: { order_number: orders.get(row.service_order_id) || "" } })) })
  } catch (error) {
    return stockError(error, "Erro ao carregar reservas.")
  }
}

/** action "reserve": reserva manual (checa saldo disponível); action "cancel": libera a reserva. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    if (body.action === "cancel") {
      const { error } = await context.admin.from("stock_reservations").update({ status: "Cancelada" }).eq("id", body.id).eq("status", "Ativa")
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    const quantity = Number(body.quantity)
    if (!body.materialId || !(quantity > 0)) return NextResponse.json({ error: "Informe item e quantidade maior que zero." }, { status: 400 })
    const { data: material, error: materialError } = await context.admin.from("materials").select("name,current_stock,reserved_stock").eq("id", body.materialId).single()
    if (materialError) throw new Error(materialError.message)
    const available = Number(material.current_stock || 0) - Number(material.reserved_stock || 0)
    if (quantity > available) return NextResponse.json({ error: `Disponível de ${material.name}: ${available}. Não é possível reservar ${quantity}.` }, { status: 400 })
    const { data, error } = await context.admin.from("stock_reservations").insert({
      material_id: body.materialId,
      warehouse_id: body.warehouseId || null,
      service_order_id: body.serviceOrderId || null,
      quantity,
      responsible: context.responsible,
      notes: body.notes || "",
    }).select("*, material:materials(name,unit)").single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ reservation: toReservation(data) })
  } catch (error) {
    return stockError(error, "Erro ao salvar reserva.")
  }
}
