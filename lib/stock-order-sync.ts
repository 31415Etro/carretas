import { readAllPages } from "./supabase-pagination.ts"

// Insert only missing labels: an existing production order owns its status and checkboxes.
export async function backfillStockOrders(supabase: any) {
  const existing = await readAllPages<any>((from, to) => supabase.from("stock_service_orders")
    .select("budget_point_id,id").order("id").range(from, to))
  const existingIds = new Set(existing.map((row) => row.budget_point_id))
  const points = await readAllPages<any>((from, to) => supabase.from("budget_points")
    .select("id,name,kit_id,kit_name,infrastructure_measure,environment:budget_environments!inner(name,final:budget_service_types!inner(name,floor:budget_floors!inner(name,tower:budget_towers!inner(name,work:budget_works!inner(id,name))))),kit:stock_kits(name)")
    .order("id").range(from, to))
  const rows = points.filter((point) => !existingIds.has(point.id) && (point.kit_id || String(point.kit_name || "").trim())).map((point) => {
    const environment = point.environment
    const final = environment.final
    const floor = final.floor
    const tower = floor.tower
    const work = tower.work
    return {
      budget_point_id: point.id, budget_work_id: work.id, kit_id: point.kit_id,
      work_name: work.name || "", tower_name: tower.name || "", floor_name: floor.name || "",
      final_name: final.name || "", environment_name: environment.name || "", point_name: point.name || "",
      kit_name: point.kit_name || point.kit?.name || "", infrastructure_measure: point.infrastructure_measure || "",
    }
  })
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase.from("stock_service_orders").upsert(rows.slice(index, index + 200), {
      onConflict: "budget_point_id", ignoreDuplicates: true,
    })
    if (error) throw new Error(`stock_service_orders: ${error.message}`)
  }
  return rows.length
}
