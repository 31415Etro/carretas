import { NextResponse } from "next/server"
import { audit } from "@/lib/audit"
import { auditAdmin, auditError, verifyChain } from "@/lib/audit-server"

/** Confere a cadeia de hash: acusa o primeiro evento adulterado ou removido do meio da trilha. */
export async function POST() {
  const access = await auditAdmin()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const results = await verifyChain(access.admin)
    await audit({ module: "auditoria", action: "Acesso administrativo", description: `Verificou a integridade da trilha: ${results.every((item) => item.ok) ? "íntegra" : "INCONSISTENTE"}.`, result: results.every((item) => item.ok) ? "Sucesso" : "Falha", actorId: access.user.id, actorEmail: access.user.email || "" })
    return NextResponse.json({ results })
  } catch (error) {
    const { message, status } = auditError(error, "Erro ao verificar a integridade.")
    return NextResponse.json({ error: message }, { status })
  }
}
