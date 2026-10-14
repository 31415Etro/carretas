// Cadastro de Clientes e Fornecedores: definição dos campos (uma só fonte para formulário, banco e validação)
// e regras puras (testáveis). A validação de CPF/CNPJ (inclusive CNPJ alfanumérico) fica em commercial.ts.
import { brStates, cleanDocument, formatDocument, isValidCnpj, isValidDocument } from "./commercial.ts"

export type Entity = "client" | "supplier"
export type FieldType = "text" | "number" | "date" | "area" | "select" | "phone" | "zip" | "state" | "email"
export type Section = "ident" | "cnpj" | "contato" | "endereco" | "comercial" | "bancario" | "obs"

export type Field = {
  key: string
  label: string
  section: Section
  type?: FieldType
  /** Só existe nesta aba. */
  only?: Entity
  /** Nome da coluna quando difere da chave em snake_case. */
  col?: Partial<Record<Entity, string>>
  /** Preenchido pela consulta de CNPJ (somente leitura para o usuário, mas editável após a consulta). */
  auto?: boolean
  /** Obrigatório no cadastro completo (lead só exige nome e telefone). */
  required?: boolean
  hint?: string
  options?: string[]
}

export const sectionTitles: Record<Section, string> = {
  ident: "Identificação",
  cnpj: "Dados cadastrais (Receita Federal)",
  contato: "Contato",
  endereco: "Endereço",
  comercial: "Dados comerciais",
  bancario: "Dados bancários e fiscais",
  obs: "Observações",
}

export const accountTypes = ["Corrente", "Poupança", "Pagamento"]
export const supplyCategories = ["Matéria-prima", "Peças e componentes", "Serviços", "Insumos", "Equipamentos", "Transporte", "Combustível", "Outros"]
export const icmsOptions = ["1", "2", "9"]

