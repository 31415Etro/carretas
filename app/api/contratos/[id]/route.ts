import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { addContractDocument, changeContractStatus, contractError, createAmendment, getContract, saveObligation, savePlan, updateOperational } from "@/lib/contracts-server"

type Params = { params: Promise<{ id: string }> }

const bad = (error: unknown, fallback: string) => {
  const { message, status } = contractError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await getContract(context.admin, id))
  } catch (error) {
    return bad(error, "Erro ao carregar contrato.")
  }
}

/** Ações: status, operational, amend, document, obligation, plan. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    switch (body.action) {
      case "status": return NextResponse.json(await changeContractStatus(context.admin, id, String(body.to || ""), { reason: body.reason, signedDate: body.signedDate }, context.responsible))
      case "operational": return NextResponse.json(await updateOperational(context.admin, id, body, context.responsible))
      case "amend": return NextResponse.json(await createAmendment(context.admin, id, body, context.responsible))
      case "document":
        await addContractDocument(context.admin, id, { kind: String(body.kind || ""), title: body.title, path: String(body.path || ""), name: String(body.name || ""), signedAt: body.signedAt, amendmentId: body.amendmentId }, context.responsible)
        return NextResponse.json(await getContract(context.admin, id))
      case "obligation": return NextResponse.json(await saveObligation(context.admin, id, body.obligation || {}, context.responsible))
      case "plan": return NextResponse.json(await savePlan(context.admin, id, body.plan || {}, context.responsible))
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
  } catch (error) {
    return bad(error, "Erro ao executar a ação.")
  }
}
