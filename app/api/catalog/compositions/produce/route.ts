import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

/** Montagem/fabricação: baixa os componentes e dá entrada no produto final (função produce_composition). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const body = await request.json()
  if (!body.compositionId || !(Number(body.quantity) > 0)) return NextResponse.json({ error: "Informe a composição e a quantidade." }, { status: 400 })
  const { data, error } = await context.admin.rpc("produce_composition", {
    p: {
      composition_id: body.compositionId,
      quantity: Number(body.quantity),
      from_warehouse_id: body.fromWarehouseId || "",
      to_warehouse_id: body.toWarehouseId || "",
      lot_number: body.lotNumber || "",
      serial_number: body.serialNumber || "",
      document_reference: body.documentReference || "",
      notes: body.notes || "",
      responsible: context.responsible,
    },
  })
  if (error) {
    const missing = /does not exist|Could not find|schema cache/i.test(error.message)
    return NextResponse.json({ error: missing ? "Montagem ainda não instalada: rode scripts/205_catalogo_produtos_servicos.sql no Supabase." : error.message }, { status: missing ? 503 : 400 })
  }
  return NextResponse.json({ result: data })
}
