import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { stockContext } from "@/lib/stock-api"
import { fleetError } from "@/lib/fleet-server"

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { data, error } = await context.admin.from("fleet_settings").select("road_transport").eq("id", true).maybeSingle()
  if (error) {
    const { message, status } = fleetError(error, "Erro ao carregar configuração.")
    return NextResponse.json({ error: message }, { status })
  }
  const [units, orders] = await Promise.all([
    context.admin.from("system_companies").select("id,name,trade_name,cnpj").eq("active", true).order("name"),
    context.admin.from("service_orders").select("id,order_number").order("created_at", { ascending: false }).limit(300),
  ])
  return NextResponse.json({
    roadTransport: Boolean(data?.road_transport),
    units: (units.data || []).map((row) => ({ id: row.id, name: row.trade_name || row.name, cnpj: row.cnpj || "" })),
    orders: (orders.data || []).map((row) => ({ id: row.id, number: row.order_number || "" })),
  })
}

/** Liga/desliga as abas de transporte rodoviário (pneus, engate, viagens). Só administrador/gerente. */
export async function PUT(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { role } = await currentUserRole()
  if (role !== "admin" && role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente altera esta configuração." }, { status: 403 })
  const { roadTransport } = await request.json()
  const { error } = await context.admin.from("fleet_settings").upsert({ id: true, road_transport: Boolean(roadTransport) }, { onConflict: "id" })
  if (error) {
    const { message, status } = fleetError(error, "Erro ao salvar configuração.")
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ roadTransport: Boolean(roadTransport) })
}
