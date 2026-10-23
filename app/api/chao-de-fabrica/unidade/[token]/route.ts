import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { rpc, shopError } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Página do QR Code da carreta: exige login do ERP; o identificador do QR é opaco e não contém dados do cliente. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { token } = await params
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: "QR Code inválido." }, { status: 400 })
  try {
    return NextResponse.json({ unit: await rpc(context.admin, "shop_unit_view", { p_token: token }) })
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
