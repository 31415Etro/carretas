import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { docError, salesSettingsGet, salesSettingsUpdate } from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Regras da empresa para liberar a fabricação (sinal, documentação, autorização, exceção formal), títulos previstos e canal/atraso da documentação veicular. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const settings = await salesSettingsGet(context.admin)
    return NextResponse.json({ ...settings, requirePayment: Boolean(settings.require_payment_before_production) })
  } catch (error) {
    const mapped = docError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Só administrador ou gerente altera as regras (cada mudança fica registrada com antes e depois). Corpo: qualquer subconjunto dos campos devolvidos pelo GET (ou { requirePayment }). */
export async function PUT(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente altera estas regras." }, { status: 403 })
  try {
    const body = await request.json()
    if (body.documentation_channel === "simulador" && String(process.env.DOC_SIMULATOR_ENABLED || "").trim() !== "1") return NextResponse.json({ error: "O simulador só pode ser escolhido em servidor de teste (DOC_SIMULATOR_ENABLED=1)." }, { status: 400 })
    const input = { ...body, ...(body.requirePayment !== undefined ? { require_payment_before_production: Boolean(body.requirePayment) } : {}) }
    const settings = await salesSettingsUpdate(context.admin, input, context.responsible)
    return NextResponse.json({ ...settings, requirePayment: Boolean(settings.require_payment_before_production) })
  } catch (error) {
    const mapped = docError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
