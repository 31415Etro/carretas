// Configurador de carretas: rótulos das situações e regras do que pode ser vendido. Funções puras (testáveis); a verdade das regras está no banco (script 225).

export const configStatusLabels: Record<string, string> = {
  Valida: "Válida", "Requer analise tecnica": "Requer análise técnica", "Fora dos limites": "Fora dos limites", Invalida: "Inválida",
  "Aprovada pela engenharia": "Aprovada pela engenharia", "Rejeitada pela engenharia": "Rejeitada pela engenharia",
}
export const configStatusLabel = (status: string) => configStatusLabels[status] || status
export const configStatusTone = (status: string) => ({
  Valida: "bg-emerald-100 text-emerald-800", "Aprovada pela engenharia": "bg-emerald-100 text-emerald-800", "Requer analise tecnica": "bg-amber-100 text-amber-800",
  "Fora dos limites": "bg-orange-100 text-orange-800", Invalida: "bg-red-100 text-red-800", "Rejeitada pela engenharia": "bg-red-100 text-red-800",
}[status] || "bg-slate-100 text-slate-700")

/** Só configuração válida ou aprovada pela engenharia vira pedido. */
export const canSellConfiguration = (status: string) => status === "Valida" || status === "Aprovada pela engenharia"
/** Pode pedir análise técnica: precisa estar gravada e fora do padrão (mas sem erro de preenchimento). */
export const canRequestReview = (status: string) => status === "Requer analise tecnica" || status === "Fora dos limites"
/** Pode ser gravada no orçamento (rascunho). Inválida não grava. */
export const canSaveConfiguration = (status: string) => status !== "Invalida" && status !== "Rejeitada pela engenharia"

export const optionGroupLabels: Record<string, string> = { acabamento: "Acabamento", acessorio: "Acessório" }
export const scopeLabels: Record<string, string> = { externa: "Externa", util: "Útil", interna: "Interna", referencia: "Referência", nao_declarada: "Não declarada no documento" }
export const revisionStatusLabels: Record<string, string> = { Rascunho: "Rascunho", "Em validacao": "Em validação", Validada: "Validada", Obsoleta: "Obsoleta" }
export const documentKinds = ["Desenho tecnico", "CCT", "CAT", "Memorial descritivo", "Fotografia", "CAD", "Outro"] as const
export const documentKindLabels: Record<string, string> = { "Desenho tecnico": "Desenho técnico", CCT: "CCT", CAT: "CAT", "Memorial descritivo": "Memorial descritivo", Fotografia: "Fotografia", CAD: "Arquivo CAD", Outro: "Outro" }

/** "5.000 x 1.800 x 1.200 mm" a partir dos parâmetros devolvidos pelo banco. */
export function dimensionsText(params: Record<string, unknown> | null | undefined) {
  const get = (key: string) => { const value = Number(params?.[key]); return Number.isFinite(value) && value > 0 ? value.toLocaleString("pt-BR") : null }
  const parts = [get("comprimento"), get("largura"), get("altura")]
  return parts.every(Boolean) ? `${parts.join(" x ")} mm` : ""
}

/** Valores digitados (aceita vírgula) -> números; campo vazio fica de fora para o banco aplicar o padrão ou pedir o dado. */
export function paramsFromInputs(inputs: Record<string, string>) {
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(inputs)) {
    const text = String(raw ?? "").trim().replace(/\./g, "").replace(",", ".")
    if (text === "") continue
    const value = Number(text)
    if (Number.isFinite(value)) out[key] = value
  }
  return out
}
