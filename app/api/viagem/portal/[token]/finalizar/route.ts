import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { advanceError, companyScopedByToken, finalizeAdvance } from "@/lib/travel-advance-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** O funcionário confirma que terminou: todas as notinhas vão para a fila de aprovação do financeiro. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const admin = await companyScopedByToken(createAdminClient, token)
    const body = await request.json().catch(() => ({}))
    await finalizeAdvance(admin, token, { ownPocketJustification: String(body.ownPocketJustification || ""), settlementAction: body.settlementAction === "devolver" || body.settlementAction === "desconto_folha" ? body.settlementAction : null })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao finalizar.").message }, { status: 400 })
  }
}
