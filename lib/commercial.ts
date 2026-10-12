// Regras do módulo Comercial: cadastro único de clientes/fornecedores, validação de CPF/CNPJ,
// pendências fiscais e funil de oportunidades. Funções puras (testáveis).

export const partyKinds = [
  { value: "cliente", label: "Cliente" },
  { value: "fornecedor", label: "Fornecedor" },
  { value: "ambos", label: "Cliente e fornecedor" },
] as const
export type PartyKind = (typeof partyKinds)[number]["value"]

/** "Prospect" é o lead: pode ser cadastrado sem CPF/CNPJ. */
export const partyStatuses = ["Ativo", "Inativo", "Prospect"] as const
export const icmsIndicators = [
  { value: "1", label: "Contribuinte do ICMS" },
  { value: "2", label: "Contribuinte isento" },
  { value: "9", label: "Não contribuinte" },
] as const
export const leadOrigins = ["Site", "Indicação", "WhatsApp", "Telefone", "E-mail", "Feira / evento", "Redes sociais", "Cliente antigo", "Outro"]
export const interactionKinds = ["Ligação", "WhatsApp", "E-mail", "Reunião", "Visita", "Observação"]
export const brStates = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]

export type Party = {
  kind: PartyKind
  personType: "PF" | "PJ"
  name: string
  tradeName: string
  document: string
  stateRegistration: string
  municipalRegistration: string
  icmsIndicator: string
  phone: string
  email: string
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  contactName: string
  contactRole: string
  salespersonId: string
  creditLimit: number
  paymentConditionId: string
  commercialNotes: string
  status: string
}

/** Só letras e números maiúsculos (o CNPJ passa a ter letras a partir de 2026). */
export const cleanDocument = (value: unknown) => String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "")

export function isValidCpf(value: string) {
  const cpf = cleanDocument(value)
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  const digit = (length: number) => {
    const sum = cpf.slice(0, length).split("").reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

/** CNPJ numérico ou alfanumérico (cada caractere vale código ASCII − 48; DV por módulo 11). */
export function isValidCnpj(value: string) {
  const cnpj = cleanDocument(value)
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false
  const digit = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = cnpj.slice(0, length).split("").reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13])
}

/** PF → CPF; PJ → CNPJ. */
export function isValidDocument(personType: string, value: string) {
  return personType === "PF" ? isValidCpf(value) : isValidCnpj(value)
}

export function formatDocument(value: string) {
  const clean = cleanDocument(value)
  if (/^\d{11}$/.test(clean)) return clean.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
  if (clean.length === 14) return clean.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  return value
}

const isValidPhone = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 13
}

/** Mensagem de erro ou "" quando o cadastro pode ser salvo (lead não exige CPF/CNPJ). */
export function validateParty(party: Party) {
  if (!partyKinds.some((item) => item.value === party.kind)) return "Informe se é cliente, fornecedor ou ambos."
  if (party.personType !== "PF" && party.personType !== "PJ") return "Informe se é pessoa física ou jurídica."
  if (!party.name.trim()) return party.personType === "PF" ? "Informe o nome completo." : "Informe a razão social."
  if (!(partyStatuses as readonly string[]).includes(party.status)) return "Informe o status."
  if (party.status === "Prospect" && party.kind !== "cliente") return "Lead (prospect) só pode ser cliente."
  if (!isValidPhone(party.phone)) return "Informe o telefone / WhatsApp com DDD."
  if (party.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.email.trim())) return "E-mail inválido."
  const document = cleanDocument(party.document)
  if (document) {
    if (!isValidDocument(party.personType, document)) return party.personType === "PF" ? "CPF inválido." : "CNPJ inválido."
  } else if (party.status !== "Prospect") {
    return "Informe o CPF/CNPJ (só lead pode ficar sem)."
  }
  if (party.zipCode.trim() && party.zipCode.replace(/\D/g, "").length !== 8) return "CEP deve ter 8 dígitos."
  if (party.state.trim() && !brStates.includes(party.state.trim().toUpperCase())) return "UF inválida."
  if (party.personType === "PJ" && party.icmsIndicator === "1" && !party.stateRegistration.trim()) return "Contribuinte do ICMS exige Inscrição Estadual."
  if (!(Number(party.creditLimit) >= 0)) return "Limite de crédito não pode ser negativo."
  return ""
}

