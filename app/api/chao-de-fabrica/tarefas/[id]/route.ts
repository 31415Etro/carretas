import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { rpc, shopError } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 })
  try {
    return NextResponse.json(await rpc(context.admin, "shop_task_detail", { p_token: request.headers.get("x-worker-token") || "", p_task: id }))
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
