import { NextResponse } from "next/server"
import { canEmitHere, createEmission, issuerContext, listEmissions, markErrorsSeen } from "@/lib/nfe-emission-server"
import type { EmissionPayload } from "@/lib/nfe-emission"
import { getSelectedSystemCompanyId } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Histórico de emissões da empresa. ?vistos=1 marca os avisos de erro como vistos. */
export async function GET(request: Request) {
  const context = await issuerContext()
  if ("error" in context) return context.error
  try {
    const companyId = await getSelectedSystemCompanyId()
    const rows = await listEmissions(context.admin, companyId)
    const unseenErrors = rows.filter((row) => row.error && !row.error_seen).length
    if (new URL(request.url).searchParams.get("vistos") === "1") await markErrorsSeen(context.admin, companyId)
    return NextResponse.json({ emissions: rows.map(({ payload: _payload, ...row }) => row), unseenErrors, canEmit: canEmitHere() })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar o histórico." }, { status: 500 }) }
}

/** Pede a emissão: grava na fila e dispara o robô. O resultado aparece no histórico. */
export async function POST(request: Request) {
  const context = await issuerContext()
  if ("error" in context) return context.error
  if (!canEmitHere()) return NextResponse.json({ error: "A emissão roda no servidor próprio do sistema (VPS). Acesse pelo endereço do servidor para emitir." }, { status: 409 })
  try {
    const body = await request.json() as { payload: EmissionPayload }
    const companyId = await getSelectedSystemCompanyId()
    const row = await createEmission(context.admin, companyId, body.payload, context.responsible)
    return NextResponse.json({ id: row.id })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível pedir a emissão." }, { status: 400 }) }
}
