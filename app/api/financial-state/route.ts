import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { createAdminClient, createClient, getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { defaultFinancialState, normalizeDescription, type FinancialState } from "@/lib/financial-storage"

export const dynamic = "force-dynamic"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value?: string) {
  return Boolean(value && uuidPattern.test(value))
}

function nullableUuid(value?: string) {
  return isUuid(value) ? value : null
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`finance:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string, companyId = "") {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(`${companyId}:${value}`)
}

function parseBrazilianAmount(value = "") {
  return Number(value.replace(/\./g, "").replace(",", "."))
}

function officialInvoiceTotal(rawText = "") {
  const totals = [...rawText.matchAll(/(?:^|\r|\n)\s*TOTAL\s+((?:\d{1,3}\.)*\d{1,3},\d{2})/gi)]
    .map((match) => parseBrazilianAmount(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
  return totals.length ? Math.max(...totals) : 0
}

function invoiceAdjustmentId(invoiceId: string) {
  return uuidFromText(`credit-card-invoice-adjustment:${invoiceId}`)
}

function normalizeFinancialStateIds(state: FinancialState, companyId = ""): FinancialState {
  const defaults = defaultFinancialState()
  const alias = new Map<string, string>()
  const key = (value = "") => normalizeDescription(value)
  const mergeByName = <T extends { id: string; name: string }>(current: T[] = [], defaultRows: T[] = []) => {
    const rows = [...current]
    defaultRows.forEach((defaultRow) => {
      const existing = rows.find((row) => key(row.name) === key(defaultRow.name))
      if (existing) alias.set(defaultRow.id, existing.id)
      else rows.push(defaultRow)
    })
    return rows
  }

  const dreAccounts = mergeByName(Array.isArray(state.dreAccounts) ? state.dreAccounts : [], defaults.dreAccounts)
  const categories = mergeByName(Array.isArray(state.categories) ? state.categories : [], defaults.categories)
  const costCenters = mergeByName(Array.isArray(state.costCenters) ? state.costCenters : [], defaults.costCenters)
  const categoryRef = (id?: string) => alias.get(id || "") || id || ""
  const subcategories = [...(Array.isArray(state.subcategories) ? state.subcategories : [])]
  defaults.subcategories.forEach((defaultRow) => {
    const defaultCategoryId = categoryRef(defaultRow.categoryId)
    const existing = subcategories.find((row) => key(row.name) === key(defaultRow.name) && categoryRef(row.categoryId) === defaultCategoryId)
    if (existing) alias.set(defaultRow.id, existing.id)
    else subcategories.push(defaultRow)
  })
  const categoryRules = [...(Array.isArray(state.categoryRules) ? state.categoryRules : [])]
  defaults.categoryRules.forEach((defaultRow) => {
    const existing = categoryRules.find((row) => key(row.searchText) === key(defaultRow.searchText))
    if (existing) alias.set(defaultRow.id, existing.id)
    else categoryRules.push(defaultRow)
  })
  state = { ...defaults, ...state, dreAccounts, categories, subcategories, costCenters, categoryRules }

  const map = new Map<string, string>()
  const remember = (id?: string) => {
    const resolved = alias.get(id || "") || id
    if (id && resolved) map.set(id, normalizeId(resolved, companyId))
  }
  const ref = (id?: string) => {
    const resolved = alias.get(id || "") || id
    return resolved ? map.get(resolved) || map.get(id || "") || normalizeId(resolved, companyId) : ""
  }

  state.dreAccounts.forEach((x) => remember(x.id))
  state.categories.forEach((x) => remember(x.id))
  state.subcategories.forEach((x) => remember(x.id))
  state.costCenters.forEach((x) => remember(x.id))
  state.creditCards.forEach((x) => remember(x.id))
  state.accountsPayable.forEach((x) => remember(x.id))
  state.accountsReceivable.forEach((x) => remember(x.id))
  state.creditCardInvoices.forEach((x) => remember(x.id))
  state.transactions.forEach((x) => remember(x.id))
  state.creditCardInvoiceItems.forEach((x) => remember(x.id))
  state.categoryRules.forEach((x) => remember(x.id))

  return {
    ...state,
    dreAccounts: state.dreAccounts.map((x) => ({ ...x, id: ref(x.id), parentId: ref(x.parentId) })),
    categories: state.categories.map((x) => ({ ...x, id: ref(x.id), dreAccountId: ref(x.dreAccountId) })),
    subcategories: state.subcategories.map((x) => ({ ...x, id: ref(x.id), categoryId: ref(x.categoryId) })),
    costCenters: state.costCenters.map((x) => ({ ...x, id: ref(x.id) })),
    creditCards: state.creditCards.map((x) => ({ ...x, id: ref(x.id) })),
    accountsPayable: state.accountsPayable.map((x) => ({ ...x, id: ref(x.id), categoryId: ref(x.categoryId), subcategoryId: ref(x.subcategoryId), costCenterId: ref(x.costCenterId), dreAccountId: ref(x.dreAccountId), workId: ref(x.workId), environmentId: ref(x.environmentId), pointId: ref(x.pointId), serviceOrderId: ref(x.serviceOrderId), providerId: ref(x.providerId), vehicleId: ref(x.vehicleId), bankAccountId: ref(x.bankAccountId), creditCardId: ref(x.creditCardId), creditCardInvoiceId: ref(x.creditCardInvoiceId), transactionId: ref(x.transactionId) })),
    accountsReceivable: state.accountsReceivable.map((x) => ({ ...x, id: ref(x.id), clientId: ref(x.clientId), workId: ref(x.workId), environmentId: ref(x.environmentId), pointId: ref(x.pointId), serviceOrderId: ref(x.serviceOrderId), categoryId: ref(x.categoryId), subcategoryId: ref(x.subcategoryId), costCenterId: ref(x.costCenterId), dreAccountId: ref(x.dreAccountId), bankAccountId: ref(x.bankAccountId), transactionId: ref(x.transactionId) })),
    creditCardInvoices: state.creditCardInvoices.map((x) => ({ ...x, id: ref(x.id), creditCardId: ref(x.creditCardId), accountsPayableId: ref(x.accountsPayableId) })),
    transactions: state.transactions.map((x) => ({ ...x, id: ref(x.id), categoryId: ref(x.categoryId), subcategoryId: ref(x.subcategoryId), costCenterId: ref(x.costCenterId), dreAccountId: ref(x.dreAccountId), clientId: ref(x.clientId), workId: ref(x.workId), environmentId: ref(x.environmentId), pointId: ref(x.pointId), serviceOrderId: ref(x.serviceOrderId), providerId: ref(x.providerId), vehicleId: ref(x.vehicleId), bankAccountId: ref(x.bankAccountId), creditCardId: ref(x.creditCardId), creditCardInvoiceId: ref(x.creditCardInvoiceId) })),
    creditCardInvoiceItems: state.creditCardInvoiceItems.map((x) => ({ ...x, id: ref(x.id), invoiceId: ref(x.invoiceId), categoryId: ref(x.categoryId), subcategoryId: ref(x.subcategoryId), costCenterId: ref(x.costCenterId), dreAccountId: ref(x.dreAccountId), categoryRuleId: ref(x.categoryRuleId), linkedTransactionId: ref(x.linkedTransactionId), linkedServiceOrderId: ref(x.linkedServiceOrderId), linkedWorkId: ref(x.linkedWorkId), linkedVehicleId: ref(x.linkedVehicleId), linkedProviderId: ref(x.linkedProviderId) })),
    categoryRules: state.categoryRules.map((x) => ({ ...x, id: ref(x.id), categoryId: ref(x.categoryId), subcategoryId: ref(x.subcategoryId), costCenterId: ref(x.costCenterId), dreAccountId: ref(x.dreAccountId), creditCardId: ref(x.creditCardId) })),
  }
}

async function table(supabase: ReturnType<typeof createAdminClient>, name: string) {
  const columns = name === "credit_card_invoices"
    ? "id, credit_card_id, reference_month, reference_year, due_date, holder_name, card_account, total_amount, imported_amount, difference_amount, status, pdf_file_name, accounts_payable_id, created_at, updated_at"
    : "*"
  const rows: any[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(name)
      .select(columns)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${name}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, name: string, rows: any[]) {
  if (!rows.length) return
  const uniqueRows = Array.from(new Map(rows.filter((row) => row?.id).map((row) => [row.id, row])).values())
  if (!uniqueRows.length) return
  const { error } = await supabase.from(name).upsert(uniqueRows, { onConflict: "id" })
  if (error) throw new Error(`${name}: ${error.message}`)
}

const financeTables = [
  "dre_accounts",
  "financial_categories",
  "financial_subcategories",
  "cost_centers",
  "credit_cards",
  "category_rules",
  "accounts_payable",
  "accounts_receivable",
  "credit_card_invoices",
  "financial_transactions",
  "credit_card_invoice_items",
] as const

const financeReferenceTables = [
  "dre_accounts",
  "financial_categories",
  "financial_subcategories",
  "cost_centers",
  "credit_cards",
  "category_rules",
] as const

const financialCacheTtlMs = 30_000
const financialStateCache = new Map<string, { state: FinancialState; expiresAt: number }>()
const financialStateLoads = new Map<string, Promise<FinancialState>>()

function fromDb(rows: Record<string, any[]>): FinancialState {
  const defaults = defaultFinancialState()
  return {
    ...defaults,
    dreAccounts: rows.dre_accounts.length ? rows.dre_accounts.map((x) => ({ id: x.id, name: x.name, parentId: x.parent_id || "", type: x.type, orderIndex: Number(x.order_index || 1), signal: x.signal, formula: x.formula || "", status: x.status, createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.dreAccounts,
    categories: rows.financial_categories.length ? rows.financial_categories.map((x) => ({ id: x.id, name: x.name, type: x.type, dreAccountId: x.dre_account_id || "", status: x.status, createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.categories,
    subcategories: rows.financial_subcategories.length ? rows.financial_subcategories.map((x) => ({ id: x.id, categoryId: x.category_id, name: x.name, status: x.status, createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.subcategories,
    costCenters: rows.cost_centers.length ? rows.cost_centers.map((x) => ({ id: x.id, name: x.name, description: x.description || "", status: x.status, createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.costCenters,
    creditCards: rows.credit_cards.length ? rows.credit_cards.map((x) => ({ id: x.id, name: x.name, bankName: x.bank_name || "", cardLastDigits: x.card_last_digits || "", holderName: x.holder_name || "", cardAccount: x.card_account || "", closingDay: Number(x.closing_day || 1), dueDay: Number(x.due_day || 1), creditLimit: Number(x.credit_limit || 0), status: x.status, notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.creditCards,
    accountsPayable: rows.accounts_payable.map((x) => ({ id: x.id, supplierId: x.supplier_id || "", supplierName: x.supplier_name || "", description: x.description, categoryId: x.category_id || "", subcategoryId: x.subcategory_id || "", costCenterId: x.cost_center_id || "", dreAccountId: x.dre_account_id || "", workId: x.work_id || "", environmentId: x.environment_id || "", pointId: x.point_id || "", serviceOrderId: x.service_order_id || "", providerId: x.provider_id || "", vehicleId: x.vehicle_id || "", competenceDate: x.competence_date || "", dueDate: x.due_date || "", paymentDate: x.payment_date || "", expectedAmount: Number(x.expected_amount || 0), paidAmount: Number(x.paid_amount || 0), paymentMethod: x.payment_method || "", bankAccountId: x.bank_account_id || "", creditCardId: x.credit_card_id || "", creditCardInvoiceId: x.credit_card_invoice_id || "", status: x.status, origin: x.origin || "Manual", notes: x.notes || "", attachmentName: x.attachment_url || "", transactionId: "", createdAt: x.created_at, updatedAt: x.updated_at })),
    accountsReceivable: rows.accounts_receivable.map((x) => ({ id: x.id, clientId: x.client_id || "", workId: x.work_id || "", environmentId: x.environment_id || "", pointId: x.point_id || "", serviceOrderId: x.service_order_id || "", description: x.description, categoryId: x.category_id || "", subcategoryId: x.subcategory_id || "", costCenterId: x.cost_center_id || "", dreAccountId: x.dre_account_id || "", competenceDate: x.competence_date || "", dueDate: x.due_date || "", receivedDate: x.received_date || "", expectedAmount: Number(x.expected_amount || 0), receivedAmount: Number(x.received_amount || 0), receiptMethod: x.receipt_method || "", bankAccountId: x.bank_account_id || "", status: x.status, origin: x.origin || "Manual", notes: x.notes || "", attachmentName: x.attachment_url || "", transactionId: "", createdAt: x.created_at, updatedAt: x.updated_at })),
    creditCardInvoices: rows.credit_card_invoices.map((x) => ({ id: x.id, creditCardId: x.credit_card_id, referenceMonth: String(x.reference_month || ""), referenceYear: String(x.reference_year || ""), dueDate: x.due_date || "", holderName: x.holder_name || "", cardAccount: x.card_account || "", totalAmount: Number(x.total_amount || 0), importedAmount: Number(x.imported_amount || 0), differenceAmount: Number(x.difference_amount || 0), status: x.status, pdfFileName: x.pdf_file_name || x.pdf_file_url || "", rawText: x.raw_text || "", accountsPayableId: x.accounts_payable_id || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    transactions: rows.financial_transactions.map((x) => ({ id: x.id, type: x.type === "entrada" ? "Entrada" : "Saida", description: x.description, categoryId: x.category_id || "", subcategoryId: x.subcategory_id || "", costCenterId: x.cost_center_id || "", dreAccountId: x.dre_account_id || "", clientId: x.client_id || "", workId: x.work_id || "", environmentId: x.environment_id || "", pointId: x.point_id || "", serviceOrderId: x.service_order_id || "", providerId: x.provider_id || "", vehicleId: x.vehicle_id || "", supplierName: x.supplier_name || "", competenceDate: x.competence_date || "", dueDate: x.due_date || "", realizedDate: x.realized_date || "", expectedAmount: Number(x.expected_amount || 0), realizedAmount: Number(x.realized_amount || 0), paymentMethod: x.payment_method || "", bankAccountId: x.bank_account_id || "", creditCardId: x.credit_card_id || "", creditCardInvoiceId: x.credit_card_invoice_id || "", status: x.status, origin: x.origin || "Manual", notes: x.notes || "", attachmentName: x.attachment_url || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    creditCardInvoiceItems: rows.credit_card_invoice_items.map((x) => ({ id: x.id, invoiceId: x.invoice_id, purchaseDate: x.purchase_date || "", originalDescription: x.original_description, normalizedDescription: x.normalized_description || "", currentInstallment: Number(x.current_installment || 1), totalInstallments: Number(x.total_installments || 1), city: x.city || "", cardHolder: x.card_holder || "", cardLastDigits: x.card_last_digits || "", amount: Number(x.amount || 0), categoryId: x.category_id || "", subcategoryId: x.subcategory_id || "", costCenterId: x.cost_center_id || "", dreAccountId: x.dre_account_id || "", categoryRuleId: x.category_rule_id || "", categoryConfidence: x.category_confidence || "Sem categoria", categoryStatus: x.category_status || "Sem categoria", reviewStatus: x.review_status || "Pendente", linkedTransactionId: x.linked_transaction_id || "", linkedServiceOrderId: x.linked_service_order_id || "", linkedWorkId: x.linked_work_id || "", linkedVehicleId: x.linked_vehicle_id || "", linkedProviderId: x.linked_provider_id || "", sourcePage: Number(x.source_page || 1), rawLine: x.raw_line || "", extractionConfidence: Number(x.extraction_confidence || 0), notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })),
    categoryRules: rows.category_rules.length ? rows.category_rules.map((x) => ({ id: x.id, name: x.name, priority: Number(x.priority || 100), searchText: x.search_text, normalizedSearchText: x.normalized_search_text, comparisonType: x.comparison_type, categoryId: x.category_id || "", subcategoryId: x.subcategory_id || "", costCenterId: x.cost_center_id || "", dreAccountId: x.dre_account_id || "", creditCardId: x.credit_card_id || "", cardHolder: x.card_holder || "", defaultConfidence: x.default_confidence, active: Boolean(x.active), notes: x.notes || "", createdAt: x.created_at, updatedAt: x.updated_at })) : defaults.categoryRules,
  }
}

function toDb(state: FinancialState) {
  const valid = <T extends { id: string }>(items: T[]) => items.filter((x) => isUuid(x.id))
  const validTransactions = valid(state.transactions)
  const validInvoices = valid(state.creditCardInvoices).filter((x) => isUuid(x.creditCardId))
  const transactionIds = new Set(validTransactions.map((x) => x.id))
  const invoiceIds = new Set(validInvoices.map((x) => x.id))
  return {
    dre_accounts: valid(state.dreAccounts).map((x) => ({ id: x.id, name: x.name, parent_id: nullableUuid(x.parentId), type: x.type, order_index: x.orderIndex, signal: x.signal, formula: x.formula, status: x.status })),
    financial_categories: valid(state.categories).map((x) => ({ id: x.id, name: x.name, type: x.type, dre_account_id: nullableUuid(x.dreAccountId), status: x.status })),
    financial_subcategories: valid(state.subcategories).filter((x) => isUuid(x.categoryId)).map((x) => ({ id: x.id, category_id: x.categoryId, name: x.name, status: x.status })),
    cost_centers: valid(state.costCenters).map((x) => ({ id: x.id, name: x.name, description: x.description, status: x.status })),
    credit_cards: valid(state.creditCards).map((x) => ({ id: x.id, name: x.name, bank_name: x.bankName, card_last_digits: x.cardLastDigits, holder_name: x.holderName, card_account: x.cardAccount, closing_day: x.closingDay, due_day: x.dueDay, credit_limit: x.creditLimit, status: x.status, notes: x.notes })),
    accounts_payable: valid(state.accountsPayable).map((x) => ({ id: x.id, supplier_id: nullableUuid(x.supplierId), supplier_name: x.supplierName, description: x.description, category_id: nullableUuid(x.categoryId), subcategory_id: nullableUuid(x.subcategoryId), cost_center_id: nullableUuid(x.costCenterId), dre_account_id: nullableUuid(x.dreAccountId), work_id: nullableUuid(x.workId), environment_id: nullableUuid(x.environmentId), point_id: nullableUuid(x.pointId), service_order_id: nullableUuid(x.serviceOrderId), provider_id: nullableUuid(x.providerId), vehicle_id: nullableUuid(x.vehicleId), competence_date: x.competenceDate || null, due_date: x.dueDate || null, payment_date: x.paymentDate || null, expected_amount: x.expectedAmount, paid_amount: x.paidAmount, payment_method: x.paymentMethod, bank_account_id: nullableUuid(x.bankAccountId), credit_card_id: nullableUuid(x.creditCardId), credit_card_invoice_id: null, status: x.status, origin: x.origin, notes: x.notes, attachment_url: x.attachmentName })),
    accounts_receivable: valid(state.accountsReceivable).map((x) => ({ id: x.id, client_id: nullableUuid(x.clientId), work_id: nullableUuid(x.workId), environment_id: nullableUuid(x.environmentId), point_id: nullableUuid(x.pointId), service_order_id: nullableUuid(x.serviceOrderId), description: x.description, category_id: nullableUuid(x.categoryId), subcategory_id: nullableUuid(x.subcategoryId), cost_center_id: nullableUuid(x.costCenterId), dre_account_id: nullableUuid(x.dreAccountId), competence_date: x.competenceDate || null, due_date: x.dueDate || null, received_date: x.receivedDate || null, expected_amount: x.expectedAmount, received_amount: x.receivedAmount, receipt_method: x.receiptMethod, bank_account_id: nullableUuid(x.bankAccountId), status: x.status, origin: x.origin || "Manual", notes: x.notes, attachment_url: x.attachmentName })),
    credit_card_invoices: validInvoices.map((x) => ({ id: x.id, credit_card_id: x.creditCardId, reference_month: Number(x.referenceMonth || 1), reference_year: Number(x.referenceYear || new Date().getFullYear()), due_date: x.dueDate || null, holder_name: x.holderName, card_account: x.cardAccount, total_amount: x.totalAmount, imported_amount: x.importedAmount, difference_amount: x.differenceAmount, status: x.status, pdf_file_name: x.pdfFileName, ...(x.rawText ? { raw_text: x.rawText } : {}), accounts_payable_id: null })),
    financial_transactions: validTransactions.map((x) => ({ id: x.id, type: x.type === "Entrada" ? "entrada" : "saida", description: x.description, category_id: nullableUuid(x.categoryId), subcategory_id: nullableUuid(x.subcategoryId), cost_center_id: nullableUuid(x.costCenterId), dre_account_id: nullableUuid(x.dreAccountId), client_id: nullableUuid(x.clientId), work_id: nullableUuid(x.workId), environment_id: nullableUuid(x.environmentId), point_id: nullableUuid(x.pointId), service_order_id: nullableUuid(x.serviceOrderId), provider_id: nullableUuid(x.providerId), vehicle_id: nullableUuid(x.vehicleId), supplier_name: x.supplierName, competence_date: x.competenceDate || null, due_date: x.dueDate || null, realized_date: x.realizedDate || null, expected_amount: x.expectedAmount, realized_amount: x.realizedAmount, payment_method: x.paymentMethod, bank_account_id: nullableUuid(x.bankAccountId), credit_card_id: nullableUuid(x.creditCardId), credit_card_invoice_id: nullableUuid(x.creditCardInvoiceId), status: x.status, origin: x.origin, notes: x.notes, attachment_url: x.attachmentName })),
    credit_card_invoice_items: valid(state.creditCardInvoiceItems).filter((x) => isUuid(x.invoiceId) && invoiceIds.has(x.invoiceId)).map((x) => ({ id: x.id, invoice_id: x.invoiceId, purchase_date: x.purchaseDate || null, original_description: x.originalDescription, normalized_description: x.normalizedDescription, current_installment: x.currentInstallment, total_installments: x.totalInstallments, city: x.city, card_holder: x.cardHolder, card_last_digits: x.cardLastDigits, amount: x.amount, category_id: nullableUuid(x.categoryId), subcategory_id: nullableUuid(x.subcategoryId), cost_center_id: nullableUuid(x.costCenterId), dre_account_id: nullableUuid(x.dreAccountId), category_rule_id: nullableUuid(x.categoryRuleId), category_confidence: x.categoryConfidence, category_status: x.categoryStatus, review_status: x.reviewStatus, linked_transaction_id: transactionIds.has(x.linkedTransactionId) ? x.linkedTransactionId : null, linked_service_order_id: nullableUuid(x.linkedServiceOrderId), linked_work_id: nullableUuid(x.linkedWorkId), linked_vehicle_id: nullableUuid(x.linkedVehicleId), linked_provider_id: nullableUuid(x.linkedProviderId), source_page: x.sourcePage, raw_line: x.rawLine, extraction_confidence: x.extractionConfidence, notes: x.notes })),
    category_rules: valid(state.categoryRules).map((x) => ({ id: x.id, name: x.name, priority: x.priority, search_text: x.searchText, normalized_search_text: x.normalizedSearchText, comparison_type: x.comparisonType, category_id: nullableUuid(x.categoryId), subcategory_id: nullableUuid(x.subcategoryId), cost_center_id: nullableUuid(x.costCenterId), dre_account_id: nullableUuid(x.dreAccountId), credit_card_id: nullableUuid(x.creditCardId), card_holder: x.cardHolder, default_confidence: x.defaultConfidence, active: x.active, notes: x.notes })),
  }
}

async function cleanupDemoFinanceRows(supabase: ReturnType<typeof createAdminClient>) {
  const { error: transactionError } = await supabase
    .from("financial_transactions")
    .delete()
    .in("description", ["Receita prevista instalacao", "Materiais para instalacao"])
  if (transactionError) throw new Error(`financial_transactions cleanup: ${transactionError.message}`)

  const { error: payableError } = await supabase
    .from("accounts_payable")
    .delete()
    .eq("description", "Materiais para instalacao")
    .eq("supplier_name", "REFRICRIL DISTRIBUID")
  if (payableError) throw new Error(`accounts_payable cleanup: ${payableError.message}`)

  const { error: receivableError } = await supabase
    .from("accounts_receivable")
    .delete()
    .eq("description", "Instalacao Torre A - parcela 1")
  if (receivableError) throw new Error(`accounts_receivable cleanup: ${receivableError.message}`)

  const { data: cardRows, error: cardReadError } = await supabase
    .from("financial_transactions")
    .select("id, notes")
    .eq("origin", "Cartao de credito")
  if (cardReadError) throw new Error(`financial_transactions card cleanup read: ${cardReadError.message}`)
  const invalidCardTransactionIds = (cardRows || [])
    .filter((row) => {
      const rawLine = String(row.notes || "").match(/Linha:\s*(.+)$/i)?.[1] || ""
      return rawLine && !/^\d{2}\/\d{2}\b/.test(rawLine)
    })
    .map((row) => row.id)
  if (invalidCardTransactionIds.length) {
    const { error: itemError } = await supabase
      .from("credit_card_invoice_items")
      .delete()
      .in("linked_transaction_id", invalidCardTransactionIds)
    if (itemError) throw new Error(`credit_card_invoice_items invalid cleanup: ${itemError.message}`)

    const { error: cardDeleteError } = await supabase
      .from("financial_transactions")
      .delete()
      .in("id", invalidCardTransactionIds)
    if (cardDeleteError) throw new Error(`financial_transactions invalid cleanup: ${cardDeleteError.message}`)
  }

  const { data: invoiceRows, error: invoiceReadError } = await supabase
    .from("credit_card_invoices")
    .select("id, credit_card_id, reference_month, reference_year, due_date, holder_name, pdf_file_name, raw_text, total_amount")
  if (invoiceReadError) throw new Error(`credit_card_invoices cleanup read: ${invoiceReadError.message}`)
  const invoiceIds = (invoiceRows || []).map((row) => row.id).filter(Boolean)
  if (invoiceIds.length) {
    const { data: transactionRows, error: transactionReadError } = await supabase
      .from("financial_transactions")
      .select("id, credit_card_invoice_id, realized_amount, expected_amount, description")
      .in("credit_card_invoice_id", invoiceIds)
      .eq("origin", "Cartao de credito")
    if (transactionReadError) throw new Error(`financial_transactions invoice total read: ${transactionReadError.message}`)
    const totals = new Map<string, number>()
    ;(transactionRows || []).forEach((row) => {
      const id = row.credit_card_invoice_id
      if (!id) return
      if (row.id === invoiceAdjustmentId(id) || row.description === "Ajuste total da fatura") return
      totals.set(id, (totals.get(id) || 0) + Number(row.realized_amount || row.expected_amount || 0))
    })
    for (const invoice of invoiceRows || []) {
      const id = invoice.id
      const baseTotal = Number((totals.get(id) || 0).toFixed(2))
      const officialTotal = Number((officialInvoiceTotal(invoice.raw_text || "") || baseTotal || Number(invoice.total_amount || 0)).toFixed(2))
      const adjustment = Number((officialTotal - baseTotal).toFixed(2))
      const adjustmentId = invoiceAdjustmentId(id)
      if (Math.abs(adjustment) >= 0.01) {
        const { error: adjustmentError } = await supabase
          .from("financial_transactions")
          .upsert({
            id: adjustmentId,
            type: "saida",
            description: "Ajuste total da fatura",
            supplier_name: invoice.holder_name || "",
            competence_date: invoice.due_date || null,
            due_date: invoice.due_date || null,
            realized_date: invoice.due_date || null,
            expected_amount: 0,
            realized_amount: adjustment,
            payment_method: "Cartao de credito",
            credit_card_id: invoice.credit_card_id,
            credit_card_invoice_id: id,
            status: "Realizado",
            origin: "Cartao de credito",
            notes: `Ajuste automatico para fechar o total oficial da fatura em R$ ${officialTotal.toFixed(2)}. Base extraida: R$ ${baseTotal.toFixed(2)}.`,
            attachment_url: invoice.pdf_file_name || "",
          }, { onConflict: "id" })
        if (adjustmentError) throw new Error(`financial_transactions invoice adjustment: ${adjustmentError.message}`)
      } else {
        const { error: deleteAdjustmentError } = await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", adjustmentId)
        if (deleteAdjustmentError) throw new Error(`financial_transactions adjustment cleanup: ${deleteAdjustmentError.message}`)
      }
      const total = officialTotal
      if (!total) continue
      const { error: invoiceUpdateError } = await supabase
        .from("credit_card_invoices")
        .update({ total_amount: total, imported_amount: total, difference_amount: 0 })
        .eq("id", id)
      if (invoiceUpdateError) throw new Error(`credit_card_invoices total update: ${invoiceUpdateError.message}`)
    }
  }
}

async function loadFinancialState(companyId: string) {
  const supabase = createAdminClient()
  const entries = await Promise.all(
    financeTables.map(async (name) => [name, await table(supabase, name)] as const),
  )
  const result = Object.fromEntries(entries) as Record<string, any[]>
  return normalizeFinancialStateIds(fromDb(result), companyId)
}

export async function GET(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1"
    const cached = financialStateCache.get(companyId)
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ state: cached.state, source: "supabase-cache" })
    }
    if (!financialStateLoads.has(companyId)) financialStateLoads.set(companyId, loadFinancialState(companyId))
    const state = await financialStateLoads.get(companyId)!
    financialStateCache.set(companyId, { state, expiresAt: Date.now() + financialCacheTtlMs })
    financialStateLoads.delete(companyId)
    return NextResponse.json({ state, source: "supabase" })
  } catch (error) {
    financialStateLoads.delete(await getSelectedSystemCompanyId())
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar financeiro no Supabase" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const companyId = await getSelectedSystemCompanyId()
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 })
    const { state } = await request.json() as { state: FinancialState }
    const supabase = createAdminClient()
    const normalizedState = normalizeFinancialStateIds(state, companyId)
    const rows = toDb(normalizedState)
    for (const name of financeTables) {
      await upsertRows(supabase, name, rows[name])
    }
    financialStateCache.set(companyId, { state: normalizedState, expiresAt: Date.now() + financialCacheTtlMs })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar financeiro no Supabase" }, { status: 500 })
  }
}

export async function DELETE() {
  return NextResponse.json({ error: "A exclusao total do financeiro esta desativada." }, { status: 405 })
}
