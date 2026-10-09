// Composição (lista de materiais) de kits e produtos montados/fabricados.

export type CompositionItem = { componentId: string; quantity: number; unit: string; lossPercent: number; unitCost?: number }

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

/** Quantidade consumida por unidade produzida, já com a perda prevista. */
export function quantityWithLoss(item: Pick<CompositionItem, "quantity" | "lossPercent">) {
  return Math.round(Number(item.quantity || 0) * (1 + Number(item.lossPercent || 0) / 100) * 10000) / 10000
}

/** Custo estimado por unidade: materiais (com perda, pelo custo médio) + mão de obra. */
export function compositionCost(items: CompositionItem[], laborCost: number) {
  const materials = round2(items.reduce((sum, item) => sum + quantityWithLoss(item) * Number(item.unitCost || 0), 0))
  const labor = round2(laborCost)
  return { materials, labor, total: round2(materials + labor) }
}

/**
 * Mensagem de erro ou "" quando a composição pode ser salva.
 * `activeCompositions` (produto -> componentes da versão ativa) detecta ciclos, ex.: A usa B e B usa A.
 */
export function validateComposition(productId: string, items: CompositionItem[], laborCost: number, assemblyMinutes: number, activeCompositions: Record<string, string[]> = {}) {
  if (!items.length) return "Inclua ao menos um componente."
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.componentId) return "Selecione o componente de todas as linhas."
    if (item.componentId === productId) return "O produto não pode ser componente de si mesmo."
    if (seen.has(item.componentId)) return "Há componente repetido; some as quantidades numa linha só."
    seen.add(item.componentId)
    if (!(Number(item.quantity) > 0)) return "Quantidade do componente deve ser maior que zero."
    if (Number(item.lossPercent) < 0 || Number(item.lossPercent) >= 100) return "Perda prevista deve ficar entre 0% e 99,9%."
  }
  if (Number(laborCost) < 0 || Number(assemblyMinutes) < 0) return "Mão de obra e tempo de montagem não podem ser negativos."
  const visit = (id: string, path: Set<string>): boolean => {
    if (id === productId) return true
    if (path.has(id)) return false
    path.add(id)
    return (activeCompositions[id] || []).some((child) => visit(child, path))
  }
  const cycle = items.find((item) => visit(item.componentId, new Set()))
  if (cycle) return "Composição circular: um componente já usa este produto na sua própria composição."
  return ""
}
