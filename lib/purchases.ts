export const purchaseStatuses = ["Rascunho", "Aprovado", "Parcialmente recebido", "Recebido", "Encerrado", "Cancelado"] as const
export type PurchaseStatus = (typeof purchaseStatuses)[number]

export type PurchaseOrderItemInput = {
  id?: string
  materialId: string
  description: string
  unit: string
  quantity: number
  unitCost: number
  discountPercent: number
  notes?: string
}

export type PurchaseOrderInput = {
  id?: string
  supplierId: string
  supplierName: string
  orderDate: string
  expectedDate?: string
  warehouseId?: string
  paymentConditionId?: string
  paymentMethod?: string
  financialCategoryId?: string
  costCenterId?: string
  supplierReference?: string
  freightAmount: number
  otherCosts: number
  discountAmount: number
  notes?: string
  items: PurchaseOrderItemInput[]
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function purchaseItemTotal(item: Pick<PurchaseOrderItemInput, "quantity" | "unitCost" | "discountPercent">) {
  return round2(Number(item.quantity || 0) * Number(item.unitCost || 0) * (1 - Number(item.discountPercent || 0) / 100))
}

export function purchaseOrderTotals(order: Pick<PurchaseOrderInput, "items" | "freightAmount" | "otherCosts" | "discountAmount">) {
  const itemsTotal = round2(order.items.reduce((sum, item) => sum + purchaseItemTotal(item), 0))
  const total = round2(itemsTotal + Number(order.freightAmount || 0) + Number(order.otherCosts || 0) - Number(order.discountAmount || 0))
  return { itemsTotal, total }
}

/** Mensagem de erro ou "" quando o pedido pode ser salvo. */
export function validatePurchaseOrder(order: PurchaseOrderInput) {
  if (!order.supplierId) return "Informe o fornecedor."
  if (!order.orderDate) return "Informe a data do pedido."
  if (order.expectedDate && order.expectedDate < order.orderDate) return "A previsão de entrega não pode ser anterior à data do pedido."
  if (!order.items.length) return "Inclua ao menos um item."
  for (const item of order.items) {
    if (!item.materialId) return "Todo item precisa estar vinculado a um produto do catálogo."
    if (!(Number(item.quantity) > 0)) return `Quantidade inválida para ${item.description || "o item"}.`
    if (Number(item.unitCost) < 0) return `Custo inválido para ${item.description || "o item"}.`
    if (Number(item.discountPercent) < 0 || Number(item.discountPercent) > 100) return `Desconto inválido para ${item.description || "o item"}.`
  }
  if (Number(order.freightAmount) < 0 || Number(order.otherCosts) < 0 || Number(order.discountAmount) < 0) return "Frete, outros custos e desconto não podem ser negativos."
  if (purchaseOrderTotals(order).total < 0) return "O desconto não pode ser maior que o valor do pedido."
  return ""
}

/** Transições permitidas pelas ações da tela. */
export function purchaseActionAllowed(action: "approve" | "reopen" | "cancel" | "close", status: PurchaseStatus, hasReceipts: boolean) {
  if (action === "approve") return status === "Rascunho"
  if (action === "reopen") return status === "Aprovado" && !hasReceipts
  if (action === "cancel") return (status === "Rascunho" || status === "Aprovado") && !hasReceipts
  return status === "Parcialmente recebido"
}
