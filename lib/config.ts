// Módulo Configurações: validações de empresa, filial, usuário, naturezas, tabelas de preço e modelos;
// parâmetros por área (com padrões e validação); regras usadas pelos outros módulos. Funções puras.

import { brStates, isValidCnpj } from "@/lib/commercial"

export const taxRegimes = ["Simples Nacional", "MEI", "Lucro Presumido", "Lucro Real"] as const
export const fiscalEnvironments = ["Homologação", "Produção"] as const
export const natureKinds = ["Venda", "Serviço", "Remessa", "Devolução", "Outra"] as const
export const documentVisibilities = ["Todos", "Administradores", "Responsável"] as const
export const documentTypes = ["Contrato social", "Certidão", "Alvará / licença", "Política interna", "Procuração", "Apólice de seguro", "Laudo técnico", "Outro"]

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "")
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

// ---------------- Empresa

export type CompanyInput = {
  legalName: string
  tradeName: string
  cnpj: string
  stateRegistration: string
  municipalRegistration: string
  taxRegime: string
  cnae: string
  zipCode: string
  street: string
  number: string
  district: string
  city: string
  state: string
  phone: string
  email: string
  fiscalEnvironment: string
  nfeSeries: string
  nfeNextNumber: number
  nfseSeries: string
  nfseNextNumber: number
  certificateExpiresAt: string
  active: boolean
}

/** Mensagem de erro ou "" quando o cadastro da empresa pode ser salvo. IE e IM só são exigidas se a empresa emite NF-e / NFS-e. */
export function validateCompany(input: CompanyInput) {
  if (!input.legalName.trim()) return "Informe a razão social."
  if (!isValidCnpj(input.cnpj)) return "CNPJ inválido."
  if (!(taxRegimes as readonly string[]).includes(input.taxRegime)) return "Informe o regime tributário."
  if (digits(input.zipCode).length !== 8) return "CEP deve ter 8 dígitos."
  if (!input.street.trim() || !input.number.trim() || !input.district.trim() || !input.city.trim()) return "Informe o endereço completo (logradouro, número, bairro e cidade)."
  if (!brStates.includes(input.state.trim().toUpperCase())) return "UF inválida."
  if (!emailOk(input.email)) return "Informe um e-mail válido da empresa."
  if (input.cnae.trim() && digits(input.cnae).length !== 7) return "CNAE deve ter 7 dígitos."
  if (input.phone.trim() && ![10, 11].includes(digits(input.phone).length)) return "Telefone deve ter DDD e 8 ou 9 dígitos."
  if (!(fiscalEnvironments as readonly string[]).includes(input.fiscalEnvironment)) return "Ambiente fiscal inválido."
  if (input.nfeSeries.trim()) {
    if (!/^\d{1,3}$/.test(input.nfeSeries.trim())) return "Série da NF-e deve ter até 3 dígitos."
    if (!(Number(input.nfeNextNumber) >= 1)) return "Informe o próximo número da NF-e."
    if (!input.stateRegistration.trim()) return "Para emitir NF-e a empresa precisa da Inscrição Estadual."
  }
  if (input.nfseSeries.trim()) {
    if (!(Number(input.nfseNextNumber) >= 1)) return "Informe o próximo número da NFS-e."
    if (!input.municipalRegistration.trim()) return "Para emitir NFS-e a empresa precisa da Inscrição Municipal."
  }
  if (input.certificateExpiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.certificateExpiresAt)) return "Validade do certificado inválida."
  return ""
}

