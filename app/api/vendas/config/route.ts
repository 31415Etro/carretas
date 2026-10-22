import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { saveSalesSettings, salesError, salesSettings } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Regra operacional da empresa: exigir sinal/confirmação de pagamento antes de liberar a fabricação. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await salesSettings(context.admin))
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Só administrador ou gerente altera a regra. Corpo: { requirePayment: boolean }. */
export async function PUT(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente altera esta regra." }, { status: 403 })
  try {
    const body = await request.json()
    await saveSalesSettings(context.admin, Boolean(body.requirePayment), context.responsible)
    return NextResponse.json(await salesSettings(context.admin))
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
