import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { salesError } from "@/lib/sales-server"
import { salesOrderPdfData } from "@/lib/sales-pdf-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Dados do PDF do pedido (configuração congelada, fotografia, parcelas). O PDF em si é montado no navegador. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    return NextResponse.json({ data: await salesOrderPdfData(context.admin, id) })
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
