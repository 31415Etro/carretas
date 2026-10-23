import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { currentUserRole } from "@/lib/server-authorization"
import { rpc, shopError } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const deviceOf = (request: Request, body: Record<string, any>) => String(body.device || request.headers.get("x-device") || "tablet").slice(0, 60)

/** Identificação individual no tablet: matrícula + PIN (ou o próprio login do ERP, quando ligado ao colaborador). Nenhuma conta compartilhada registra tempos. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json().catch(() => ({}))
    const device = deviceOf(request, body)
    if (body.action === "logout") {
      await rpc(context.admin, "shop_worker_logout", { p_token: String(body.token || "") })
      return NextResponse.json({ ok: true })
    }
    if (body.action === "login_erp") {
      const { user } = await currentUserRole()
      if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 })
      return NextResponse.json({ ok: true, ...(await rpc<Record<string, unknown>>(context.admin, "shop_worker_login_profile", { p_profile: user.id, p_device: device })) })
    }
    const result = await rpc<Record<string, any>>(context.admin, "shop_worker_login", { p_code: String(body.code || ""), p_pin: String(body.pin || ""), p_device: device })
    return NextResponse.json(result, { status: result.ok ? 200 : 401 })
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