/** Situação do certificado digital. */
export function certificateStatus(expiresAt: string, today = new Date().toISOString().slice(0, 10)) {
  if (!expiresAt) return { label: "Sem certificado", tone: "neutral" as const, daysLeft: null }
  const daysLeft = Math.round((new Date(`${expiresAt}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000)
  if (daysLeft < 0) return { label: "Vencido", tone: "bad" as const, daysLeft }
  if (daysLeft <= 30) return { label: `Vence em ${daysLeft} dia(s)`, tone: "warn" as const, daysLeft }
  return { label: "Válido", tone: "good" as const, daysLeft }
}

// ---------------- Filial, natureza, tabela de preço, modelo, usuário

export function validateBranch(input: { name: string; zipCode: string; state: string; phone: string }) {
  if (!input.name.trim()) return "Informe o nome da filial."
  if (input.zipCode.trim() && digits(input.zipCode).length !== 8) return "CEP deve ter 8 dígitos."
  if (input.state.trim() && !brStates.includes(input.state.trim().toUpperCase())) return "UF inválida."
  if (input.phone.trim() && ![10, 11].includes(digits(input.phone).length)) return "Telefone deve ter DDD e 8 ou 9 dígitos."
  return ""
}

export function validateNature(input: { name: string; kind: string; defaultCfop: string }) {
  if (!input.name.trim()) return "Informe o nome da natureza da operação."
  if (!(natureKinds as readonly string[]).includes(input.kind)) return "Tipo de natureza inválido."
  if (input.defaultCfop.trim() && !/^[1-7]\d{3}$/.test(input.defaultCfop.trim())) return "CFOP deve ter 4 dígitos começando de 1 a 7."
  return ""
}

export function validatePriceTable(input: { name: string; validFrom: string; validUntil: string; items: Array<{ materialId?: string; serviceTypeId?: string; price: number }> }) {
  if (!input.name.trim()) return "Informe o nome da tabela de preços."
  if (!input.validFrom) return "Informe o início da vigência."
  if (input.validUntil && input.validUntil < input.validFrom) return "O fim da vigência não pode ser anterior ao início."
  if (!input.items.length) return "Adicione ao menos um item à tabela."
  if (input.items.some((item) => Boolean(item.materialId) === Boolean(item.serviceTypeId))) return "Cada item deve ser um produto ou um serviço."
  if (input.items.some((item) => !(Number(item.price) >= 0))) return "Preço não pode ser negativo."
  const keys = input.items.map((item) => item.materialId || item.serviceTypeId)
  if (new Set(keys).size !== keys.length) return "Há item repetido na tabela."
  return ""
}

export function validateQuoteTemplate(input: { name: string; validityDays: number; warrantyDays: number }) {
  if (!input.name.trim()) return "Informe o nome do modelo."
  if (!(Number(input.validityDays) >= 1 && Number(input.validityDays) <= 365)) return "Validade deve ficar entre 1 e 365 dias."
  if (Number(input.warrantyDays) < 0) return "Garantia não pode ser negativa."
  return ""
}

/** Cadastro de usuário: empresas autorizadas são obrigatórias (exceto cliente externo, que fica ligado ao próprio cliente). */
export function validateUserAccess(input: { role: string; companyIds: string[]; branchId?: string; branchCompanyId?: string }) {
  if (input.role !== "client" && !input.companyIds.length) return "Informe ao menos uma empresa em que o usuário pode trabalhar."
  if (input.branchId && input.branchCompanyId && !input.companyIds.includes(input.branchCompanyId)) return "A filial precisa pertencer a uma das empresas do usuário."
  return ""
}

// ---------------- Regras usadas por outros módulos

export type PriceTableLike = { id: string; clientId: string; validFrom: string; validUntil: string; active: boolean; items: Array<{ materialId: string; serviceTypeId: string; price: number }> }

/** Preço da tabela vigente: a tabela do cliente tem prioridade sobre a geral; devolve null se o item não estiver em nenhuma. */
export function resolveTablePrice(tables: PriceTableLike[], clientId: string, kind: "Produto" | "Serviço", catalogId: string, today = new Date().toISOString().slice(0, 10)) {
  const valid = tables.filter((table) => table.active && table.validFrom <= today && (!table.validUntil || table.validUntil >= today))
  const find = (list: PriceTableLike[]) => {
    for (const table of list) {
      const item = table.items.find((entry) => (kind === "Produto" ? entry.materialId : entry.serviceTypeId) === catalogId)
      if (item) return { price: Number(item.price), tableId: table.id }
    }
    return null
  }
  return find(valid.filter((table) => table.clientId && table.clientId === clientId)) || find(valid.filter((table) => !table.clientId))
}

/** Maior desconto do orçamento: por item (%) e global (% do subtotal). */
export function maxDiscountPercent(lines: Array<{ discountPercent: number }>, discountAmount: number, subtotal: number) {
  const item = Math.max(0, ...lines.map((line) => Number(line.discountPercent) || 0))
  const global = subtotal > 0 ? (Number(discountAmount) / subtotal) * 100 : 0
  return Math.round(Math.max(item, global) * 100) / 100
}

/** Desconto acima do limite exige administrador ou gerente. Limite 0 desliga a regra. */
export function discountNeedsApproval(percent: number, threshold: number, role: string) {
  if (!(Number(threshold) > 0)) return false
  if (role === "admin" || role === "manager") return false
  return Number(percent) > Number(threshold)
}

/** Ajuste/perda de estoque acima do valor limite exige administrador ou gerente. */
export function stockAdjustmentNeedsApproval(settings: { adjustmentApprovalRequired: boolean; adjustmentApprovalThreshold: number }, value: number, role: string) {
  if (!settings.adjustmentApprovalRequired) return false
  if (role === "admin" || role === "manager") return false
  return Number(value) > Number(settings.adjustmentApprovalThreshold || 0)
}

export function dueDateForPriority(today: string, priority: string, days: Record<string, number>) {
  const amount = Number(days[priority])
  if (!(amount >= 0)) return ""
  return new Date(new Date(`${today}T00:00:00Z`).getTime() + amount * 86400000).toISOString().slice(0, 10)
}

export function canSeeDocument(doc: { visibility: string; responsibleId: string }, user: { id: string; role: string }) {
  if (user.role === "admin") return true
  if (doc.visibility === "Todos") return true
  if (doc.visibility === "Responsável") return doc.responsibleId === user.id
  return false
}

// ---------------- Parâmetros por área

export type SettingField = { key: string; label: string; type: "number" | "text" | "boolean" | "select" | "textarea" | "emails" | "list"; options?: string[]; min?: number; max?: number; hint?: string; unavailable?: boolean }
export type SettingSection = { key: string; title: string; description: string; fields: SettingField[]; defaults: Record<string, any> }

export const settingSections: SettingSection[] = [
  {
    key: "finance", title: "Financeiras", description: "Juros, multas e regras de cobrança usados como padrão nos títulos. Contas bancárias, categorias, centros de custo e condições de pagamento são cadastrados no módulo Financeiro.",
    fields: [
      { key: "interestMonthlyPercent", label: "Juros de mora ao mês (%)", type: "number", min: 0, max: 20 }, { key: "finePercent", label: "Multa por atraso (%)", type: "number", min: 0, max: 20 },
      { key: "graceDays", label: "Dias de tolerância antes de cobrar juros/multa", type: "number", min: 0, max: 30 }, { key: "reminderDaysBefore", label: "Lembrar o cliente quantos dias antes do vencimento", type: "number", min: 0, max: 30 },
      { key: "reminderDaysAfter", label: "Cobrar quantos dias após o vencimento", type: "number", min: 0, max: 60 }, { key: "collectionRules", label: "Regras de cobrança", type: "textarea", hint: "Texto livre: régua de cobrança, negativação, protesto, responsáveis." },
    ],
    defaults: { interestMonthlyPercent: 1, finePercent: 2, graceDays: 0, reminderDaysBefore: 3, reminderDaysAfter: 1, collectionRules: "" },
  },
  {
    key: "stock", title: "Estoque", description: "Custeio, política de estoque mínimo e aprovação de ajustes. Depósitos são cadastrados no módulo Estoque.",
    fields: [
      { key: "costingMethod", label: "Método de custeio", type: "select", options: ["Custo médio"], hint: "O motor de estoque trabalha com custo médio ponderado." },
      { key: "minimumPolicy", label: "Política de estoque mínimo", type: "select", options: ["Manual por produto", "Cobertura em dias"] }, { key: "coverageDays", label: "Cobertura desejada (dias, se a política for por cobertura)", type: "number", min: 1, max: 365 },
      { key: "adjustmentApprovalRequired", label: "Exigir aprovação de gerente para ajustes e perdas", type: "boolean" }, { key: "adjustmentApprovalThreshold", label: "Ajustes até este valor (R$) dispensam aprovação", type: "number", min: 0 },
    ],
    defaults: { costingMethod: "Custo médio", minimumPolicy: "Manual por produto", coverageDays: 30, adjustmentApprovalRequired: false, adjustmentApprovalThreshold: 0 },
  },
  {
    key: "os", title: "Operacionais", description: "Checklist padrão de entrada e prazos por prioridade das ordens de serviço.",
    fields: [
      { key: "defaultChecklist", label: "Checklist padrão de entrada (um item por linha)", type: "list" },
      { key: "deadlineBaixa", label: "Prazo para prioridade Baixa (dias)", type: "number", min: 0, max: 365 }, { key: "deadlineMedia", label: "Prazo para prioridade Média (dias)", type: "number", min: 0, max: 365 },
      { key: "deadlineAlta", label: "Prazo para prioridade Alta (dias)", type: "number", min: 0, max: 365 }, { key: "deadlineUrgente", label: "Prazo para prioridade Urgente (dias)", type: "number", min: 0, max: 365 },
    ],
    defaults: { defaultChecklist: ["Pneus e rodas", "Freios", "Sistema elétrico e iluminação", "Suspensão e eixos", "Estrutura / chassi", "Assoalho", "Carroceria / lona", "Engate / pino rei", "Documentação"], deadlineBaixa: 15, deadlineMedia: 7, deadlineAlta: 3, deadlineUrgente: 1 },
  },
  {
    key: "commercial", title: "Comerciais", description: "Aprovação de descontos, validade padrão e comissões. Tabelas de preço e modelos de orçamento ficam abaixo.",
    fields: [
      { key: "discountApprovalPercent", label: "Desconto acima de (%) exige gerente (0 desliga)", type: "number", min: 0, max: 100 }, { key: "defaultValidityDays", label: "Validade padrão do orçamento (dias)", type: "number", min: 1, max: 365 },
      { key: "defaultCommissionPercent", label: "Comissão padrão do vendedor (% sobre vendas ganhas)", type: "number", min: 0, max: 100 }, { key: "commissionNotes", label: "Regras de comissão", type: "textarea" },
    ],
    defaults: { discountApprovalPercent: 10, defaultValidityDays: 15, defaultCommissionPercent: 0, commissionNotes: "" },
  },
  {
    key: "notifications", title: "Notificações", description: "Resumo diário por e-mail com orçamentos vencendo, estoque abaixo do mínimo e títulos vencidos. WhatsApp depende de um provedor ainda não integrado.",
    fields: [
      { key: "digestEnabled", label: "Enviar resumo diário por e-mail", type: "boolean" }, { key: "digestRecipients", label: "Destinatários (e-mails, separados por vírgula ou linha)", type: "emails" },
      { key: "digestQuotes", label: "Incluir orçamentos que vencem em 7 dias", type: "boolean" }, { key: "digestStock", label: "Incluir produtos abaixo do estoque mínimo", type: "boolean" }, { key: "digestReceivables", label: "Incluir contas a receber vencidas", type: "boolean" },
      { key: "whatsappNumber", label: "WhatsApp para alertas (indisponível: sem provedor integrado)", type: "text", unavailable: true },
    ],
    defaults: { digestEnabled: false, digestRecipients: [], digestQuotes: true, digestStock: true, digestReceivables: true, whatsappNumber: "" },
  },
]

export const sectionByKey = (key: string) => settingSections.find((section) => section.key === key)

export function parseEmails(value: unknown) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,;]+/)
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]
}

/** Valida e normaliza os valores de uma seção; campos ausentes recebem o padrão. */
export function normalizeSection(key: string, input: Record<string, any>) {
  const section = sectionByKey(key)
  if (!section) return { error: "Seção de parâmetros desconhecida.", value: {} as Record<string, any> }
  const value: Record<string, any> = {}
  for (const field of section.fields) {
    const raw = input[field.key] === undefined ? section.defaults[field.key] : input[field.key]
    if (field.type === "number") {
      const number = Number(String(raw).replace(",", "."))
      if (!Number.isFinite(number)) return { error: `${field.label}: informe um número.`, value }
      if (field.min !== undefined && number < field.min) return { error: `${field.label}: mínimo ${field.min}.`, value }
      if (field.max !== undefined && number > field.max) return { error: `${field.label}: máximo ${field.max}.`, value }
      value[field.key] = number
    } else if (field.type === "boolean") {
      value[field.key] = raw === true || raw === "true"
    } else if (field.type === "select") {
      if (!field.options!.includes(String(raw))) return { error: `${field.label}: opção inválida.`, value }
      value[field.key] = String(raw)
    } else if (field.type === "emails") {
      const emails = parseEmails(raw)
      if (emails.some((email) => !emailOk(email))) return { error: `${field.label}: há e-mail inválido.`, value }
      value[field.key] = emails
    } else if (field.type === "list") {
      const items = (Array.isArray(raw) ? raw : String(raw ?? "").split("\n")).map((item) => String(item).trim()).filter(Boolean)
      if (!items.length) return { error: `${field.label}: informe ao menos um item.`, value }
      value[field.key] = [...new Set(items)]
    } else {
      value[field.key] = String(raw ?? "").slice(0, 2000)
    }
  }
  if (key === "notifications" && value.digestEnabled && !value.digestRecipients.length) return { error: "Informe ao menos um destinatário para o resumo diário.", value }
  if (key === "stock" && value.minimumPolicy === "Cobertura em dias" && !(value.coverageDays >= 1)) return { error: "Informe a cobertura desejada em dias.", value }
  return { error: "", value }
}

export const defaultsFor = (key: string) => ({ ...(sectionByKey(key)?.defaults || {}) })

export const priorityDeadlines = (os: Record<string, any>): Record<string, number> => ({ Baixa: Number(os.deadlineBaixa), Media: Number(os.deadlineMedia), Alta: Number(os.deadlineAlta), Urgente: Number(os.deadlineUrgente) })
