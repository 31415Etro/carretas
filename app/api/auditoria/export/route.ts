import { NextResponse } from "next/server"
import { auditAdmin, auditError, exportEvents, sanitizeFilters } from "@/lib/audit-server"

/** Exporta em CSV os eventos filtrados (somente administradores). O próprio export fica registrado na trilha. */
export async function GET(request: Request) {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const csv = await exportEvents(access.admin, sanitizeFilters(new URL(request.url).searchParams), { id: access.user.id, email: access.user.email || "" })
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } })
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao exportar a auditoria.")
    return NextResponse.json({ error: message }, { status })
  }
}
