import { NextResponse } from "next/server"
import { purchaseActionAllowed, type PurchaseStatus } from "@/lib/purchases"
import { loadPurchaseOrder, purchaseError } from "@/lib/purchases-server"
import { currentUserRole } from "@/lib/server-authorization"
import { stockContext } from "@/lib/stock-api"

type Action = "approve" | "reopen" | "cancel" | "close"
const nextStatus: Record<Action, PurchaseStatus> = { approve: "Aprovado", reopen: "Rascunho", cancel: "Cancelado", close: "Encerrado" }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const order = await loadPurchaseOrder(context.admin, (await params).id)
    if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 })
    return NextResponse.json({ order })
  } catch (error) {
    return purchaseError(error, "Erro ao carregar pedido.")
  }
}

/** Aprovar, reabrir para edição, cancelar ou encerrar o saldo pendente de um pedido. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const id = (await params).id
    const { action, reason } = await request.json() as { action: Action; reason?: string }
    if (!(action in nextStatus)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
    if (action === "approve") {
      const { role } = await currentUserRole()
      if (!["admin", "manager"].includes(role)) return NextResponse.json({ error: "Somente administradores e gestores aprovam pedidos de compra." }, { status: 403 })
    }
    if ((action === "cancel" || action === "close") && !String(reason || "").trim()) {
      return NextResponse.json({ error: "Informe o motivo." }, { status: 400 })
    }
    const order = await loadPurchaseOrder(context.admin, id)
    if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 })
    if (!purchaseActionAllowed(action, order.status, order.receipts.length > 0)) {
      return NextResponse.json({ error: `Não é possível ${({ approve: "aprovar", reopen: "reabrir", cancel: "cancelar", close: "encerrar" })[action]} um pedido ${order.status.toLowerCase()}${order.receipts.length ? " com recebimentos" : ""}.` }, { status: 400 })
    }
    const update: Record<string, unknown> = { status: nextStatus[action] }
    if (action === "approve") Object.assign(update, { approved_by: context.responsible, approved_at: new Date().toISOString() })
    if (action === "reopen") Object.assign(update, { approved_by: null, approved_at: null })
    if (action === "cancel" || action === "close") update.closed_reason = String(reason).trim()
    // Condição na situação atual evita corrida entre duas pessoas agindo no mesmo pedido.
    const { data, error } = await context.admin.from("purchase_orders").update(update).eq("id", id).eq("status", order.status).select("id")
    if (error) throw new Error(error.message)
    if (!data?.length) return NextResponse.json({ error: "O pedido foi alterado por outra pessoa. Atualize a tela." }, { status: 409 })
    return NextResponse.json({ order: await loadPurchaseOrder(context.admin, id) })
  } catch (error) {
    return purchaseError(error, "Erro ao atualizar pedido.")
  }
}
