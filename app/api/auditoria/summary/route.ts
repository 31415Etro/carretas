import { NextResponse } from "next/server"
import { auditAdmin, auditError, summary } from "@/lib/audit-server"

export async function GET() {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    return NextResponse.json(await summary(access.admin))
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao carregar o resumo.")
    return NextResponse.json({ error: message }, { status })
  }
}
