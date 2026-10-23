import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { managerAction, managerOverview, ShopError, shopError } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const isManager = (role: string) => role === "admin" || role === "manager"

/** Painel do gestor: esteira, colaboradores em atividade, paradas, ocorrências, etapas e indicadores. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    if (!isManager(context.role)) throw new ShopError("Somente administrador ou gerente acompanha a esteira.", 403)
    return NextResponse.json(await managerOverview(context.admin))
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    if (!isManager(context.role)) throw new ShopError("Somente administrador ou gerente altera a esteira.", 403)
    const body = await request.json()
    const result = await managerAction(context.admin, String(body.action || ""), body, context.responsible)
    return NextResponse.json({ result, ...(await managerOverview(context.admin)) })
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