/** Dados que faltam para emitir nota: NF-e (produto) ou NFS-e (serviço). Lista vazia = pronto. */
export function fiscalPendencies(party: Party, flow: "nfe" | "nfse" = "nfe") {
  const missing: string[] = []
  if (!isValidDocument(party.personType, party.document)) missing.push(party.personType === "PF" ? "CPF" : "CNPJ")
  if (flow === "nfe" && party.personType === "PJ" && party.icmsIndicator === "1" && !party.stateRegistration.trim()) missing.push("Inscrição Estadual")
  if (party.zipCode.replace(/\D/g, "").length !== 8) missing.push("CEP")
  if (!party.street.trim()) missing.push("Logradouro")
  if (!party.number.trim()) missing.push("Número")
  if (!party.district.trim()) missing.push("Bairro")
  if (!party.city.trim()) missing.push("Cidade")
  if (!brStates.includes(party.state.trim().toUpperCase())) missing.push("UF")
  if (flow === "nfse" && !party.email.trim()) missing.push("E-mail")
  return missing
}

// ---------------- Oportunidades

export const funnelStages = ["Novo lead", "Contato realizado", "Qualificação", "Orçamento", "Negociação", "Ganho", "Perdido"] as const
export type FunnelStage = (typeof funnelStages)[number]
export const openStages = funnelStages.filter((stage) => stage !== "Ganho" && stage !== "Perdido") as FunnelStage[]
export const stageProbability: Record<FunnelStage, number> = { "Novo lead": 10, "Contato realizado": 20, Qualificação: 40, Orçamento: 60, Negociação: 80, Ganho: 100, Perdido: 0 }

export type OpportunityInput = {
  title: string
  clientId: string
  salespersonId: string
  interest: string
  estimatedValue: number
  stage: string
  probability: number
  expectedCloseDate?: string
  nextContactDate?: string
  lossReason?: string
}

export function validateOpportunity(input: OpportunityInput) {
  if (!input.title.trim()) return "Informe o título da negociação."
  if (!input.clientId) return "Informe o cliente ou lead."
  if (!input.salespersonId) return "Informe o vendedor responsável."
  if (!input.interest.trim()) return "Informe o produto ou serviço de interesse."
  if (!(funnelStages as readonly string[]).includes(input.stage)) return "Etapa do funil inválida."
  if (!(Number(input.estimatedValue) >= 0)) return "Valor estimado não pode ser negativo."
  const probability = Number(input.probability)
  if (!(probability >= 0 && probability <= 100)) return "Probabilidade deve ficar entre 0 e 100."
  if (input.stage === "Perdido" && !String(input.lossReason || "").trim()) return "Informe o motivo da perda."
  if (input.stage === "Ganho" && !(Number(input.estimatedValue) > 0)) return "Informe o valor da venda para ganhar a negociação."
  return ""
}

/** Mudança de etapa: Ganho é definitivo; Perdido pode ser reaberto com justificativa. */
export function validateStageChange(from: string, to: string, extra: { lossReason?: string; estimatedValue?: number; reopenReason?: string }) {
  if (!(funnelStages as readonly string[]).includes(to)) return "Etapa do funil inválida."
  if (from === to) return "A oportunidade já está nesta etapa."
  if (from === "Ganho") return "Negociação ganha não muda de etapa."
  if (from === "Perdido" && !String(extra.reopenReason || "").trim()) return "Informe o motivo para reabrir uma negociação perdida."
  if (to === "Perdido" && !String(extra.lossReason || "").trim()) return "Informe o motivo da perda."
  if (to === "Ganho" && !(Number(extra.estimatedValue) > 0)) return "Informe o valor da venda para ganhar a negociação."
  return ""
}

type FunnelRow = { stage: string; estimatedValue: number; probability: number; nextContactDate?: string }

/** Quantidade, valor e valor ponderado (valor × probabilidade) por etapa. */
export function funnelSummary(rows: FunnelRow[]) {
  return funnelStages.map((stage) => {
    const items = rows.filter((row) => row.stage === stage)
    const value = items.reduce((sum, row) => sum + Number(row.estimatedValue || 0), 0)
    const weighted = items.reduce((sum, row) => sum + (Number(row.estimatedValue || 0) * Number(row.probability || 0)) / 100, 0)
    return { stage, count: items.length, value: Math.round(value * 100) / 100, weighted: Math.round(weighted * 100) / 100 }
  })
}

/** Negociação aberta com contato atrasado. */
export function contactOverdue(row: FunnelRow, today = new Date().toISOString().slice(0, 10)) {
  return (openStages as string[]).includes(row.stage) && Boolean(row.nextContactDate) && String(row.nextContactDate) < today
}

/** Conversão: ganhas ÷ encerradas (ganhas + perdidas). */
export function conversionRate(rows: Array<{ stage: string }>) {
  const won = rows.filter((row) => row.stage === "Ganho").length
  const closed = won + rows.filter((row) => row.stage === "Perdido").length
  return closed ? Math.round((won / closed) * 1000) / 10 : null
}
