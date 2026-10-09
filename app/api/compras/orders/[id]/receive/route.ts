import { NextResponse } from "next/server"
import { loadPurchaseOrder, purchaseError } from "@/lib/purchases-server"
import { stockContext } from "@/lib/stock-api"

type ReceiveLine = { orderItemId: string; quantity: number; warehouseId?: string; lotNumber?: string; serialNumber?: string; expiryDate?: string }

/**
 * Recebimento total ou parcial: entrada no estoque, atualização do pedido e contas a
 * pagar acontecem juntos na função receive_purchase_order (tudo ou nada).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const id = (await params).id
    const body = await request.json() as { invoiceNumber: string; invoiceDate?: string; receivedAt?: string; firstDueDate?: string; generatePayables?: boolean; notes?: string; lines: ReceiveLine[] }
    if (!String(body.invoiceNumber || "").trim()) return NextResponse.json({ error: "Informe o número da nota fiscal." }, { status: 400 })
    const lines = (body.lines || []).filter((line) => Number(line.quantity) > 0)
    if (!lines.length) return NextResponse.json({ error: "Informe a quantidade recebida de ao menos um item." }, { status: 400 })
    const { data, error } = await context.admin.rpc("receive_purchase_order", {
      p: {
        purchase_order_id: id,
        invoice_number: String(body.invoiceNumber).trim(),
        invoice_date: body.invoiceDate || "",
        received_at: body.receivedAt || "",
        first_due_date: body.firstDueDate || "",
        generate_payables: body.generatePayables !== false,
        responsible: context.responsible,
        notes: body.notes || "",
        lines: lines.map((line) => ({
          order_item_id: line.orderItemId,
          quantity: Number(line.quantity),
          warehouse_id: line.warehouseId || "",
          lot_number: line.lotNumber || "",
          serial_number: line.serialNumber || "",
          expiry_date: line.expiryDate || "",
        })),
      },
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ result: data, order: await loadPurchaseOrder(context.admin, id) })
  } catch (error) {
    return purchaseError(error, "Erro ao receber pedido.")
  }
}
