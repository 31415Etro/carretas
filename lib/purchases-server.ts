import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { purchaseItemTotal, purchaseOrderTotals, validatePurchaseOrder, type PurchaseOrderInput } from "@/lib/purchases"

type AdminClient = ReturnType<typeof createAdminClient>

export const PURCHASE_MIGRATION_HINT = "Módulo de compras ainda não instalado: rode scripts/203_compras.sql no Supabase."

export function isPurchaseTableMissing(message = "") {
  return /purchase_|receive_purchase_order/.test(message) && /does not exist|Could not find|schema cache/i.test(message)
}

export function purchaseError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const missing = isPurchaseTableMissing(message)
  return NextResponse.json({ error: missing ? PURCHASE_MIGRATION_HINT : message }, { status: missing ? 503 : 400 })
}

export function toPurchaseOrder(row: any, items: any[] = [], receipts: any[] = []) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    status: row.status,
    orderDate: row.order_date || "",
    expectedDate: row.expected_date || "",
    warehouseId: row.warehouse_id || "",
    paymentConditionId: row.payment_condition_id || "",
    paymentMethod: row.payment_method || "",
    financialCategoryId: row.financial_category_id || "",
    costCenterId: row.cost_center_id || "",
    supplierReference: row.supplier_reference || "",
    itemsTotal: Number(row.items_total || 0),
    freightAmount: Number(row.freight_amount || 0),
    otherCosts: Number(row.other_costs || 0),
    discountAmount: Number(row.discount_amount || 0),
    totalAmount: Number(row.total_amount || 0),
    notes: row.notes || "",
    createdBy: row.created_by || "",
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || "",
    closedReason: row.closed_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      id: item.id,
      materialId: item.material_id,
      description: item.description,
      unit: item.unit,
      quantity: Number(item.quantity || 0),
      unitCost: Number(item.unit_cost || 0),
      discountPercent: Number(item.discount_percent || 0),
      total: Number(item.total || 0),
      receivedQuantity: Number(item.received_quantity || 0),
      notes: item.notes || "",
    })),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      invoiceNumber: receipt.invoice_number,
      invoiceDate: receipt.invoice_date || "",
      receivedAt: receipt.received_at,
      itemsAmount: Number(receipt.items_amount || 0),
      extraCostsAmount: Number(receipt.extra_costs_amount || 0),
      totalAmount: Number(receipt.total_amount || 0),
      payablesGenerated: Number(receipt.payables_generated || 0),
      responsible: receipt.responsible || "",
      notes: receipt.notes || "",
    })),
  }
}

/** Cria ou atualiza um pedido em rascunho, recalculando totais no servidor. */
export async function savePurchaseOrder(admin: AdminClient, input: PurchaseOrderInput, responsible: string) {
  const error = validatePurchaseOrder(input)
  if (error) throw new Error(error)
  if (input.id) {
    const { data: current, error: currentError } = await admin.from("purchase_orders").select("status").eq("id", input.id).maybeSingle()
    if (currentError) throw new Error(currentError.message)
    if (current && current.status !== "Rascunho") throw new Error(`Pedido ${current.status.toLowerCase()} não pode ser alterado. Reabra o pedido para editar.`)
  }
  const { itemsTotal, total } = purchaseOrderTotals(input)
  const row = {
    ...(input.id ? { id: input.id } : {}),
    supplier_id: input.supplierId,
    supplier_name: input.supplierName,
    order_date: input.orderDate,
    expected_date: input.expectedDate || null,
    warehouse_id: input.warehouseId || null,
    payment_condition_id: input.paymentConditionId || null,
    payment_method: input.paymentMethod || "",
    financial_category_id: input.financialCategoryId || null,
    cost_center_id: input.costCenterId || null,
    supplier_reference: input.supplierReference || "",
    items_total: itemsTotal,
    freight_amount: Number(input.freightAmount || 0),
    other_costs: Number(input.otherCosts || 0),
    discount_amount: Number(input.discountAmount || 0),
    total_amount: total,
    notes: input.notes || "",
    ...(input.id ? {} : { created_by: responsible, status: "Rascunho" }),
  }
  const { data: saved, error: saveError } = await admin.from("purchase_orders").upsert(row, { onConflict: "id" }).select("*").single()
  if (saveError) throw new Error(saveError.message)
  const { error: deleteError } = await admin.from("purchase_order_items").delete().eq("purchase_order_id", saved.id)
  if (deleteError) throw new Error(deleteError.message)
  const { data: items, error: itemsError } = await admin.from("purchase_order_items").insert(input.items.map((item) => ({
    purchase_order_id: saved.id,
    material_id: item.materialId,
    description: item.description,
    unit: item.unit || "UN",
    quantity: Number(item.quantity),
    unit_cost: Number(item.unitCost || 0),
    discount_percent: Number(item.discountPercent || 0),
    total: purchaseItemTotal(item),
    notes: item.notes || "",
  }))).select("*")
  if (itemsError) throw new Error(itemsError.message)
  return toPurchaseOrder(saved, items || [])
}

export async function loadPurchaseOrder(admin: AdminClient, id: string) {
  const [orderResult, itemsResult, receiptsResult] = await Promise.all([
    admin.from("purchase_orders").select("*").eq("id", id).maybeSingle(),
    admin.from("purchase_order_items").select("*").eq("purchase_order_id", id).order("created_at"),
    admin.from("purchase_receipts").select("*").eq("purchase_order_id", id).order("created_at", { ascending: false }),
  ])
  const failure = orderResult.error || itemsResult.error || receiptsResult.error
  if (failure) throw new Error(failure.message)
  if (!orderResult.data) return null
  return toPurchaseOrder(orderResult.data, itemsResult.data || [], receiptsResult.data || [])
}
