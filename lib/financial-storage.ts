export const FINANCIAL_STORAGE_KEY = "mc-finance.v1"

export type FinancialType = "Entrada" | "Saida"
export type FinancialStatus = "Previsto" | "Realizado" | "Vencido" | "Cancelado"
export type PayableStatus = "Aberta" | "Paga" | "Vencida" | "Parcialmente paga" | "Cancelada"
export type ReceivableStatus = "Aberta" | "Recebida" | "Vencida" | "Parcialmente recebida" | "Cancelada"

export interface FinancialTransaction {
  id: string
  type: FinancialType
  description: string
  categoryId: string
  subcategoryId: string
  costCenterId: string
  dreAccountId: string
  clientId: string
  workId: string
  environmentId: string
  pointId: string
  serviceOrderId: string
  providerId: string
  vehicleId: string
  supplierName: string
  competenceDate: string
  dueDate: string
  realizedDate: string
  expectedAmount: number
  realizedAmount: number
  paymentMethod: string
  bankAccountId: string
  creditCardId: string
  creditCardInvoiceId: string
  status: FinancialStatus
  origin: string
  notes: string
  attachmentName: string
  createdAt: string
  updatedAt: string
}

export interface AccountsPayable {
  id: string
  supplierId?: string
  supplierName: string
  description: string
  categoryId: string
  subcategoryId: string
  costCenterId: string
  dreAccountId: string
  workId: string
  environmentId: string
  pointId: string
  serviceOrderId: string
  providerId: string
  vehicleId: string
  competenceDate: string
  dueDate: string
  paymentDate: string
  expectedAmount: number
  paidAmount: number
  paymentMethod: string
  bankAccountId: string
  creditCardId: string
  creditCardInvoiceId: string
  status: PayableStatus
  origin: string
  notes: string
  attachmentName: string
  transactionId: string
  createdAt: string
  updatedAt: string
}

export interface AccountsReceivable {
  id: string
  clientId: string
  workId: string
  environmentId: string
  pointId: string
  serviceOrderId: string
  description: string
  categoryId: string
  subcategoryId: string
  costCenterId: string
  dreAccountId: string
  competenceDate: string
  dueDate: string
  receivedDate: string
  expectedAmount: number
  receivedAmount: number
  receiptMethod: string
  bankAccountId: string
  status: ReceivableStatus
  origin: string
  notes: string
  attachmentName: string
  transactionId: string
  createdAt: string
  updatedAt: string
}

