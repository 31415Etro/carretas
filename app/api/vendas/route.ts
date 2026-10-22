import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listSalesOrders, salesError } from "@/lib/sales-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Lista paginada de pedidos de venda da empresa. ?q=&status=abertos|<situação>&pagina=1&tamanho=25. O pedido nasce da conversão de um orçamento aprovado. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    return NextResponse.json(await listSalesOrders(context.admin, { q: params.get("q") || "", status: params.get("status") || "", page: Number(params.get("pagina")) || 1, pageSize: Number(params.get("tamanho")) || 25 }))
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
