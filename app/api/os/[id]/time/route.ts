import { NextResponse } from "next/server"
import { recalculateOs } from "@/lib/os-server"
import { stockContext } from "@/lib/stock-api"

const blocked = new Set(["Entregue", "Cancelada"])

async function guard(admin: any, id: string) {
  const { data, error } = await admin.from("service_orders").select("status").eq("id", id).single()
  if (error) throw new Error(error.message)
  if (blocked.has(data.status)) throw new Error(`OS ${data.status.toLowerCase()} não recebe apontamento de horas.`)
}

/** Apontamento de horas trabalhadas (com custo/hora para a margem). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const id = (await params).id
    const body = await request.json() as { providerId?: string; workDate?: string; hours: number; hourlyCost: number; notes?: string }
    const hours = Number(body.hours)
    if (!(hours > 0 && hours <= 24)) return NextResponse.json({ error: "Horas devem ficar entre 0 e 24 por apontamento." }, { status: 400 })
    if (Number(body.hourlyCost) < 0) return NextResponse.json({ error: "Custo/hora inválido." }, { status: 400 })
    await guard(context.admin, id)
    const { error } = await context.admin.from("service_order_time_entries").insert({ service_order_id: id, provider_id: body.providerId || null, work_date: body.workDate || new Date().toISOString().slice(0, 10), hours, hourly_cost: Number(body.hourlyCost || 0), notes: body.notes || "", created_by: context.responsible })
    if (error) throw new Error(error.message)
    return NextResponse.json({ totals: await recalculateOs(context.admin, id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao apontar horas." }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const id = (await params).id
    const entryId = new URL(request.url).searchParams.get("entryId")
    await guard(context.admin, id)
    const { error } = await context.admin.from("service_order_time_entries").delete().eq("id", entryId).eq("service_order_id", id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ totals: await recalculateOs(context.admin, id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao remover apontamento." }, { status: 400 })
  }
}
