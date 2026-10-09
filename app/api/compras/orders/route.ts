import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { purchaseError, savePurchaseOrder, toPurchaseOrder } from "@/lib/purchases-server"
import { readAllPages } from "@/lib/supabase-pagination"

export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const status = new URL(request.url).searchParams.get("status")
    const orders = await readAllPages<any>((from, to) => {
      let query = context.admin.from("purchase_orders").select("*")
      if (status) query = query.eq("status", status)
      return query.order("order_date", { ascending: false }).order("order_number", { ascending: false }).range(from, to)
    })
    const ids = orders.map((order) => order.id)
    const items: any[] = []
    const receipts: any[] = []
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200)
      const [itemsResult, receiptsResult] = await Promise.all([
        context.admin.from("purchase_order_items").select("*").in("purchase_order_id", chunk).order("created_at"),
        context.admin.from("purchase_receipts").select("*").in("purchase_order_id", chunk).order("created_at", { ascending: false }),
      ])
      if (itemsResult.error || receiptsResult.error) throw new Error((itemsResult.error || receiptsResult.error)!.message)
      items.push(...(itemsResult.data || []))
      receipts.push(...(receiptsResult.data || []))
    }
    return NextResponse.json({
      orders: orders.map((order) => toPurchaseOrder(order, items.filter((item) => item.purchase_order_id === order.id), receipts.filter((receipt) => receipt.purchase_order_id === order.id))),
    })
  } catch (error) {
    return purchaseError(error, "Erro ao carregar pedidos de compra.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { order } = await request.json()
    return NextResponse.json({ order: await savePurchaseOrder(context.admin, order, context.responsible) })
  } catch (error) {
    return purchaseError(error, "Erro ao salvar pedido de compra.")
  }
}
