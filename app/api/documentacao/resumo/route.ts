import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { docError, documentationSummary } from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Andamento da documentação veicular de uma oportunidade (?oportunidade=<id>) ou de um pedido (?pedido=<id>). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const params = new URL(request.url).searchParams
  const opportunityId = params.get("oportunidade") || ""
  const orderId = params.get("pedido") || ""
  if ((opportunityId && !uuid.test(opportunityId)) || (orderId && !uuid.test(orderId)) || (!opportunityId && !orderId)) return NextResponse.json({ error: "Informe a oportunidade ou o pedido." }, { status: 400 })
  try {
    return NextResponse.json({ summary: await documentationSummary(context.admin, { opportunityId: opportunityId || undefined, orderId: orderId || undefined }) })
  } catch (error) {
    const mapped = docError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
