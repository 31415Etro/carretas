// Vínculos Produto vendido -> Estrutura de fabricação -> Kits -> Matérias-primas. Regras puras (testáveis).

export type StructureFacts = {
  /** produto -> estrutura ativa (id) ou null */
  activeBom: Record<string, string | null>
  /** estrutura -> kits ligados */
  kitsOfBom: Record<string, Array<{ kitId: string; kitName: string }>>
  /** kit -> true quando tem versão ativa com ao menos 1 componente */
  kitReady: Record<string, boolean>
}

export type StructureProblem = { productId: string; product: string; problem: string }

/** O que impede de fabricar o que foi vendido: produto sem estrutura ativa, estrutura sem kits, kit sem versão ativa ou sem matérias-primas. */
export function structureProblems(products: Array<{ productId: string; name: string }>, facts: StructureFacts): StructureProblem[] {
  const out: StructureProblem[] = []
  const seen = new Set<string>()
  for (const { productId, name } of products) {
    if (!productId || seen.has(productId)) continue
    seen.add(productId)
    const bom = facts.activeBom[productId]
    if (!bom) { out.push({ productId, product: name, problem: "não tem estrutura de fabricação ativa" }); continue }
    const kits = facts.kitsOfBom[bom] || []
    if (!kits.length) { out.push({ productId, product: name, problem: "a estrutura ativa não tem kits" }); continue }
    const broken = kits.filter((kit) => !facts.kitReady[kit.kitId])
    if (broken.length) out.push({ productId, product: name, problem: `o kit ${broken.map((kit) => kit.kitName).join(", ")} não tem versão ativa com matérias-primas` })
  }
  return out
}

export const structureMessage = (problems: StructureProblem[]) =>
  problems.length
    ? `Não dá para gerar a produção: ${problems.map((item) => `"${item.product}" ${item.problem}`).join("; ")}. Vincule os kits em Estoque > Produtos finais antes de fechar a venda.`
    : ""