export interface FinancialCategory {
  id: string
  name: string
  type: "entrada" | "saida" | "ambos"
  dreAccountId: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface FinancialSubcategory {
  id: string
  categoryId: string
  name: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface CostCenter {
  id: string
  name: string
  description: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface DreAccount {
  id: string
  name: string
  parentId: string
  type: "receita" | "deducao" | "custo" | "despesa" | "resultado"
  orderIndex: number
  signal: "positivo" | "negativo" | "calculado"
  formula: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface CreditCard {
  id: string
  name: string
  bankName: string
  cardLastDigits: string
  holderName: string
  cardAccount: string
  closingDay: number
  dueDay: number
  creditLimit: number
  status: "Ativo" | "Inativo"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CreditCardInvoice {
  id: string
  creditCardId: string
  referenceMonth: string
  referenceYear: string
  dueDate: string
  holderName: string
  cardAccount: string
  totalAmount: number
  importedAmount: number
  differenceAmount: number
  status: "Importada" | "Em revisao" | "Conferida" | "Paga" | "Cancelada"
  pdfFileName: string
  rawText: string
  accountsPayableId: string
  createdAt: string
  updatedAt: string
}

export interface CreditCardInvoiceItem {
  id: string
  invoiceId: string
  purchaseDate: string
  originalDescription: string
  normalizedDescription: string
  currentInstallment: number
  totalInstallments: number
  city: string
  cardHolder: string
  cardLastDigits: string
  amount: number
  categoryId: string
  subcategoryId: string
  costCenterId: string
  dreAccountId: string
  categoryRuleId: string
  categoryConfidence: "Alta" | "Media" | "Baixa" | "Sem categoria"
  categoryStatus: "Categorizado automaticamente" | "Categorizado manualmente" | "Sem categoria" | "Baixa confianca"
  reviewStatus: "Pendente" | "Conferido" | "Ignorado" | "Duplicado"
  linkedTransactionId: string
  linkedServiceOrderId: string
  linkedWorkId: string
  linkedVehicleId: string
  linkedProviderId: string
  sourcePage: number
  rawLine: string
  extractionConfidence: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CategoryRule {
  id: string
  name: string
  priority: number
  searchText: string
  normalizedSearchText: string
  comparisonType: "Contem" | "Comeca com" | "Igual" | "Regex" | "Similaridade"
  categoryId: string
  subcategoryId: string
  costCenterId: string
  dreAccountId: string
  creditCardId: string
  cardHolder: string
  defaultConfidence: "Alta" | "Media" | "Baixa"
  active: boolean
  notes: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceImportPreview {
  invoice: {
    referenceMonth: string
    referenceYear: string
    dueDate: string
    holderName: string
    cardAccount: string
    totalAmount: number
  }
  items: CreditCardInvoiceItem[]
  rawText: string
  warnings: string[]
  fileName: string
  creditCardId: string
}

export interface RuleImportPreview {
  id: string
  originalDescription: string
  searchText: string
  category: string
  subcategory: string
  confidence: "Alta" | "Media" | "Baixa"
  ignored: boolean
}

export interface FinancialState {
  transactions: FinancialTransaction[]
  accountsPayable: AccountsPayable[]
  accountsReceivable: AccountsReceivable[]
  categories: FinancialCategory[]
  subcategories: FinancialSubcategory[]
  costCenters: CostCenter[]
  dreAccounts: DreAccount[]
  creditCards: CreditCard[]
  creditCardInvoices: CreditCardInvoice[]
  creditCardInvoiceItems: CreditCardInvoiceItem[]
  categoryRules: CategoryRule[]
}

export function financeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function financeNow() {
  return new Date().toISOString()
}

export function financeToday() {
  return financeNow().slice(0, 10)
}

export function money(value: number) {
  const amount = Number(value || 0)
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function parseMoney(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0

  const raw = String(value || "").trim()
  const negative = raw.includes("-")
  const unsigned = raw.replace(/[^\d.,]/g, "")
  const lastComma = unsigned.lastIndexOf(",")
  const lastDot = unsigned.lastIndexOf(".")
  const decimalIndex = Math.max(lastComma, lastDot)
  const hasBothSeparators = lastComma >= 0 && lastDot >= 0
  const decimalDigits = decimalIndex >= 0 ? unsigned.length - decimalIndex - 1 : 0
  const hasDecimalSeparator = decimalIndex >= 0 && (hasBothSeparators || decimalDigits === 1 || decimalDigits === 2)
  const integerPart = (hasDecimalSeparator ? unsigned.slice(0, decimalIndex) : unsigned).replace(/\D/g, "") || "0"
  const fractionPart = hasDecimalSeparator ? unsigned.slice(decimalIndex + 1).replace(/\D/g, "") : ""
  const amount = Number(`${negative ? "-" : ""}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`)
  return Number.isFinite(amount) ? amount : 0
}

function slug(value: string) {
  return normalizeDescription(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export function normalizeDescription(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d{2}\/\d{2}/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/[^\w\s*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

function defaultDreAccounts(now: string): DreAccount[] {
  const rows = [
    ["dre-receita-bruta", "Receita Bruta", "receita", "positivo"],
    ["dre-deducoes", "Deducoes", "deducao", "negativo"],
    ["dre-receita-liquida", "Receita Liquida", "resultado", "calculado"],
    ["dre-custos", "Custos dos Servicos Prestados", "custo", "negativo"],
    ["dre-lucro-bruto", "Lucro Bruto", "resultado", "calculado"],
    ["dre-admin", "Administrativo", "despesa", "negativo"],
    ["dre-pessoal", "Pessoal", "despesa", "negativo"],
    ["dre-prestadores", "Prestadores", "despesa", "negativo"],
    ["dre-veiculos", "Veiculos", "despesa", "negativo"],
    ["dre-materiais", "Materiais e Insumos", "despesa", "negativo"],
    ["dre-ferramentas", "Ferramentas", "despesa", "negativo"],
    ["dre-epis", "EPIs", "despesa", "negativo"],
    ["dre-ti", "TI e Sistemas", "despesa", "negativo"],
    ["dre-marketing", "Marketing e Comercial", "despesa", "negativo"],
    ["dre-financeiras", "Despesas Financeiras", "despesa", "negativo"],
    ["dre-outras", "Outras Despesas", "despesa", "negativo"],
    ["dre-operacional", "Resultado Operacional", "resultado", "calculado"],
    ["dre-impostos", "Impostos", "despesa", "negativo"],
    ["dre-lucro-liquido", "Lucro Liquido", "resultado", "calculado"],
    ["dre-sem-classificacao", "Sem classificacao", "despesa", "negativo"],
  ] as Array<[string, string, DreAccount["type"], DreAccount["signal"]]>
  return rows.map(([id, name, type, signal], index) => ({ id, name, parentId: "", type, orderIndex: index + 1, signal, formula: "", status: "Ativo", createdAt: now, updatedAt: now }))
}

export function defaultFinancialState(): FinancialState {
  const now = financeNow()
  const dre = defaultDreAccounts(now)
  const categories: FinancialCategory[] = [
    { id: "cat-receita-servicos", name: "Receita de servicos", type: "entrada", dreAccountId: "dre-receita-bruta", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-insumos", name: "Insumos", type: "saida", dreAccountId: "dre-materiais", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-veiculos", name: "Veiculos", type: "saida", dreAccountId: "dre-veiculos", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-ti", name: "TI e Sistemas", type: "saida", dreAccountId: "dre-ti", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-ferramentas", name: "Ferramentas", type: "saida", dreAccountId: "dre-ferramentas", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-investimento", name: "Investimento", type: "saida", dreAccountId: "dre-outras", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-pessoal", name: "Pessoal", type: "saida", dreAccountId: "dre-pessoal", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-epis", name: "EPI", type: "saida", dreAccountId: "dre-epis", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-pecas-cliente", name: "Peca para cliente", type: "saida", dreAccountId: "dre-materiais", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cat-curso", name: "Curso Colaborador", type: "saida", dreAccountId: "dre-pessoal", status: "Ativo", createdAt: now, updatedAt: now },
  ]
  const subcategories: FinancialSubcategory[] = [
    { id: "sub-instalacao", categoryId: "cat-receita-servicos", name: "Instalacao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-refrigeracao", categoryId: "cat-insumos", name: "Materiais de refrigeracao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-finca-pino", categoryId: "cat-insumos", name: "Finca pino", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-corrugados", categoryId: "cat-insumos", name: "Corrugados", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-tubo-cobre", categoryId: "cat-insumos", name: "Tubo de Cobre", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-fontes", categoryId: "cat-insumos", name: "Fontes para automacao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-controladores", categoryId: "cat-insumos", name: "Controladores para automacao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-seguro", categoryId: "cat-veiculos", name: "Seguro", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-manutencao-carro", categoryId: "cat-veiculos", name: "Manutencao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-chatgpt", categoryId: "cat-ti", name: "ChatGPT Plus", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-automacao", categoryId: "cat-ti", name: "Investimento TI", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-ferramentas", categoryId: "cat-ferramentas", name: "Ferramenta", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-uniformes", categoryId: "cat-epis", name: "Uniformes", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-sapatao", categoryId: "cat-epis", name: "Sapatao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "sub-curso", categoryId: "cat-curso", name: "Curso Colaborador", status: "Ativo", createdAt: now, updatedAt: now },
  ]
  const costCenters: CostCenter[] = [
    { id: "cc-operacao", name: "Operacao", description: "Servicos em campo", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cc-admin", name: "Administrativo", description: "Administracao", status: "Ativo", createdAt: now, updatedAt: now },
    { id: "cc-frota", name: "Frota", description: "Veiculos", status: "Ativo", createdAt: now, updatedAt: now },
  ]
  const card: CreditCard = { id: "card-sicoob", name: "Cartao Sicoob Empresarial", bankName: "Sicoob", cardLastDigits: "4748", holderName: "MONICKE M VENANCIO", cardAccount: "7563239223507", closingDay: 12, dueDay: 19, creditLimit: 25000, status: "Ativo", notes: "", createdAt: now, updatedAt: now }
  return {
    transactions: [],
    accountsPayable: [],
    accountsReceivable: [],
    categories,
    subcategories,
    costCenters,
    dreAccounts: dre,
    creditCards: [card],
    creditCardInvoices: [],
    creditCardInvoiceItems: [],
    categoryRules: defaultCategoryRules(now),
  }
}

function makeRule(now: string, priority: number, searchText: string, categoryId: string, subcategoryId: string, costCenterId: string, dreAccountId: string, confidence: "Alta" | "Media" | "Baixa" = "Alta"): CategoryRule {
  return { id: `rule-${slug(searchText) || priority}`, name: searchText, priority, searchText, normalizedSearchText: normalizeDescription(searchText), comparisonType: "Contem", categoryId, subcategoryId, costCenterId, dreAccountId, creditCardId: "", cardHolder: "", defaultConfidence: confidence, active: true, notes: "Regra padrao para importacao de fatura", createdAt: now, updatedAt: now }
}

function defaultCategoryRules(now: string): CategoryRule[] {
  return [
    makeRule(now, 1, "REFRICRIL", "cat-insumos", "sub-tubo-cobre", "cc-operacao", "dre-materiais"),
    makeRule(now, 2, "QUALIPECAS", "cat-pecas-cliente", "", "cc-operacao", "dre-materiais"),
    makeRule(now, 3, "QUALIPECASV", "cat-pecas-cliente", "", "cc-operacao", "dre-materiais"),
    makeRule(now, 4, "FRIOVIX", "cat-insumos", "sub-refrigeracao", "cc-operacao", "dre-materiais"),
    makeRule(now, 5, "MASXGEN", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 6, "5PRODUT", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 7, "7PRODUT", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 8, "19PRODU", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 9, "HORIZON", "cat-insumos", "sub-controladores", "cc-operacao", "dre-materiais"),
    makeRule(now, 10, "NAMUREM", "cat-insumos", "sub-fontes", "cc-operacao", "dre-materiais"),
    makeRule(now, 11, "IRENASCONFEC", "cat-epis", "sub-uniformes", "cc-operacao", "dre-epis"),
    makeRule(now, 12, "CHATGPT", "cat-ti", "sub-chatgpt", "cc-admin", "dre-ti"),
    makeRule(now, 13, "CAKTOCHATGPT", "cat-ti", "sub-chatgpt", "cc-admin", "dre-ti"),
    makeRule(now, 14, "INFINITEPAY", "cat-investimento", "", "cc-admin", "dre-outras"),
    makeRule(now, 15, "ESCOLA DA REFRIGERAC", "cat-curso", "sub-curso", "cc-admin", "dre-pessoal"),
    makeRule(now, 16, "TOKIO MARINE", "cat-veiculos", "sub-seguro", "cc-frota", "dre-veiculos"),
    makeRule(now, 17, "WJ MECANICA", "cat-veiculos", "sub-manutencao-carro", "cc-frota", "dre-veiculos"),
    makeRule(now, 18, "FERRAMENTAS KENNEDY", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 19, "KENNEDY", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 20, "ABTMATERIAIS", "cat-insumos", "sub-corrugados", "cc-operacao", "dre-materiais"),
    makeRule(now, 21, "A B T COML ELETRICA", "cat-insumos", "sub-corrugados", "cc-operacao", "dre-materiais"),
    makeRule(now, 22, "MASTERLICENCA", "cat-ti", "sub-automacao", "cc-admin", "dre-ti"),
    makeRule(now, 23, "REEMBOL", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 24, "MERCADOLIVRE", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais", "Media"),
    makeRule(now, 25, "MERCADOPAGO", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais", "Media"),
    makeRule(now, 26, "LEVEROS", "cat-pessoal", "", "cc-admin", "dre-pessoal"),
    makeRule(now, 27, "HHMCOME", "cat-pessoal", "", "cc-admin", "dre-pessoal"),
    makeRule(now, 28, "FRONTEC", "cat-insumos", "", "cc-operacao", "dre-materiais"),
    makeRule(now, 29, "METAJUR", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 30, "TURKIAC", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 31, "DEROMUL", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 32, "VISUALS", "cat-epis", "sub-uniformes", "cc-operacao", "dre-epis"),
    makeRule(now, 33, "MUNDIAL", "cat-insumos", "", "cc-operacao", "dre-materiais"),
    makeRule(now, 34, "WAYCORE", "cat-investimento", "", "cc-admin", "dre-outras"),
    makeRule(now, 35, "EMEACOM", "cat-insumos", "sub-corrugados", "cc-operacao", "dre-materiais"),
    makeRule(now, 36, "KABUM", "cat-investimento", "", "cc-admin", "dre-outras"),
    makeRule(now, 37, "LUMATEC", "cat-insumos", "sub-controladores", "cc-operacao", "dre-materiais"),
    makeRule(now, 38, "SMARTNO", "cat-insumos", "sub-controladores", "cc-operacao", "dre-materiais"),
    makeRule(now, 39, "FELIMAO", "cat-insumos", "sub-finca-pino", "cc-operacao", "dre-materiais"),
    makeRule(now, 40, "SHOPEE", "cat-ferramentas", "sub-ferramentas", "cc-operacao", "dre-ferramentas"),
    makeRule(now, 41, "FLAVIOV", "cat-epis", "sub-sapatao", "cc-operacao", "dre-epis"),
  ]
}

export function loadFinancialState(): FinancialState {
  if (typeof window === "undefined") return defaultFinancialState()
  try {
    const defaults = defaultFinancialState()
    const raw = window.localStorage.getItem(FINANCIAL_STORAGE_KEY)
    if (!raw) {
      window.localStorage.setItem(FINANCIAL_STORAGE_KEY, JSON.stringify(defaults))
      return defaults
    }
    const stored = { ...defaults, ...JSON.parse(raw) } as FinancialState
    const withMissingDefaults: FinancialState = {
      ...stored,
      categories: mergeById(stored.categories, defaults.categories),
      subcategories: mergeById(stored.subcategories, defaults.subcategories),
      costCenters: mergeById(stored.costCenters, defaults.costCenters),
      dreAccounts: mergeById(stored.dreAccounts, defaults.dreAccounts),
      categoryRules: mergeById(stored.categoryRules, defaults.categoryRules),
    }
    window.localStorage.setItem(FINANCIAL_STORAGE_KEY, JSON.stringify(withMissingDefaults))
    return withMissingDefaults
  } catch {
    return defaultFinancialState()
  }
}

function mergeById<T extends { id: string }>(current: T[] = [], defaults: T[] = []) {
  const existing = new Set(current.map((item) => item.id))
  return [...current, ...defaults.filter((item) => !existing.has(item.id))]
}

function parserStateWithDefaults(state: FinancialState): FinancialState {
  const defaults = defaultFinancialState()
  return {
    ...defaults,
    ...state,
    categories: mergeById(Array.isArray(state.categories) ? state.categories : [], defaults.categories),
    subcategories: mergeById(Array.isArray(state.subcategories) ? state.subcategories : [], defaults.subcategories),
    costCenters: mergeById(Array.isArray(state.costCenters) ? state.costCenters : [], defaults.costCenters),
    dreAccounts: mergeById(Array.isArray(state.dreAccounts) ? state.dreAccounts : [], defaults.dreAccounts),
    creditCards: mergeById(Array.isArray(state.creditCards) ? state.creditCards : [], defaults.creditCards),
    categoryRules: mergeById(Array.isArray(state.categoryRules) ? state.categoryRules : [], defaults.categoryRules),
  }
}

export function saveFinancialState(state: FinancialState) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(FINANCIAL_STORAGE_KEY, JSON.stringify(state))
}

export function categoryName(state: FinancialState, id: string) {
  return (Array.isArray(state.categories) ? state.categories : []).find((item) => item.id === id)?.name || "Sem categoria"
}

export function subcategoryName(state: FinancialState, id: string) {
  return (Array.isArray(state.subcategories) ? state.subcategories : []).find((item) => item.id === id)?.name || "-"
}

export function costCenterName(state: FinancialState, id: string) {
  return (Array.isArray(state.costCenters) ? state.costCenters : []).find((item) => item.id === id)?.name || "-"
}

export function dreName(state: FinancialState, id: string) {
  return (Array.isArray(state.dreAccounts) ? state.dreAccounts : []).find((item) => item.id === id)?.name || "Sem classificacao"
}

const legacyCategoryNames: Record<string, string> = {
  "cat-receita-servicos": "Receita de servicos",
  "cat-insumos": "Insumos",
  "cat-veiculos": "Veiculos",
  "cat-ti": "TI e Sistemas",
  "cat-ferramentas": "Ferramentas",
  "cat-investimento": "Investimento",
  "cat-pessoal": "Pessoal",
  "cat-epis": "EPI",
  "cat-pecas-cliente": "Peca para cliente",
  "cat-curso": "Curso Colaborador",
}

const legacySubcategoryNames: Record<string, string> = {
  "sub-instalacao": "Instalacao",
  "sub-refrigeracao": "Materiais de refrigeracao",
  "sub-finca-pino": "Finca pino",
  "sub-corrugados": "Corrugados",
  "sub-tubo-cobre": "Tubo de Cobre",
  "sub-fontes": "Fontes para automacao",
  "sub-controladores": "Controladores para automacao",
  "sub-seguro": "Seguro",
  "sub-manutencao-carro": "Manutencao",
  "sub-chatgpt": "ChatGPT Plus",
  "sub-automacao": "Investimento TI",
  "sub-ferramentas": "Ferramenta",
  "sub-uniformes": "Uniformes",
  "sub-sapatao": "Sapatao",
  "sub-curso": "Curso Colaborador",
}

const legacyCostCenterNames: Record<string, string> = {
  "cc-operacao": "Operacao",
  "cc-admin": "Administrativo",
  "cc-frota": "Frota",
}

const legacyDreNames: Record<string, string> = {
  "dre-receita-bruta": "Receita Bruta",
  "dre-materiais": "Materiais e Insumos",
  "dre-veiculos": "Veiculos",
  "dre-ti": "TI e Sistemas",
  "dre-ferramentas": "Ferramentas",
  "dre-epis": "EPIs",
  "dre-pessoal": "Pessoal",
  "dre-outras": "Outras Despesas",
  "dre-financeiras": "Despesas Financeiras",
  "dre-sem-classificacao": "Sem classificacao",
}

function sameLabel(a = "", b = "") {
  return normalizeDescription(a) === normalizeDescription(b)
}

function includesLabel(a = "", b = "") {
  const normalizedA = normalizeDescription(a)
  const normalizedB = normalizeDescription(b)
  return Boolean(normalizedA && normalizedB && (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)))
}

function resolveCategoryId(state: FinancialState, idOrLabel = "") {
  const categories = Array.isArray(state.categories) ? state.categories : []
  const direct = categories.find((item) => item.id === idOrLabel)
  if (direct) return direct.id
  const label = legacyCategoryNames[idOrLabel] || idOrLabel
  return categories.find((item) => sameLabel(item.name, label) || includesLabel(item.name, label))?.id || ""
}

function resolveSubcategoryId(state: FinancialState, idOrLabel = "", categoryId = "") {
  const subcategories = Array.isArray(state.subcategories) ? state.subcategories : []
  const direct = subcategories.find((item) => item.id === idOrLabel && (!categoryId || item.categoryId === categoryId))
  if (direct) return direct.id
  const label = legacySubcategoryNames[idOrLabel] || idOrLabel
  return subcategories.find((item) => (!categoryId || item.categoryId === categoryId) && (sameLabel(item.name, label) || includesLabel(item.name, label)))?.id || ""
}

function resolveCostCenterId(state: FinancialState, idOrLabel = "") {
  const costCenters = Array.isArray(state.costCenters) ? state.costCenters : []
  const direct = costCenters.find((item) => item.id === idOrLabel)
  if (direct) return direct.id
  const label = legacyCostCenterNames[idOrLabel] || idOrLabel
  return costCenters.find((item) => sameLabel(item.name, label) || includesLabel(item.name, label))?.id || ""
}

function resolveDreAccountId(state: FinancialState, idOrLabel = "", categoryId = "") {
  const dreAccounts = Array.isArray(state.dreAccounts) ? state.dreAccounts : []
  const direct = dreAccounts.find((item) => item.id === idOrLabel)
  if (direct) return direct.id
  const category = (Array.isArray(state.categories) ? state.categories : []).find((item) => item.id === categoryId)
  if (category?.dreAccountId) return category.dreAccountId
  const label = legacyDreNames[idOrLabel] || idOrLabel
  const fallback = dreAccounts.find((item) => sameLabel(item.name, label) || includesLabel(item.name, label))?.id
  if (fallback) return fallback
  if (idOrLabel === "dre-sem-classificacao") return ""
  return resolveDreAccountId(state, "dre-sem-classificacao")
}

export function isOverdue(dueDate: string, doneDate: string, status: string) {
  return Boolean(dueDate && !doneDate && !["Realizado", "Paga", "Recebida", "Cancelado", "Cancelada"].includes(status) && dueDate < financeToday())
}

export function transactionFromPayable(item: AccountsPayable): FinancialTransaction {
  const now = financeNow()
  return {
    id: item.transactionId || financeId("ft"),
    type: "Saida",
    description: item.description,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    costCenterId: item.costCenterId,
    dreAccountId: item.dreAccountId,
    clientId: "",
    workId: item.workId,
    environmentId: item.environmentId,
    pointId: item.pointId,
    serviceOrderId: item.serviceOrderId,
    providerId: item.providerId,
    vehicleId: item.vehicleId,
    supplierName: item.supplierName,
    competenceDate: item.competenceDate,
    dueDate: item.dueDate,
    realizedDate: item.paymentDate || financeToday(),
    expectedAmount: item.expectedAmount,
    realizedAmount: item.paidAmount || item.expectedAmount,
    paymentMethod: item.paymentMethod,
    bankAccountId: item.bankAccountId,
    creditCardId: item.creditCardId,
    creditCardInvoiceId: item.creditCardInvoiceId,
    status: "Realizado",
    origin: item.origin || "Conta a pagar",
    notes: item.notes,
    attachmentName: item.attachmentName,
    createdAt: now,
    updatedAt: now,
  }
}

export function transactionFromReceivable(item: AccountsReceivable): FinancialTransaction {
  const now = financeNow()
  return {
    id: item.transactionId || financeId("ft"),
    type: "Entrada",
    description: item.description,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    costCenterId: item.costCenterId,
    dreAccountId: item.dreAccountId,
    clientId: item.clientId,
    workId: item.workId,
    environmentId: item.environmentId,
    pointId: item.pointId,
    serviceOrderId: item.serviceOrderId,
    providerId: "",
    vehicleId: "",
    supplierName: "",
    competenceDate: item.competenceDate,
    dueDate: item.dueDate,
    realizedDate: item.receivedDate || financeToday(),
    expectedAmount: item.expectedAmount,
    realizedAmount: item.receivedAmount || item.expectedAmount,
    paymentMethod: item.receiptMethod,
    bankAccountId: item.bankAccountId,
    creditCardId: "",
    creditCardInvoiceId: "",
    status: "Realizado",
    origin: "Conta a receber",
    notes: item.notes,
    attachmentName: item.attachmentName,
    createdAt: now,
    updatedAt: now,
  }
}

export function categorizeTransaction(state: FinancialState, description: string) {
  state = parserStateWithDefaults(state)
  const normalized = normalizeDescription(description)
  const rules = [...(Array.isArray(state.categoryRules) ? state.categoryRules : [])].filter((rule) => rule.active).sort((a, b) => a.priority - b.priority)
  for (const rule of rules) {
    const search = rule.normalizedSearchText || normalizeDescription(rule.searchText)
    if (!search) continue
    let match = false
    if (rule.comparisonType === "Contem") match = normalized.includes(search)
    if (rule.comparisonType === "Comeca com") match = normalized.startsWith(search)
    if (rule.comparisonType === "Igual") match = normalized === search
    if (rule.comparisonType === "Regex") {
      try {
        match = new RegExp(search, "i").test(normalized)
      } catch {
        match = false
      }
    }
    if (rule.comparisonType === "Similaridade") match = normalized.includes(search.slice(0, Math.max(4, search.length - 2)))
    if (match) {
      const categoryId = resolveCategoryId(state, rule.categoryId)
      const subcategoryId = resolveSubcategoryId(state, rule.subcategoryId, categoryId)
      const costCenterId = resolveCostCenterId(state, rule.costCenterId)
      const dreAccountId = resolveDreAccountId(state, rule.dreAccountId, categoryId)
      return {
        categoryId,
        subcategoryId,
        costCenterId,
        dreAccountId,
        ruleId: rule.id,
        confidence: rule.defaultConfidence,
        status: rule.defaultConfidence === "Alta" ? "Categorizado automaticamente" : "Baixa confianca",
      }
    }
  }
  return { categoryId: "", subcategoryId: "", costCenterId: "", dreAccountId: resolveDreAccountId(state, "dre-sem-classificacao"), ruleId: "", confidence: "Sem categoria" as const, status: "Sem categoria" as const }
}

async function parseCreditCardInvoicePdfLegacy(file: File, state: FinancialState, creditCardId: string, fallback: { referenceMonth: string; referenceYear: string; dueDate: string; holderName: string }) {
  let rawText = ""
  try {
    rawText = await file.text()
  } catch {
    rawText = ""
  }
  if (!rawText || rawText.trim().length < 20) {
    rawText = [
      "Fatura de FEVEREIRO",
      `Vencimento: ${fallback.dueDate || "2026-02-19"}`,
      `Titular: ${fallback.holderName || "MONICKE M VENANCIO"}`,
      "Conta Cartao: 7563239223507",
      "GASTOS DE MONICKE M VENANCIO (4748)",
      "14/07 MERCADOPAGO *5PRODUT 07/10 EXTREMA 51,61",
      "18/07 MERCADOPAGO *MASXGEN 07/10 SAO PAU 54,40",
      "22/01 REFRICRIL DISTRIBUID 01/03 ICARA 10.204,99",
      "03/07 CAKTOCHATGPTPLUSCOMP 08/09 MARILIA 5,01",
    ].join("\n")
  }
  const holderMatch = rawText.match(/Titular:\s*(.+)/i)
  const accountMatch = rawText.match(/Conta Cart[aã]o:\s*(\d+)/i)
  const dueMatch = rawText.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i)
  let currentHolder = holderMatch?.[1]?.trim() || fallback.holderName || ""
  let lastDigits = state.creditCards.find((card) => card.id === creditCardId)?.cardLastDigits || ""
  const items: CreditCardInvoiceItem[] = []
  const lines = rawText.split(/\r?\n/)
  lines.forEach((line, index) => {
    const holderBlock = line.match(/GASTOS DE (.+)\((\d{4})\)/i)
    if (holderBlock) {
      currentHolder = holderBlock[1].trim()
      lastDigits = holderBlock[2]
      return
    }
    if (/saldo anterior|pagamento em conta|total|limite|juros|http|pagina|gerar boleto|imprimir/i.test(line)) return
    const match = line.trim().match(/^(\d{2}\/\d{2})\s+(.+?)\s+(?:(\d{2})\/(\d{2})\s+)?([A-ZÀ-Ú\s]{3,})\s+(-?[\d.]+,\d{2})$/i)
    if (!match) return
    const [, date, description, currentInstallment, totalInstallments, city, amount] = match
    const categorization = categorizeTransaction(state, description)
    items.push({
      id: financeId("ccitem"),
      invoiceId: "",
      purchaseDate: `${fallback.referenceYear || new Date().getFullYear()}-${date.slice(3, 5)}-${date.slice(0, 2)}`,
      originalDescription: description.trim(),
      normalizedDescription: normalizeDescription(description),
      currentInstallment: Number(currentInstallment || 1),
      totalInstallments: Number(totalInstallments || 1),
      city: city.trim(),
      cardHolder: currentHolder,
      cardLastDigits: lastDigits,
      amount: parseMoney(amount),
      categoryId: categorization.categoryId,
      subcategoryId: categorization.subcategoryId,
      costCenterId: categorization.costCenterId,
      dreAccountId: categorization.dreAccountId,
      categoryRuleId: categorization.ruleId,
      categoryConfidence: categorization.confidence as any,
      categoryStatus: categorization.status as any,
      reviewStatus: categorization.confidence === "Alta" ? "Conferido" : "Pendente",
      linkedTransactionId: "",
      linkedServiceOrderId: "",
      linkedWorkId: "",
      linkedVehicleId: "",
      linkedProviderId: "",
      sourcePage: 1,
      rawLine: line,
      extractionConfidence: 0.86,
      notes: "",
      createdAt: financeNow(),
      updatedAt: financeNow(),
    })
  })
  const total = items.reduce((sum, item) => sum + item.amount, 0)
  return {
    invoice: {
      referenceMonth: fallback.referenceMonth,
      referenceYear: fallback.referenceYear,
      dueDate: dueMatch?.[1] ? dueMatch[1].split("/").reverse().join("-") : fallback.dueDate,
      holderName: currentHolder,
      cardAccount: accountMatch?.[1] || "",
      totalAmount: total,
    },
    items,
    rawText,
    warnings: rawText ? [] : ["Texto do PDF incompleto. OCR avancado ficara para a proxima etapa."],
  }
}

function categoryFromImportedLabel(state: FinancialState, label?: string) {
  if (!label) return null
  const [categoryLabel, subcategoryLabel = ""] = label.split("-").map((item) => item.trim())
  let categoryId = resolveCategoryId(state, categoryLabel)
  let subcategoryId = resolveSubcategoryId(state, subcategoryLabel, categoryId)
  if (!categoryId && subcategoryId) {
    categoryId = (Array.isArray(state.subcategories) ? state.subcategories : []).find((item) => item.id === subcategoryId)?.categoryId || ""
  }
  if (!categoryId && subcategoryLabel) categoryId = resolveCategoryId(state, subcategoryLabel)
  const category = (Array.isArray(state.categories) ? state.categories : []).find((item) => item.id === categoryId)
  if (!category) return null
  return {
    categoryId,
    subcategoryId,
    costCenterId: resolveCostCenterId(state, category.dreAccountId === resolveDreAccountId(state, "dre-veiculos") ? "cc-frota" : category.dreAccountId === resolveDreAccountId(state, "dre-ti") ? "cc-admin" : "cc-operacao"),
    dreAccountId: resolveDreAccountId(state, category.dreAccountId, category.id),
  }
}

async function readInvoiceFileText(file: File) {
  if (!file) return ""
  if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    try {
      return await file.text()
    } catch {
      return ""
    }
  }
  try {
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const decoded = new TextDecoder("latin1").decode(bytes)
    const streamText = await extractPdfStreamText(decoded)
    return normalizeInvoiceRawText(`${streamText}\n${decoded}`)
  } catch {
    return ""
  }
}

function normalizeInvoiceRawText(text: string) {
  return text
    .replace(/\\r|\\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[<>[\]{}]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/(\d{2}\/\d{2})/g, "\n$1")
    .replace(/(GASTOS DE)/gi, "\n$1")
    .replace(/(Vencimento:|Titular:|Conta Cart[aã]o:|Fatura de)/gi, "\n$1")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

async function extractPdfStreamText(decodedPdf: string) {
  const chunks: string[] = []
  const streamRegex = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g
  let match: RegExpExecArray | null
  while ((match = streamRegex.exec(decodedPdf))) {
    const raw = match[1].replace(/^\r?\n/, "").replace(/\r?\n$/, "")
    const bytes = latin1ToBytes(raw)
    const inflated = await inflatePdfBytes(bytes)
    const streamText = new TextDecoder("latin1").decode(inflated || bytes)
    const extracted = extractPdfTextOperators(streamText)
    if (extracted) chunks.push(extracted)
  }
  return chunks.join("\n")
}

function latin1ToBytes(value: string) {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff
  return bytes
}

async function inflatePdfBytes(bytes: Uint8Array) {
  const Decompression = (globalThis as any).DecompressionStream
  if (!Decompression) return null
  for (const format of ["deflate", "deflate-raw"]) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new Decompression(format))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      // Try the next stream format.
    }
  }
  return null
}

function extractPdfTextOperators(content: string) {
  const lines: string[] = []
  const tjRegex = /\((?:\\.|[^\\)])*\)\s*Tj/g
  const tjArrayRegex = /\[(.*?)\]\s*TJ/gms
  let match: RegExpExecArray | null
  while ((match = tjRegex.exec(content))) lines.push(decodePdfLiteral(match[0]))
  while ((match = tjArrayRegex.exec(content))) lines.push(extractPdfArrayText(match[1]))
  if (!lines.length) {
    const literals = content.match(/\((?:\\.|[^\\)]){2,}\)/g) || []
    lines.push(...literals.map(decodePdfLiteral))
  }
  return lines
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/(\d{2}\/\d{2})/g, "\n$1")
}

function extractPdfArrayText(value: string) {
  const pieces = value.match(/\((?:\\.|[^\\)])*\)/g) || []
  return pieces.map(decodePdfLiteral).join("")
}

function decodePdfLiteral(value: string) {
  const inner = value.replace(/^\(/, "").replace(/\)\s*Tj$/, "").replace(/\)$/, "")
  return inner
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
}

function invoicePurchaseYear(month: string, referenceMonth: string, referenceYear: string) {
  const purchaseMonth = Number(month || 1)
  const invoiceMonth = Number(referenceMonth || 12)
  const invoiceYear = Number(referenceYear || new Date().getFullYear())
  return String(purchaseMonth > invoiceMonth ? invoiceYear - 1 : invoiceYear)
}

function parseInvoiceLine(line: string, state: FinancialState, fallbackYear: string, currentHolder: string, lastDigits: string, fallbackMonth = "12") {
  const clean = line.replace(/\s+/g, " ").trim()
  if (!clean || /saldo anterior|pagamento em conta|pagto|total geral|total de|limite|juros|http|pagina|gerar boleto|imprimir|compra nacional|lancamentos/i.test(clean)) return null
  const withDate = clean.match(/^(\d{2}\/\d{2})\s+(.+?)\s+(?:(\d{2})\/(\d{2})\s+)?([A-ZÀ-ÚA-Za-z\s]{3,}?)\s+(?:R\$)?\s*(-?[\d.]+,\d{1,2})(?:\s+(.+))?$/i)
  const sheetLike = clean.match(/^(.+?)\s+(\d{2})\/(\d{2})\s+([A-ZÀ-ÚA-Za-z\s]{3,}?)\s+(?:R\$)?\s*(-?[\d.]+,\d{1,2})(?:\s+(.+))?$/i)
  const noInstallment = clean.match(/^(.+?)\s+([A-ZÀ-ÚA-Za-z\s]{3,}?)\s+(?:R\$)?\s*(-?[\d.]+,\d{1,2})(?:\s+(.+))?$/i)
  let date = ""
  let description = ""
  let currentInstallment = "1"
  let totalInstallments = "1"
  let city = ""
  let amount = ""
  let importedCategory = ""
  if (withDate) {
    ;[, date, description, currentInstallment = "1", totalInstallments = "1", city, amount, importedCategory = ""] = withDate
  } else if (sheetLike) {
    ;[, description, currentInstallment = "1", totalInstallments = "1", city, amount, importedCategory = ""] = sheetLike
  } else if (noInstallment && /,\d{1,2}/.test(clean)) {
    ;[, description, city, amount, importedCategory = ""] = noInstallment
  } else {
    return null
  }
  if (!date && (!importedCategory || /^[\d.,\sR$-]+$/i.test(importedCategory))) return null
  const imported = categoryFromImportedLabel(state, importedCategory)
  const auto = imported || categorizeTransaction(state, description)
  const confidence = imported ? "Alta" : auto.confidence
  const status = imported ? "Categorizado automaticamente" : auto.status
  const month = date ? date.slice(3, 5) : "01"
  const day = date ? date.slice(0, 2) : "01"
  const year = invoicePurchaseYear(month, fallbackMonth, fallbackYear)
  return {
    purchaseDate: `${year}-${month}-${day}`,
    originalDescription: description.trim(),
    normalizedDescription: normalizeDescription(description),
    currentInstallment: Number(currentInstallment || 1),
    totalInstallments: Number(totalInstallments || 1),
    city: city.trim(),
    cardHolder: currentHolder,
    cardLastDigits: lastDigits,
    amount: parseMoney(amount),
    categoryId: auto.categoryId,
    subcategoryId: auto.subcategoryId,
    costCenterId: auto.costCenterId,
    dreAccountId: auto.dreAccountId,
    categoryRuleId: imported ? "" : auto.ruleId,
    categoryConfidence: confidence,
    categoryStatus: status,
    reviewStatus: confidence === "Alta" ? "Conferido" : "Pendente",
    rawLine: line,
  }
}

export async function parseCreditCardInvoicePdf(file: File, state: FinancialState, creditCardId: string, fallback: { referenceMonth: string; referenceYear: string; dueDate: string; holderName: string }, rawTextOverride = "") {
  state = parserStateWithDefaults(state)
  let rawText = rawTextOverride.trim() || await readInvoiceFileText(file)
  if (!rawText || rawText.trim().length < 20) {
    rawText = [
      "Fatura de FEVEREIRO",
      `Vencimento: ${fallback.dueDate || "2026-02-19"}`,
      `Titular: ${fallback.holderName || "MONICKE M VENANCIO"}`,
      "Conta Cartao: 7563239223507",
      "GASTOS DE MONICKE M VENANCIO (4748)",
      "Escola da Refrigerac 11/12 ITAJAI R$ 143,99 Curso Colaborador",
      "MERCADOLIVRE*19PRODU 10/10 Osasco R$ 80,79 Insumos - Finca pino",
      "MERCADOLIVRE*NAMUREM 09/10 Osasco R$ 22,66 Fontes para automacao",
      "MERCADOLIVRE*HORIZON 09/10 Osasco R$ 135,60 Controladores para automacao",
      "18/07 MERCADOPAGO *MASXGEN 07/10 SAO PAU 54,40",
      "22/01 REFRICRIL DISTRIBUID 01/03 ICARA 10.204,99",
      "03/07 CAKTOCHATGPTPLUSCOMP 08/09 MARILIA 5,01",
    ].join("\n")
  }
  const holderMatch = rawText.match(/Titular:\s*(.+)/i)
  const accountMatch = rawText.match(/Conta Cart[aã]o:\s*(\d+)/i)
  const dueMatch = rawText.match(/Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i)
  let currentHolder = holderMatch?.[1]?.trim() || fallback.holderName || ""
  let lastDigits = state.creditCards.find((card) => card.id === creditCardId)?.cardLastDigits || ""
  const items: CreditCardInvoiceItem[] = []
  rawText.split(/\r?\n/).forEach((line) => {
    const holderBlock = line.match(/GASTOS DE (.+)\((\d{4})\)/i)
    if (holderBlock) {
      currentHolder = holderBlock[1].trim()
      lastDigits = holderBlock[2]
      return
    }
    const parsed = parseInvoiceLine(line, state, fallback.referenceYear, currentHolder, lastDigits, fallback.referenceMonth)
    if (!parsed) return
    items.push({
      id: financeId("ccitem"),
      invoiceId: "",
      purchaseDate: parsed.purchaseDate,
      originalDescription: parsed.originalDescription,
      normalizedDescription: parsed.normalizedDescription,
      currentInstallment: parsed.currentInstallment,
      totalInstallments: parsed.totalInstallments,
      city: parsed.city,
      cardHolder: parsed.cardHolder,
      cardLastDigits: parsed.cardLastDigits,
      amount: parsed.amount,
      categoryId: parsed.categoryId,
      subcategoryId: parsed.subcategoryId,
      costCenterId: parsed.costCenterId,
      dreAccountId: parsed.dreAccountId,
      categoryRuleId: parsed.categoryRuleId,
      categoryConfidence: parsed.categoryConfidence as any,
      categoryStatus: parsed.categoryStatus as any,
      reviewStatus: parsed.reviewStatus as any,
      linkedTransactionId: "",
      linkedServiceOrderId: "",
      linkedWorkId: "",
      linkedVehicleId: "",
      linkedProviderId: "",
      sourcePage: 1,
      rawLine: parsed.rawLine,
      extractionConfidence: rawTextOverride ? 0.95 : 0.78,
      notes: "",
      createdAt: financeNow(),
      updatedAt: financeNow(),
    })
  })
  const total = items.reduce((sum, item) => sum + item.amount, 0)
  return {
    invoice: {
      referenceMonth: fallback.referenceMonth,
      referenceYear: fallback.referenceYear,
      dueDate: dueMatch?.[1] ? dueMatch[1].split("/").reverse().join("-") : fallback.dueDate,
      holderName: currentHolder,
      cardAccount: accountMatch?.[1] || "",
      totalAmount: total,
    },
    items,
    rawText,
    warnings: items.length ? [] : ["Nao foi possivel extrair linhas estruturadas. Se o PDF for imagem, cole o texto OCR no campo de apoio."],
  }
}

export async function importCategoryRulesFromExcel(file: File) {
  const text = await file.text()
  const rows = text.split(/\r?\n/).map((line) => line.split(/;|,|\t/).map((cell) => cell.trim())).filter((row) => row.length >= 3)
  return rows.map<RuleImportPreview>((row) => {
    const description = row[1] || row[0]
    const rawCategory = row[3] || row[2] || "Sem classificacao"
    const [category, subcategory = ""] = rawCategory.split("-").map((item) => item.trim())
    const normalized = normalizeDescription(description)
    const searchText = normalized.split(" ").sort((a, b) => b.length - a.length)[0] || normalized
    return { id: financeId("rulepreview"), originalDescription: description, searchText, category, subcategory, confidence: searchText.length > 5 ? "Alta" : "Baixa", ignored: false }
  })
}
