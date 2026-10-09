import type { Material } from "./operational-storage.ts"

type StockItem = Pick<Material, "currentStock" | "reservedStock" | "minimumStock" | "maximumStock" | "reorderPoint" | "status">

/** Disponível = físico - reservado (pode ficar negativo quando há mais reserva que saldo). */
export function materialAvailable(item: Pick<Material, "currentStock" | "reservedStock">) {
  return Math.round((Number(item.currentStock || 0) - Number(item.reservedStock || 0)) * 1000) / 1000
}

/** Precisa repor quando o disponível chega ao ponto de reposição (ou ao mínimo, se maior). */
export function needsReplenishment(item: StockItem) {
  if (item.status === "Inativo") return false
  const trigger = Math.max(Number(item.reorderPoint || 0), Number(item.minimumStock || 0))
  return trigger > 0 && materialAvailable(item) <= trigger
}

/** Quantidade sugerida: repõe até o estoque máximo (ou 2x o gatilho quando não há máximo). */
export function suggestedPurchaseQuantity(item: StockItem) {
  const trigger = Math.max(Number(item.reorderPoint || 0), Number(item.minimumStock || 0))
  const target = Number(item.maximumStock || 0) > 0 ? Number(item.maximumStock) : trigger * 2
  return Math.max(0, Math.ceil((target - materialAvailable(item)) * 1000) / 1000)
}
