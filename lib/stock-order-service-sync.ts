function selectedPointIds(notes?: string | null) {
  const marker = "Selecoes OS JSON:"
  const source = String(notes || "")
  const start = source.indexOf(marker)
  if (start < 0) return [] as string[]
  try {
    const parsed = JSON.parse(source.slice(start + marker.length).trim())
    return Array.isArray(parsed?.pointIds) ? parsed.pointIds.filter((id: unknown) => typeof id === "string") : []
  } catch {
    return [] as string[]
  }
}

function isMissingStockTable(message = "") {
  return /does not exist|schema cache|relation|Could not find the table/i.test(message)
}

export async function releaseStockOrdersForServiceOrder(supabase: any, serviceOrderId: string) {
  const { error } = await supabase
    .from("stock_service_orders")
    .update({ status: "Aberto", linked_service_order_id: null, used_at: null })
    .eq("linked_service_order_id", serviceOrderId)
  if (error && !isMissingStockTable(error.message)) throw new Error(`stock_service_orders: ${error.message}`)
}

export async function syncStockOrdersForServiceOrder(supabase: any, order: any) {
  const serviceOrderId = String(order?.id || "")
  if (!serviceOrderId || String(order?.orderType || order?.order_type || "") !== "obra") return

  await releaseStockOrdersForServiceOrder(supabase, serviceOrderId)
  if (String(order?.status || "") !== "Finalizada") return

  const pointIds = Array.from(new Set([
    ...selectedPointIds(order?.notes),
    order?.pointId || order?.point_id || "",
  ].filter(Boolean)))
  if (!pointIds.length) return

  for (let index = 0; index < pointIds.length; index += 200) {
    const { error } = await supabase
      .from("stock_service_orders")
      .update({ status: "Usada", linked_service_order_id: serviceOrderId, used_at: new Date().toISOString() })
      .in("budget_point_id", pointIds.slice(index, index + 200))
    if (error && !isMissingStockTable(error.message)) throw new Error(`stock_service_orders: ${error.message}`)
  }
}
