// Pedido de venda, produção e MRP: rótulos, situações, ações permitidas e atendimento. Funções puras (testáveis).
// As regras valem no banco (scripts 219 e 223); aqui só se decide o que mostrar e quais botões habilitar.

export const salesStatusLabels: Record<string, string> = {
  Rascunho: "Rascunho", "Aguardando confirmacao": "Aguardando confirmação", Confirmado: "Confirmado", "Aguardando producao": "Aguardando produção",
  "Em producao": "Em produção", "Parcialmente disponivel": "Parcialmente disponível", "Pronto para entrega": "Pronto para entrega", Atendido: "Atendido", Entregue: "Entregue", Cancelado: "Cancelado",
}
export const productionStatusLabels: Record<string, string> = {
  "Aguardando planejamento": "Aguardando planejamento", "Aguardando materiais": "Aguardando materiais", "Pronta para producao": "Pronta para produção", "Em producao": "Em produção",
  Pausada: "Pausada", "Aguardando inspecao": "Aguardando inspeção", Concluida: "Concluída", Cancelada: "Cancelada",
}
export const salesStatusLabel = (status: string) => salesStatusLabels[status] || status
/** Em produção com unidades já concluídas aparece como "Parcialmente concluída" (derivado: não é um estado a mais no banco). */
export const productionStatusLabel = (status: string, produced = 0, quantity = 0) => (status === "Em producao" && produced > 0 && produced < quantity ? "Parcialmente concluída" : productionStatusLabels[status] || status)

export const salesTone = (status: string) => ({
  Rascunho: "bg-slate-100 text-slate-700", "Aguardando confirmacao": "bg-amber-100 text-amber-800", Confirmado: "bg-blue-100 text-blue-800", "Aguardando producao": "bg-amber-100 text-amber-800",
  "Em producao": "bg-indigo-100 text-indigo-800", "Parcialmente disponivel": "bg-cyan-100 text-cyan-800", "Pronto para entrega": "bg-emerald-100 text-emerald-800", Atendido: "bg-emerald-100 text-emerald-800",
  Entregue: "bg-green-200 text-green-900", Cancelado: "bg-red-100 text-red-800",
}[status] || "bg-slate-100 text-slate-700")
export const productionTone = (status: string) => ({
  "Aguardando planejamento": "bg-slate-100 text-slate-700", "Aguardando materiais": "bg-amber-100 text-amber-800", "Pronta para producao": "bg-blue-100 text-blue-800", "Em producao": "bg-indigo-100 text-indigo-800",
  Pausada: "bg-orange-100 text-orange-800", "Aguardando inspecao": "bg-purple-100 text-purple-800", Concluida: "bg-green-200 text-green-900", Cancelada: "bg-red-100 text-red-800",
}[status] || "bg-slate-100 text-slate-700")

export type SalesItemView = { id: string; line_type: string; quantity: number; reserved: number; delivered: number; produced: number; in_production: number; make_to_order?: boolean }

/** Atendimento de um item: pedido, pronto (reservado), entregue, em fabricação e o que ainda falta. Nunca conta a mesma unidade em dois lugares. */
export function fulfilment(item: Pick<SalesItemView, "quantity" | "reserved" | "delivered" | "in_production">) {
  const quantity = Number(item.quantity) || 0
  const delivered = Number(item.delivered) || 0
  const ready = Number(item.reserved) || 0
  const inProduction = Number(item.in_production) || 0
  const pending = Math.max(quantity - delivered - ready, 0)
  const unplanned = Math.max(pending - inProduction, 0)
  return { quantity, delivered, ready, inProduction, pending, unplanned, percent: quantity > 0 ? Math.min(Math.round(((delivered + ready) / quantity) * 100), 100) : 0 }
}

export type SalesOrderForActions = { status: string; payment_confirmed_at?: string | null }
export function salesActions(order: SalesOrderForActions, requirePayment: boolean, items: SalesItemView[]) {
  const status = order.status
  const readyUnits = items.filter((item) => item.line_type === "Produto").reduce((sum, item) => sum + (Number(item.reserved) || 0), 0)
  return {
    confirm: status === "Rascunho" || status === "Aguardando confirmacao",
    payment: requirePayment && !order.payment_confirmed_at && ["Confirmado", "Aguardando producao"].includes(status),
    deliver: ["Parcialmente disponivel", "Pronto para entrega"].includes(status) && readyUnits > 0,
    cancel: !["Cancelado", "Entregue", "Atendido"].includes(status) && !items.some((item) => Number(item.delivered) > 0),
    readyUnits,
  }
}

export type ProductionOrderForActions = { status: string; quantity: number; produced_quantity: number }
export function productionActions(order: ProductionOrderForActions) {
  const open = !["Concluida", "Cancelada"].includes(order.status)
  const remaining = Math.max(Number(order.quantity) - Number(order.produced_quantity), 0)
  return {
    reserve: open && ["Aguardando planejamento", "Aguardando materiais", "Pronta para producao", "Em producao"].includes(order.status),
    start: order.status === "Pronta para producao",
    pause: open && !["Pausada", "Aguardando planejamento"].includes(order.status),
    resume: order.status === "Pausada",
    inspection: order.status === "Em producao",
    backToProduction: order.status === "Aguardando inspecao",
    consume: open && order.status !== "Pausada",
    complete: open && order.status !== "Pausada" && remaining > 0,
    cancel: open && Number(order.produced_quantity) === 0,
    remaining,
  }
}

/** Situação do material no MRP: o que fazer com cada linha. */
export function mrpSituation(row: { shortage_now: number; shortage_projected: number; to_request: number }) {
  if (Number(row.shortage_projected) > 0 && Number(row.to_request) > 0) return { key: "comprar", label: "Falta: solicitar compra", tone: "bg-red-100 text-red-800" }
  if (Number(row.shortage_projected) > 0) return { key: "solicitado", label: "Falta: já solicitado", tone: "bg-amber-100 text-amber-800" }
  if (Number(row.shortage_now) > 0) return { key: "aguardar", label: "Chega com a compra", tone: "bg-blue-100 text-blue-800" }
  return { key: "ok", label: "Coberto", tone: "bg-emerald-100 text-emerald-800" }
}

/** Quantidade informada na tela (aceita vírgula) -> número positivo ou NaN. */
export function positiveNumber(value: string) {
  const parsed = Number(String(value || "").trim().replace(/\./g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN
}

export const SALES_MIGRATION_HINT = "O fluxo de venda e produção ainda não está completo no banco. Rode o script 223 no SQL Editor do Supabase (primeiro no staging)."
export const isSalesStructureMissing = (message: string) => /Could not find the function|does not exist|schema cache|sales_order_(list|detail|from_quote)|production_(order_list|order_detail|dashboard|change_status)|mrp_overview|deliver_sales_order/i.test(message || "")
