import { NextResponse } from "next/server"
import { issuerContext, requestCancel, retryEmission } from "@/lib/nfe-emission-server"
import { getSelectedSystemCompanyId } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** { acao: "cancelar", motivo } pede o cancelamento da nota emitida; { acao: "tentar-novamente" } refaz uma emissão com erro. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await issuerContext()
  if ("error" in context) return context.error
  try {
    const { id } = await params
    const body = await request.json() as { acao?: string; motivo?: string }
    const companyId = await getSelectedSystemCompanyId()
    if (body.acao === "cancelar") await requestCancel(context.admin, companyId, id, String(body.motivo || ""), context.responsible)
    else if (body.acao === "tentar-novamente") await retryEmission(context.admin, companyId, id)
    else return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível concluir." }, { status: 400 }) }
}
