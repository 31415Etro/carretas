import { NextResponse } from "next/server"
import { auditAdmin, auditError, getEventDetail } from "@/lib/audit-server"

type Params = { params: Promise<{ id: string }> }

/** Detalhe do evento, com valores anteriores e posteriores. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    return NextResponse.json(await getEventDetail(access.admin, id))
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao carregar o evento.")
    return NextResponse.json({ error: message }, { status })
  }
}