export const fields: Field[] = [
  // Identificação
  { key: "code", label: "Código", section: "ident", auto: true },
  { key: "personType", label: "Tipo de pessoa", section: "ident", type: "select", required: true, col: { client: "type", supplier: "person_type" }, options: ["PJ", "PF"] },
  { key: "document", label: "CPF / CNPJ", section: "ident", required: true },
  { key: "name", label: "Razão social / Nome completo", section: "ident", required: true },
  { key: "tradeName", label: "Nome fantasia", section: "ident" },
  { key: "status", label: "Status", section: "ident", type: "select", required: true },
  // Receita Federal (automático)
  { key: "cnpjStatus", label: "Situação cadastral", section: "cnpj", auto: true },
  { key: "cnpjStatusDate", label: "Data da situação", section: "cnpj", type: "date", auto: true },
  { key: "openedAt", label: "Data de abertura", section: "cnpj", type: "date", auto: true },
  { key: "branchType", label: "Matriz / filial", section: "cnpj", auto: true },
  { key: "cnaeMain", label: "CNAE principal", section: "cnpj", auto: true },
  { key: "cnaeSecondary", label: "CNAEs secundários", section: "cnpj", type: "area", auto: true },
  { key: "legalNature", label: "Natureza jurídica", section: "cnpj", auto: true },
  { key: "companySize", label: "Porte da empresa", section: "cnpj", auto: true },
  { key: "stateRegistration", label: "Inscrição estadual", section: "cnpj", hint: "Conforme a operação" },
  { key: "municipalRegistration", label: "Inscrição municipal", section: "cnpj", hint: "Conforme a operação" },
  { key: "icmsIndicator", label: "Indicador de contribuinte ICMS", section: "cnpj", type: "select", only: "client", col: { client: "icms_indicator" } },
  // Contato
  { key: "phone", label: "Telefone principal", section: "contato", type: "phone", required: true },
  { key: "whatsapp", label: "WhatsApp", section: "contato", type: "phone" },
  { key: "email", label: "E-mail principal", section: "contato", type: "email" },
  { key: "emailFinancial", label: "E-mail financeiro", section: "contato", type: "email", only: "supplier" },
  { key: "contactName", label: "Nome do contato / representante", section: "contato", col: { client: "responsible_name", supplier: "contact_name" } },
  { key: "contactRole", label: "Cargo", section: "contato" },
  // Endereço
  { key: "zipCode", label: "CEP", section: "endereco", type: "zip", required: true },
  { key: "street", label: "Logradouro", section: "endereco", required: true },
  { key: "number", label: "Número", section: "endereco", required: true },
  { key: "complement", label: "Complemento", section: "endereco" },
  { key: "district", label: "Bairro", section: "endereco", required: true },
  { key: "city", label: "Cidade", section: "endereco", required: true },
  { key: "state", label: "UF", section: "endereco", type: "state", required: true },
  { key: "country", label: "País", section: "endereco", required: true },
  { key: "billingAddress", label: "Endereço de cobrança (se diferente)", section: "endereco", type: "area", only: "client" },
  { key: "deliveryAddress", label: "Endereço de entrega (se diferente)", section: "endereco", type: "area", only: "client" },
  // Comercial — cliente
  { key: "segment", label: "Segmento / ramo de atuação", section: "comercial", only: "client" },
  { key: "origin", label: "Origem do cliente", section: "comercial", only: "client" },
  { key: "salespersonId", label: "Vendedor responsável", section: "comercial", type: "select", only: "client", col: { client: "salesperson_id" } },
  { key: "priceTableId", label: "Tabela de preços", section: "comercial", type: "select", only: "client", col: { client: "price_table_id" } },
  { key: "creditLimit", label: "Limite de crédito (R$)", section: "comercial", type: "number", only: "client" },
  { key: "defaultDiscount", label: "Desconto comercial padrão (%)", section: "comercial", type: "number", only: "client" },
  // Comercial — fornecedor
  { key: "supplyCategory", label: "Categoria de fornecimento", section: "comercial", type: "select", only: "supplier", required: true, col: { supplier: "category" } },
  { key: "suppliedItems", label: "Produtos ou serviços fornecidos", section: "comercial", type: "area", only: "supplier" },
  { key: "brands", label: "Marcas atendidas", section: "comercial", only: "supplier" },
  { key: "deliveryDays", label: "Prazo médio de entrega (dias)", section: "comercial", type: "number", only: "supplier" },
  { key: "minOrder", label: "Pedido mínimo (R$)", section: "comercial", type: "number", only: "supplier" },
  { key: "rating", label: "Avaliação (1 a 5)", section: "comercial", type: "select", only: "supplier", options: ["", "1", "2", "3", "4", "5"] },
  { key: "paymentConditionId", label: "Condição de pagamento", section: "comercial", type: "select" },
  // Bancário (fornecedor)
  { key: "bankName", label: "Banco", section: "bancario", only: "supplier" },
  { key: "bankAgency", label: "Agência", section: "bancario", only: "supplier" },
  { key: "bankAccount", label: "Conta", section: "bancario", only: "supplier" },
  { key: "bankAccountType", label: "Tipo de conta", section: "bancario", type: "select", only: "supplier", options: ["", ...accountTypes] },
  { key: "pixKey", label: "Chave Pix", section: "bancario", only: "supplier" },
  { key: "holderName", label: "Nome do titular", section: "bancario", only: "supplier" },
  { key: "holderDocument", label: "CPF/CNPJ do titular", section: "bancario", only: "supplier" },
  { key: "taxWithholdings", label: "Dados para retenções fiscais", section: "bancario", type: "area", only: "supplier", hint: "Ex.: retém ISS, INSS, IRRF, PIS/COFINS/CSLL" },
  { key: "documentsNotes", label: "Documentos e certificados", section: "bancario", type: "area", only: "supplier", hint: "Liste certidões, certificados e validades" },
  // Observações
  { key: "notes", label: "Observações", section: "obs", type: "area", col: { client: "commercial_notes", supplier: "commercial_notes" } },
]

export const fieldsFor = (entity: Entity) => fields.filter((field) => !field.only || field.only === entity)

const snake = (key: string) => key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
export const columnOf = (field: Field, entity: Entity) => field.col?.[entity] || snake(field.key)

/** Campos que a consulta de CNPJ preenche (chave do formulário → valor da API). */
export type CnpjCompanyLike = {
  document: string; legalName: string; tradeName: string; phone: string; email: string; zipCode: string; street: string; number: string
  complement: string; district: string; city: string; state: string; registrationStatus: string; openedAt: string; primaryActivity: string
  legalNature: string; size: string; statusDate: string; branchType: string; cnaeCode: string; secondaryActivities: string[]
  stateRegistration?: string; administrator?: { name: string; role: string } | null
}

export function companyToForm(company: CnpjCompanyLike): Record<string, string> {
  const main = [company.cnaeCode, company.primaryActivity].filter(Boolean).join(" - ")
  const phone = String(company.phone || "").replace(/\D/g, "")
  return {
    personType: "PJ",
    name: company.legalName,
    tradeName: company.tradeName,
    cnpjStatus: company.registrationStatus,
    cnpjStatusDate: company.statusDate,
    openedAt: company.openedAt,
    branchType: company.branchType,
    cnaeMain: main,
    cnaeSecondary: company.secondaryActivities.join("\n"),
    legalNature: company.legalNature,
    companySize: company.size,
    phone: phone ? formatPhone(phone) : "",
    email: company.email,
    zipCode: company.zipCode,
    street: company.street,
    number: company.number,
    complement: company.complement,
    district: company.district,
    city: company.city,
    state: company.state,
    country: "Brasil",
    stateRegistration: company.stateRegistration || "",
    icmsIndicator: company.stateRegistration ? "1" : "9",
    contactName: company.administrator?.name || "",
    contactRole: company.administrator?.role || "",
  }
}

