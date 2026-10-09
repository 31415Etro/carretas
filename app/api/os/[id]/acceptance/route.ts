import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

/** Aceite do cliente: nome, documento, assinatura desenhada (imagem PNG) e observação. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const id = (await params).id
    const body = await request.json() as { name: string; document?: string; signature?: string; notes?: string }
    if (!String(body.name || "").trim()) return NextResponse.json({ error: "Informe o nome de quem aceitou." }, { status: 400 })
    if (body.signature && (!body.signature.startsWith("data:image/png;base64,") || body.signature.length > 400_000)) {
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 400 })
    }
    const { data: order, error: orderError } = await context.admin.from("service_orders").select("status").eq("id", id).single()
    if (orderError) throw new Error(orderError.message)
    if (order.status === "Cancelada") return NextResponse.json({ error: "OS cancelada não recebe aceite." }, { status: 400 })
    const { error } = await context.admin.from("service_order_signatures").insert({
      service_order_id: id, responsible_name: body.name.trim(), responsible_document: body.document || "", signature_url: body.signature || null,
      signature_text: body.name.trim(), customer_notes: body.notes || "",
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao registrar aceite." }, { status: 400 })
  }
}
