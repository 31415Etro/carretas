// Documentação veicular (pré-cadastro por unidade) e liberação da produção: rótulos, ações permitidas, canais e simulador. Funções puras (testáveis).
// As regras valem no banco (script 224); aqui só se decide o que mostrar e quais botões habilitar.
import { isValidVin } from "./fleet.ts"

export const docStatusLabels: Record<string, string> = {
  "Pendente de dados": "Pendente de dados", "Pronto para envio": "Pronto para envio", "Envio em andamento": "Envio em andamento", Enviado: "Enviado", "Aguardando processamento": "Aguardando processamento",
  "Em exigencia": "Em exigência", Rejeitado: "Rejeitado", "Aprovado para liberacao": "Aprovado para liberação", Cancelado: "Cancelado",
}
export const docStatusLabel = (status: string) => docStatusLabels[status] || status
export const docStatusTone = (status: string) => ({
  "Pendente de dados": "bg-amber-100 text-amber-800", "Pronto para envio": "bg-blue-100 text-blue-800", "Envio em andamento": "bg-indigo-100 text-indigo-800", Enviado: "bg-indigo-100 text-indigo-800",
  "Aguardando processamento": "bg-purple-100 text-purple-800", "Em exigencia": "bg-orange-100 text-orange-800", Rejeitado: "bg-red-100 text-red-800", "Aprovado para liberacao": "bg-emerald-100 text-emerald-800", Cancelado: "bg-slate-100 text-slate-600",
}[status] || "bg-slate-100 text-slate-700")
export const finalStageLabels: Record<string, string> = { "Nao iniciada": "Documentação final não iniciada", "Aguardando fabricacao": "Aguardando a fabricação", "Em andamento": "Em andamento", Concluida: "Concluída" }

export const documentationChannels = [
  { value: "manual", label: "Manual (portal operado por uma pessoa)", detail: "A pessoa faz o pré-cadastro no portal do SERPRO/RENAVAM e registra aqui o protocolo e o resultado." },
  { value: "serpro_lote", label: "Lote de arquivo SERPRO (Auto SCP)", detail: "Envio por arquivo de lote, só para quem já é credenciada na SENATRAN. Ainda não implementado: depende do credenciamento e do código de cliente." },
  { value: "simulador", label: "Simulador (somente testes)", detail: "Não fala com nenhum órgão. Desligado em produção, a menos que o servidor o habilite de propósito." },
] as const
export type DocumentationChannel = (typeof documentationChannels)[number]["value"]

export const normalizeVin = (value: string) => String(value || "").toUpperCase().replace(/\s+/g, "").trim()
export const vinProblem = (value: string) => (!value.trim() ? "Informe o chassi (VIN)." : isValidVin(value) ? "" : "Chassi (VIN) inválido: 17 caracteres, sem I, O e Q.")

export type DocForActions = { status: string; protocol?: string | null; channel: string; missing?: string[] }
/** Quais ações cada situação aceita (o banco confere de novo). */
export function documentationActions(doc: DocForActions, role: string) {
  const editable = ["Pendente de dados", "Pronto para envio", "Em exigencia", "Rejeitado"].includes(doc.status)
  const manager = role === "admin" || role === "manager"
  const waiting = ["Enviado", "Aguardando processamento"].includes(doc.status)
  return {
    edit: editable,
    check: editable,
    submitAutomatic: doc.status === "Pronto para envio" && doc.channel === "simulador",
    registerManualSubmission: doc.status === "Pronto para envio" && doc.channel === "manual",
    consult: waiting && doc.channel === "simulador",
    registerResult: waiting && doc.channel === "manual" && manager,   // aprovação manual libera a produção: só administrador ou gerente
    cancel: doc.status !== "Cancelado" && manager,
    finalStage: doc.status === "Aprovado para liberacao",
    correct: ["Em exigencia", "Rejeitado"].includes(doc.status),
  }
}

export type ReleaseBlocker = { code: string; message: string; waivable: boolean }
export const releaseLabel = (release: { eligible: boolean; blockers: ReleaseBlocker[] } | null | undefined) =>
  !release ? "" : release.eligible ? "Liberada para fabricar" : `Bloqueada: ${release.blockers.map((blocker) => blocker.message).join(" ")}`

/**
 * Simulador do portal (somente testes). O último caractere do chassi escolhe o roteiro, para exercitar todos os caminhos sem tocar em órgão nenhum:
 *  7 -> serviço indisponível no 1º envio; 8 -> exigência na 1ª consulta e aprovação depois; 9 -> rejeição na 1ª consulta; demais -> processando e depois aprovado.
 */
export function simulateSubmit(input: { vin: string; submitAttempts: number }): { outcome: "sucesso" | "indisponivel"; protocol?: string; message: string } {
  const vin = normalizeVin(input.vin)
  if (vin.slice(-1) === "7" && input.submitAttempts <= 1) return { outcome: "indisponivel", message: "Simulador: serviço indisponível (503)." }
  return { outcome: "sucesso", protocol: `SIM-${vin.slice(-8)}-${input.submitAttempts}`, message: "Simulador: solicitação recebida." }
}
export function simulateConsult(input: { vin: string; consults: number }): { result: "aprovado" | "rejeitado" | "exigencia" | "processando"; message: string; pendencies?: string[] } {
  const last = normalizeVin(input.vin).slice(-1)
  if (last === "9") return { result: "rejeitado", message: "Simulador: chassi rejeitado.", pendencies: ["Chassi incompatível com o ano de fabricação (simulado)"] }
  if (last === "8" && input.consults === 0) return { result: "exigencia", message: "Simulador: informar o CAT.", pendencies: ["Informar o número do CAT"] }
  if (input.consults === 0 && last !== "8") return { result: "processando", message: "Simulador: em processamento." }
  return { result: "aprovado", message: "Simulador: pré-cadastro aprovado." }
}

export const DOC_MIGRATION_HINT = "A documentação veicular ainda não está instalada no banco. Rode o script 224 no SQL Editor do Supabase (primeiro no staging)."
export const isDocStructureMissing = (message: string) => /Could not find the function|does not exist|schema cache|vehicle_doc|vehicle_documentation|production_eligibility|sales_settings_get/i.test(message || "")
