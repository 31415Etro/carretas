type BudgetPointKit = { id: string; workId?: string; kitId?: string; kitName?: string; status?: string }
type StockKitRef = { id: string; name: string }
export type OrderKitSelection = { kitId: string; quantity: number; notes: string }

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

export function budgetKitsForPoints(pointIds: string[], points: BudgetPointKit[], stockKits: StockKitRef[]): OrderKitSelection[] {
  const selectedIds = new Set(pointIds.filter(Boolean))
  const stockKitByName = new Map(stockKits.map((kit) => [normalizedName(kit.name), kit.id]))
  const quantities = new Map<string, number>()

  for (const point of points) {
    if (!selectedIds.has(point.id)) continue
    const kitId = point.kitId || stockKitByName.get(normalizedName(point.kitName || "")) || ""
    if (kitId) quantities.set(kitId, (quantities.get(kitId) || 0) + 1)
  }

  return [...quantities].map(([kitId, quantity]) => ({ kitId, quantity, notes: `Kit do orcamento - ${quantity} ponto(s)` }))
}

export function budgetKitsForWork(workId: string, points: BudgetPointKit[], stockKits: StockKitRef[]): OrderKitSelection[] {
  const pointIds = points
    .filter((point) => point.workId === workId && point.status !== "Inativo")
    .map((point) => point.id)
  return budgetKitsForPoints(pointIds, points, stockKits)
}

export function mergeStoredAndBudgetKits(stored: OrderKitSelection[], budget: OrderKitSelection[]) {
  const merged = stored.map((item) => ({ ...item }))
  for (const item of budget) {
    if (!merged.some((current) => current.kitId === item.kitId)) merged.push(item)
  }
  return merged
}
