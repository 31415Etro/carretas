import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { advanceError, companyScopedByToken, portalState } from "@/lib/travel-advance-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Estado do orçamento de viagem para a pessoa com o link (sem login: o token em si é a autorização). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const admin = await companyScopedByToken(createAdminClient, token)
    return NextResponse.json(await portalState(admin, token))
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao abrir o link.").message }, { status: 400 })
  }
}
