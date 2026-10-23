import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { rpc, shopError, workerAction } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const tokenOf = (request: Request) => request.headers.get("x-worker-token") || ""

/** Tarefas do colaborador identificado (só as que ele está autorizado a apontar). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await rpc(context.admin, "shop_my_tasks", { p_token: tokenOf(request) }))
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Iniciar, pausar, finalizar, consumir, conferir checklist/medidas, abrir ocorrência. O horário vem do servidor; repetir a mesma requestKey não duplica. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const device = String(request.headers.get("x-device") || "tablet").slice(0, 60)
    const result = await workerAction(context.admin, tokenOf(request), String(body.action || ""), body, device)
    return NextResponse.json({ result })
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
