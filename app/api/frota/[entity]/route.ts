import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { fleetEntities, fleetError, listFleet, saveFleetItem } from "@/lib/fleet-server"

type Params = { params: Promise<{ entity: string }> }

const bad = (error: unknown, fallback: string) => {
  const { message, status } = fleetError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request, { params }: Params) {
  const { entity } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  if (!fleetEntities.includes(entity)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 })
  try {
    const vehicleId = new URL(request.url).searchParams.get("vehicleId") || undefined
    return NextResponse.json({ items: await listFleet(context.admin, entity, { vehicleId }) })
  } catch (error) {
    return bad(error, "Erro ao carregar dados da frota.")
  }
}

export async function POST(request: Request, { params }: Params) {
  const { entity } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { item } = await request.json()
    return NextResponse.json({ item: await saveFleetItem(context.admin, entity, item || {}, context.responsible) })
  } catch (error) {
    return bad(error, "Erro ao salvar.")
  }
}

/** Exclusão só para documentos e pneus; veículos, motoristas e lançamentos são inativados/cancelados. */
export async function DELETE(request: Request, { params }: Params) {
  const { entity } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  const table = ({ documents: "vehicle_documents", tires: "vehicle_tires" } as Record<string, string>)[entity]
  const id = new URL(request.url).searchParams.get("id")
  if (!table || !id) return NextResponse.json({ error: "Exclusão não permitida para este cadastro." }, { status: 400 })
  const { error } = await context.admin.from(table).delete().eq("id", id)
  if (error) return bad(error, "Erro ao excluir.")
  return NextResponse.json({ ok: true })
}
