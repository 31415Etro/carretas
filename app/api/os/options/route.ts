import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { readAllPages } from "@/lib/supabase-pagination"

/** Listas do formulário de OS: clientes, serviços, técnicos, peças e frota própria. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const [clients, services, providers, materials, vehicles] = await Promise.all([
      readAllPages<any>((from, to) => context.admin.from("clients").select("id,name,document").order("name").order("id").range(from, to)),
      context.admin.from("service_types").select("*").eq("status", "Ativo").order("name"),
      context.admin.from("providers").select("id,full_name,status").order("full_name"),
      readAllPages<any>((from, to) => context.admin.from("materials").select("*").eq("status", "Ativo").order("name").order("id").range(from, to)),
      context.admin.from("vehicles").select("id,plate,model,status").order("plate"),
    ])
    return NextResponse.json({
      clients: clients.map((row) => ({ id: row.id, name: row.name, document: row.document || "" })),
      services: (services.data || []).map((row) => ({ id: row.id, name: row.name, code: row.code || "", unit: row.billing_unit || "Servico", price: Number(row.default_price || 0), warrantyDays: Number(row.warranty_days || 0) })),
      providers: (providers.data || []).filter((row) => row.status !== "Inativo").map((row) => ({ id: row.id, name: row.full_name })),
      materials: materials.map((row) => ({ id: row.id, name: row.name, code: row.internal_code || "", unit: row.unit, price: Number(row.sale_price || 0), cost: Number(row.average_cost || row.cost_price || 0), stock: Number(row.current_stock || 0), reserved: Number(row.reserved_stock || 0), controlsStock: row.controls_stock !== false })),
      vehicles: (vehicles.data || []).map((row) => ({ id: row.id, name: `${row.plate} - ${row.model}` })),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar opções." }, { status: 400 })
  }
}
