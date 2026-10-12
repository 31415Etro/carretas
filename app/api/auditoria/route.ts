import { NextResponse } from "next/server"
import { audit } from "@/lib/audit"
import { auditAdmin, auditError, sanitizeFilters, searchEvents } from "@/lib/audit-server"

/** Consulta paginada da trilha de auditoria (somente administradores). A abertura da consulta também é auditada. */
export async function GET(request: Request) {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const params = new URL(request.url).searchParams
    const filters = sanitizeFilters(params)
    const result = await searchEvents(access.admin, filters)
    if (!filters.before && params.get("silent") !== "1") {
      await audit({ module: "auditoria", action: "Acesso administrativo", description: `Consultou a trilha de auditoria${Object.entries(filters).filter(([key, value]) => value && !["before", "limit"].includes(key)).length ? ` com filtros (${Object.entries(filters).filter(([key, value]) => value && !["before", "limit"].includes(key)).map(([key]) => key).join(", ")})` : ""}.`, actorId: access.user.id, actorEmail: access.user.email || "" })
    }
    return NextResponse.json(result)
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao consultar a auditoria.")
    return NextResponse.json({ error: message }, { status })
  }
}
