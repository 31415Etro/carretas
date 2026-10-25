// Jornada única da venda: oportunidade -> proposta -> fechamento -> pedido -> acompanhamento. Regras puras (testáveis).

export const journeySteps = ["oportunidade", "proposta", "fechamento", "pedido", "acompanhamento"] as const
export type JourneyStep = (typeof journeySteps)[number]

export const journeyLabels: Record<JourneyStep, string> = {
  oportunidade: "Oportunidade", proposta: "Proposta", fechamento: "Fechamento", pedido: "Pedido", acompanhamento: "Acompanhamento",
}

export type JourneyState = {
  opportunity: { id: string; stage: string } | null
  quote: { id: string; status: string } | null
  order: { id: string; status: string } | null
}

const deadQuote = (status: string) => ["Cancelado", "Recusado"].includes(status)
export const orderConfirmed = (status: string) => !["Rascunho", "Cancelado"].includes(status)

/** Cada etapa só abre quando a anterior foi cumprida; as anteriores continuam sempre abertas para consulta. */
export function stepAvailability(state: JourneyState): Record<JourneyStep, boolean> {
  const saved = Boolean(state.opportunity?.id)
  const hasQuote = saved && Boolean(state.quote && !deadQuote(state.quote.status))
  const hasOrder = Boolean(state.order && state.order.status !== "Cancelado")
  return {
    oportunidade: true,
    proposta: saved,
    fechamento: hasQuote || hasOrder,
    pedido: hasOrder,
    acompanhamento: hasOrder && orderConfirmed(state.order!.status),
  }
}

/** Etapa em que a pessoa deve cair ao abrir a Jornada: a mais avançada já disponível, sem pular o fechamento. */
export function defaultStep(state: JourneyState): JourneyStep {
  const available = stepAvailability(state)
  if (available.acompanhamento) return "acompanhamento"
  if (available.pedido) return "pedido"
  if (available.fechamento) return "fechamento"
  if (available.proposta) return "proposta"
  return "oportunidade"
}

export const isJourneyStep = (value: string | null | undefined): value is JourneyStep => journeySteps.includes(value as JourneyStep)

export type ClosingCheck = { key: string; label: string; ok: boolean; detail: string }

/** Conferências do FECHAR VENDA, a partir do orçamento aceito (sem nada de financeiro). */
export function closingChecks(input: {
  clientId: string
  items: Array<{ lineType: string; catalogId: string; quantity: number; unitPrice: number; configurationId?: string; requiresConfiguration?: boolean; configurationStatus?: string }>
  totalAmount: number
  paymentConditionId: string
  deliveryTerm: string
  /** produtos que não têm estrutura/kits para fabricar (vem do servidor) */
  structureProblems?: Array<{ product: string; problem: string }>
}): ClosingCheck[] {
  const products = input.items.filter((item) => item.lineType === "Produto")
  const unconfigured = products.filter((item) => item.requiresConfiguration && !item.configurationId)
  const invalidConfig = products.filter((item) => item.configurationId && item.configurationStatus && /inv[aá]lid/i.test(item.configurationStatus))
  return [
    { key: "cliente", label: "Cliente", ok: Boolean(input.clientId), detail: input.clientId ? "Cliente informado." : "Informe o cliente na proposta." },
    { key: "produtos", label: "Produtos", ok: products.length > 0 && products.every((item) => item.catalogId && item.quantity > 0), detail: products.length ? `${products.length} produto(s) com quantidade.` : "A proposta não tem produtos." },
    { key: "estrutura", label: "Estrutura de fabricação", ok: !(input.structureProblems || []).length, detail: (input.structureProblems || []).length ? `${(input.structureProblems || []).map((item) => `${item.product} ${item.problem}`).join("; ")}. Vincule os kits em Estoque > Produtos finais.` : "Kits e matérias-primas de cada produto conferidos." },
    { key: "medidas", label: "Medidas e acessórios", ok: unconfigured.length === 0 && invalidConfig.length === 0, detail: unconfigured.length ? `${unconfigured.length} produto(s) ainda sem configuração (medidas, acabamento, acessórios).` : invalidConfig.length ? "Há configuração inválida: revise na proposta." : "Configuração conferida." },
    { key: "valores", label: "Valores", ok: input.totalAmount > 0 && products.every((item) => item.unitPrice >= 0), detail: input.totalAmount > 0 ? "Valores da proposta conferidos." : "O valor total da proposta está zerado." },
    { key: "condicoes", label: "Condições comerciais", ok: Boolean(input.paymentConditionId), detail: input.paymentConditionId ? "Condição de pagamento negociada informada." : "Informe a condição comercial negociada." },
    { key: "prazo", label: "Prazo de entrega", ok: Boolean(String(input.deliveryTerm || "").trim()), detail: String(input.deliveryTerm || "").trim() ? "Prazo de entrega informado." : "Informe o prazo de entrega." },
  ]
}
