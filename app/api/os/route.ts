import { NextResponse } from "next/server"
import { isMissing, OS_MIGRATION_HINT, saveOs, type OsInput } from "@/lib/os-server"
import { stockContext } from "@/lib/stock-api"
import { readAllPages } from "@/lib/supabase-pagination"

const fail = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback
  return NextResponse.json({ error: isMissing(message) ? OS_MIGRATION_HINT : message }, { status: isMissing(message) ? 503 : 400 })
}

/** Lista de OS com cliente, carreta e técnico. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const orders = await readAllPages<any>((from, to) => context.admin.from("service_orders").select("*").order("created_at", { ascending: false }).order("id").range(from, to))
    const clientIds = Array.from(new Set(orders.map((row) => row.client_id).filter(Boolean)))
    const assetIds = Array.from(new Set(orders.map((row) => row.customer_asset_id).filter(Boolean)))
    const providerIds = Array.from(new Set(orders.map((row) => row.main_provider_id).filter(Boolean)))
    const lookup = async (table: string, ids: string[], columns: string) => {
      const rows: any[] = []
      for (let index = 0; index < ids.length; index += 200) {
        const { data } = await context.admin.from(table).select(columns).in("id", ids.slice(index, index + 200))
        rows.push(...(data || []))
      }
      return new Map(rows.map((row) => [row.id, row]))
    }
    const [clients, assets, providers] = await Promise.all([
      lookup("clients", clientIds, "id,name"),
      lookup("customer_assets", assetIds, "id,identification,plate"),
      lookup("providers", providerIds, "id,full_name"),
    ])
    return NextResponse.json({
      orders: orders.map((row) => ({
        id: row.id, orderNumber: row.order_number, status: row.status, orderKind: row.order_kind || "", priority: row.priority,
        clientName: clients.get(row.client_id)?.name || "-",
        asset: assets.get(row.customer_asset_id) ? [assets.get(row.customer_asset_id).identification, assets.get(row.customer_asset_id).plate].filter(Boolean).join(" · ") : "",
        technician: providers.get(row.main_provider_id)?.full_name || "-",
        description: row.description || "", openedAt: row.created_at, plannedStart: row.scheduled_date || "", dueDate: row.due_date || "",
        finishedAt: row.finished_at || "", totalAmount: Number(row.total_amount || 0), costAmount: Number(row.cost_amount || 0),
      })),
    })
  } catch (error) {
    return fail(error, "Erro ao carregar OS.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { order } = await request.json() as { order: OsInput }
    return NextResponse.json(await saveOs(context.admin, order, context.responsible))
  } catch (error) {
    return fail(error, "Erro ao salvar OS.")
  }
}
