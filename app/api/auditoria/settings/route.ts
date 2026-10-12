import { NextResponse } from "next/server"
import { auditAdmin, auditError, getRetention, setRetention } from "@/lib/audit-server"

export async function GET() {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    return NextResponse.json(await getRetention(access.admin))
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao carregar a retenção.")
    return NextResponse.json({ error: message }, { status })
  }
}

/** Define por quantos dias os eventos são mantidos (365 a 3650). A alteração é auditada pelo trigger de audit_settings. */
export async function PUT(request: Request) {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const { retentionDays } = await request.json()
    return NextResponse.json(await setRetention(Number(retentionDays), access.user.email || access.user.id))
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao salvar a retenção.")
    return NextResponse.json({ error: message }, { status })
  }
}
