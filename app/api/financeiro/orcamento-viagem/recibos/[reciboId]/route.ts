import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { advanceError, reviewReceipt } from "@/lib/travel-advance-server"

/** O financeiro aprova ou contesta uma notinha. action: "aprovar" | "contestar" (com observação). */
export async function PATCH(request: Request, { params }: { params: Promise<{ reciboId: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { reciboId } = await params
    const body = await request.json()
    const action = body.action === "contestar" ? "contestar" : "aprovar"
    const result = await reviewReceipt(context.admin, reciboId, action, String(body.note || ""), context.responsible)
    return NextResponse.json({ ok: true, advanceId: result.advanceId })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao revisar o registro.").message }, { status: 400 })
  }
}
