import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { generatePurchaseRequest, listPurchaseRequests, salesError, setPurchaseRequestStatus } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = salesError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

/** Solicitações de compra da empresa (?status=Pendente|Aprovada|...). Nunca emitem pedido ao fornecedor sozinhas. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await listPurchaseRequests(context.admin, new URL(request.url).searchParams.get("status") || "") })
  } catch (error) {
    return fail(error)
  }
}

/** Gera UMA solicitação consolidada com as faltas de todas as ordens abertas (o que já está solicitado ou em compra não é pedido de novo). */
export async function POST() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ request_id: await generatePurchaseRequest(context.admin, context.responsible) }, { status: 201 })
  } catch (error) {
    return fail(error)
  }
}

/** Aprova, rejeita ou cancela. Corpo: { id, status: "Aprovada"|"Rejeitada"|"Cancelada" }. */
export async function PATCH(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    if (!uuid.test(String(body.id || ""))) throw new Error("Solicitação inválida.")
    await setPurchaseRequestStatus(context.admin, body.id, String(body.status || ""), context.responsible)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}