export function formatPhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export function formatZip(value: string) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

/** CNPJ completo (14 caracteres) e com dígitos verificadores corretos — hora de consultar sozinho. */
export const isLookupReady = (personType: string, document: string) => personType === "PJ" && cleanDocument(document).length === 14 && isValidCnpj(document)

export const isCompleteStatus = (status: string) => status !== "Prospect"

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
const digitCount = (value: string) => String(value || "").replace(/\D/g, "").length

/** Mensagem de erro ou "" quando pode salvar. Lead (só cliente) exige apenas nome e telefone. */
export function validateRegistry(entity: Entity, input: Record<string, any>, relaxed = false) {
  const text = (key: string) => String(input[key] ?? "").trim()
  const lead = relaxed || (entity === "client" && input.status === "Prospect")
  if (!text("name")) return input.personType === "PF" ? "Informe o nome completo." : "Informe a razão social."
  if (!(relaxed && !text("phone")) && (digitCount(text("phone")) < 10 || digitCount(text("phone")) > 13)) return "Informe o telefone com DDD."
  if (text("whatsapp") && (digitCount(text("whatsapp")) < 10 || digitCount(text("whatsapp")) > 13)) return "WhatsApp inválido: informe com DDD."
  for (const key of ["email", "emailFinancial"]) if (text(key) && !isEmail(text(key))) return "E-mail inválido."
  if (input.personType !== "PF" && input.personType !== "PJ") return "Informe se é pessoa física ou jurídica."
  const statuses = entity === "client" ? ["Ativo", "Inativo", "Prospect"] : ["Ativo", "Inativo"]
  if (!statuses.includes(input.status)) return "Informe o status."
  if (text("document")) {
    if (!isValidDocument(input.personType, text("document"))) return input.personType === "PF" ? "CPF inválido." : "CNPJ inválido."
  } else if (!lead || relaxed) return "Informe o CPF/CNPJ."
  if (!lead) {
    for (const field of fieldsFor(entity)) {
      if (!field.required || ["document", "name", "phone", "personType", "status"].includes(field.key)) continue
      if (!text(field.key)) return `Informe: ${field.label}.`
    }
  }
  if (text("zipCode") && digitCount(text("zipCode")) !== 8) return "CEP deve ter 8 dígitos."
  if (text("state") && !brStates.includes(text("state").toUpperCase())) return "UF inválida."
  if (entity === "client") {
    if (text("icmsIndicator") === "1" && input.personType === "PJ" && !lead && !text("stateRegistration")) return "Contribuinte do ICMS exige Inscrição Estadual."
    if (Number(input.creditLimit || 0) < 0) return "Limite de crédito não pode ser negativo."
    const discount = Number(input.defaultDiscount || 0)
    if (discount < 0 || discount > 100) return "Desconto padrão deve ficar entre 0 e 100%."
  } else {
    if (Number(input.minOrder || 0) < 0) return "Pedido mínimo não pode ser negativo."
    if (text("deliveryDays") && (!Number.isInteger(Number(input.deliveryDays)) || Number(input.deliveryDays) < 0)) return "Prazo de entrega deve ser um número inteiro de dias."
    // Dados bancários são condicionais: se começou a informar a conta, precisa completar.
    const bank = [text("bankName"), text("bankAgency"), text("bankAccount")]
    if (bank.some(Boolean) && !bank.every(Boolean)) return "Dados bancários incompletos: informe banco, agência e conta."
    if ((bank.some(Boolean) || text("pixKey")) && !text("holderName")) return "Informe o nome do titular da conta/Pix."
    if (text("holderDocument") && !isValidDocument(digitCount(text("holderDocument")) > 11 ? "PJ" : "PF", text("holderDocument"))) return "CPF/CNPJ do titular inválido."
  }
  return ""
}

/** Campos que a consulta quer trocar mas o usuário já alterou à mão (precisam de confirmação). */
export function applyCompany(current: Record<string, string>, company: Record<string, string>, touched: ReadonlySet<string>, force = false) {
  const next = { ...current }
  const conflicts: string[] = []
  for (const [key, value] of Object.entries(company)) {
    if (!value) continue // ausente na API: o campo continua editável e intacto
    const existing = String(current[key] ?? "").trim()
    if (existing && existing !== value && touched.has(key) && !force) { conflicts.push(key); continue }
    next[key] = value
  }
  return { next, conflicts }
}

export { cleanDocument, formatDocument }
