import { NextResponse } from "next/server"
import { purchaseError, savePurchaseOrder } from "@/lib/purchases-server"
import { stockContext } from "@/lib/stock-api"

/**
 * Gera pedidos em rascunho a partir da sugestão de compra do estoque: um pedido por
 * fornecedor preferencial, com o último custo de compra (ou custo médio) de cada item.
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { items } = await request.json() as { items: Array<{ materialId: string; quantity: number }> }
    const wanted = (items || []).filter((item) => item.materialId && Number(item.quantity) > 0)
    if (!wanted.length) return NextResponse.json({ error: "Nenhum item para comprar." }, { status: 400 })
    const { data: materials, error } = await context.admin
      .from("materials")
      .select("id,name,unit,supplier_id,last_purchase_cost,average_cost,cost_price,warehouse_id")
      .in("id", wanted.map((item) => item.materialId))
    if (error) throw new Error(error.message)
    const supplierIds = Array.from(new Set((materials || []).map((row) => row.supplier_id).filter(Boolean)))
    const { data: suppliers, error: suppliersError } = supplierIds.length ? await context.admin.from("suppliers").select("id,name").in("id", supplierIds) : { data: [], error: null }
    if (suppliersError) throw new Error(suppliersError.message)

    const withoutSupplier: string[] = []
    const groups = new Map<string, Array<{ material: any; quantity: number }>>()
    for (const item of wanted) {
      const material = (materials || []).find((row) => row.id === item.materialId)
      if (!material) continue
      if (!material.supplier_id) {
        withoutSupplier.push(material.name)
        continue
      }
      groups.set(material.supplier_id, [...(groups.get(material.supplier_id) || []), { material, quantity: Number(item.quantity) }])
    }

    const today = new Date().toISOString().slice(0, 10)
    const created = []
    for (const [supplierId, rows] of groups) {
      created.push(await savePurchaseOrder(context.admin, {
        supplierId,
        supplierName: (suppliers || []).find((row) => row.id === supplierId)?.name || "Fornecedor",
        orderDate: today,
        warehouseId: rows[0].material.warehouse_id || "",
        freightAmount: 0,
        otherCosts: 0,
        discountAmount: 0,
        notes: "Gerado pela sugestão de compra do estoque.",
        items: rows.map(({ material, quantity }) => ({
          materialId: material.id,
          description: material.name,
          unit: material.unit || "UN",
          quantity,
          unitCost: Number(material.last_purchase_cost || material.average_cost || material.cost_price || 0),
          discountPercent: 0,
        })),
      }, context.responsible))
    }
    return NextResponse.json({ orders: created, withoutSupplier })
  } catch (error) {
    return purchaseError(error, "Erro ao gerar pedidos de compra.")
  }
}
