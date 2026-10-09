"use client"

import React, { useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { AlertTriangle, BarChart3, BellRing, CalendarRange, CheckCircle2, CreditCard, FileText, FileUp, Landmark, Pencil, PlugZap, Plus, Receipt, RefreshCw, Search, Trash2, TrendingDown, TrendingUp, Wallet, XCircle } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { AsaasBalanceCards, AsaasReceivableChargePanel, AsaasSavedChargeButton, AsaasSupplierPaymentButton } from "@/components/finance/asaas-operations"
import { NotaAsInvoicePanel } from "@/components/finance/notaas-invoice-panel"
import { DueAlertsPanel, FinanceRegistriesTab } from "@/components/finance/finance-registries"
import { accountSettlementAmount, accountSourceTypeOptions, addDays, buildInstallments, installmentLabel, payableAutoStatus, paymentMethodOptions, receivableAutoStatus } from "@/lib/finance-erp"
import { useAuth } from "@/lib/auth-context"
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client"
import { makeId, nowIso, type Supplier } from "@/lib/operational-storage"
import { cnpjRegistrationNotes, cleanCpfCnpj, formatCpfCnpjDocument, type CnpjCompany } from "@/lib/cnpj-lookup"
import type { BankStatementItem, BankStatementResult } from "@/lib/bank-statement-parser"
import {
  DataTable,
  FormSheet,
  MetricCard,
  PageShell,
  SaveButton,
  SectionCard,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  names,
  useCrudFeedback,
  useOperationalStore,
} from "@/components/operations/shared"
import {
  type AccountsPayable,
  type AccountsReceivable,
  type CategoryRule,
  type CreditCardInvoiceItem,
  type FinancialCategory,
  type FinancialState,
  type FinancialTransaction,
  type PayableStatus,
  type ReceivableStatus,
  categorizeTransaction,
  categoryName,
  costCenterName,
  defaultFinancialState,
  dreName,
  financeId,
  financeNow,
  financeToday,
  importCategoryRulesFromExcel,
  isOverdue,
  money,
  normalizeDescription,
  parseMoney,
  subcategoryName,
  transactionFromPayable,
  transactionFromReceivable,
} from "@/lib/financial-storage"

type SheetKind = "entrada" | "saida" | "pagar" | "receber" | "dre-receita" | "dre-despesa" | "categoria" | "cartao" | "regra" | ""
type AccountEditTarget =
  | { kind: "pagar"; item: AccountsPayable }
  | { kind: "receber"; item: AccountsReceivable }
  | null

const financeTableViewport = "max-h-[35rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]"
const financeTableRows = "h-auto [&_tbody_tr]:h-[3.15rem] [&_td]:py-2.5"

function inferCardPurchaseDate(date = "", referenceMonth = "", referenceYear = "") {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return date
  const [, year, month, day] = match
  const invoiceMonth = Number(referenceMonth || 12)
  const invoiceYear = Number(referenceYear || year || new Date().getFullYear())
  const purchaseYear = Number(month) > invoiceMonth ? invoiceYear - 1 : invoiceYear
  return `${purchaseYear}-${month}-${day}`
}

function normalizeCardPurchaseDates(state: FinancialState): FinancialState {
  const invoices = Array.isArray(state.creditCardInvoices) ? state.creditCardInvoices : []
  const items = Array.isArray(state.creditCardInvoiceItems) ? state.creditCardInvoiceItems : []
  const correctedByTransaction = new Map<string, string>()
  const creditCardInvoiceItems = items.map((item) => {
    const invoice = invoices.find((row) => row.id === item.invoiceId)
    if (!invoice) return item
    const purchaseDate = inferCardPurchaseDate(item.purchaseDate, invoice.referenceMonth, invoice.referenceYear)
    if (item.linkedTransactionId) correctedByTransaction.set(item.linkedTransactionId, purchaseDate)
    return purchaseDate === item.purchaseDate ? item : { ...item, purchaseDate, updatedAt: financeNow() }
  })
  const transactions = (Array.isArray(state.transactions) ? state.transactions : []).map((item) => {
    const corrected = correctedByTransaction.get(item.id)
    if (!corrected || item.competenceDate === corrected) return item
    return { ...item, competenceDate: corrected, realizedDate: corrected, updatedAt: financeNow() }
  })
  return { ...state, creditCardInvoiceItems, transactions }
}

function mergeFinanceDefaults(state: FinancialState): FinancialState {
  const defaults = defaultFinancialState()
  const key = (value = "") => normalizeDescription(value)
  const mergeNamed = <T extends { id: string; name: string }>(current: T[] = [], fallback: T[] = []) => {
    const rows = [...current]
    fallback.forEach((item) => {
      if (!rows.some((row) => row.id === item.id || key(row.name) === key(item.name))) rows.push(item)
    })
    return rows
  }
  const categories = mergeNamed(Array.isArray(state.categories) ? state.categories : [], defaults.categories)
  const subcategories = [...(Array.isArray(state.subcategories) ? state.subcategories : [])]
  defaults.subcategories.forEach((item) => {
    if (!subcategories.some((row) => row.id === item.id || (key(row.name) === key(item.name) && row.categoryId === item.categoryId))) subcategories.push(item)
  })
  const categoryRules = [...(Array.isArray(state.categoryRules) ? state.categoryRules : [])]
  defaults.categoryRules.forEach((item) => {
    if (!categoryRules.some((row) => row.id === item.id || key(row.searchText) === key(item.searchText))) categoryRules.push(item)
  })
  return normalizeCardPurchaseDates({
    ...defaults,
    ...state,
    categories,
    subcategories,
    costCenters: mergeNamed(Array.isArray(state.costCenters) ? state.costCenters : [], defaults.costCenters),
    dreAccounts: mergeNamed(Array.isArray(state.dreAccounts) ? state.dreAccounts : [], defaults.dreAccounts),
    creditCards: mergeNamed(Array.isArray(state.creditCards) ? state.creditCards : [], defaults.creditCards),
    categoryRules,
  })
}

function useFinancialStore() {
  const [state, setState] = useState<FinancialState>(() => defaultFinancialState())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const persist = async (next: FinancialState) => {
    const response = await fetch("/api/financial-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: next }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || "O Supabase recusou a gravacao do financeiro.")
    }
  }

  const load = async (refreshCache = false) => {
    const response = await fetch(`/api/financial-state${refreshCache ? "?refresh=1" : ""}`, { cache: "no-store" })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar o financeiro.")
    if (payload?.state) {
      const next = mergeFinanceDefaults(payload.state)
      setState(next)
    }
    return payload?.state as FinancialState | undefined
  }

  useEffect(() => {
    load()
      .catch((error) => {
        console.error("Erro ao carregar financeiro", error)
        setLoadError(error instanceof Error ? error.message : "Erro ao carregar o financeiro.")
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        load(true)
          .catch((error) => console.error("Financeiro realtime", error))
      }, 250)
    }
    const channel = supabase.channel("financeiro-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_transactions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts_payable" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts_receivable" }, refresh)
      .subscribe()
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [])
  const commit = (updater: (current: FinancialState) => FinancialState) => {
    setState((current) => {
      const next = mergeFinanceDefaults(updater(current))
      persist(next).catch((error) => {
        alert(error instanceof Error ? error.message : "Erro ao salvar financeiro no Supabase.")
      })
      return next
    })
  }
  const replace = (next: FinancialState) => {
    const merged = mergeFinanceDefaults(next)
    setState(merged)
  }
  const save = async (next: FinancialState) => {
    const merged = mergeFinanceDefaults(next)
    await persist(merged)
    setState(merged)
  }
  return { state, commit, replace, save, refresh: () => load(true), loading, loadError }
}

class FinanceErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: "" }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "Erro inesperado ao abrir o financeiro." }
  }

  componentDidCatch(error: unknown) {
    console.error("Financeiro runtime error", error)
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <PageShell title="Financeiro" description="O modulo financeiro encontrou um dado inconsistente ao carregar.">
        <SectionCard title="Erro ao abrir o Financeiro" description={this.state.message}>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
          </div>
        </SectionCard>
      </PageShell>
    )
  }
}

const emptyTransaction = {
  description: "",
  supplierId: "",
  supplierName: "",
  clientId: "",
  serviceOrderId: "",
  providerId: "",
  vehicleId: "",
  categoryId: "",
  subcategoryId: "",
  costCenterId: "",
  dreAccountId: "",
  competenceDate: financeToday(),
  dueDate: financeToday(),
  realizedDate: "",
  expectedAmount: "",
  realizedAmount: "",
  paymentMethod: "Pix",
  bankAccountId: "",
  creditCardId: "",
  status: "Previsto",
  attachmentName: "",
  notes: "",
  documentNumber: "",
  paymentConditionId: "",
  installments: "1",
  intervalDays: "30",
  interestAmount: "",
  fineAmount: "",
  discountAmount: "",
  sourceType: "Manual",
  sourceReference: "",
  cancelled: false,
}

const emptyQuickSupplier = {
  name: "",
  document: "",
  contactName: "",
  phone: "",
  email: "",
  city: "",
  state: "SP",
  notes: "",
}

const dreMonthOptions = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Marco" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
]

function emptyDreManualForm() {
  const today = financeToday()
  const [year, month] = today.split("-")
  return {
    description: "",
    categoryId: "",
    subcategoryId: "",
    costCenterId: "",
    months: [month],
    years: year,
    status: "Realizado",
    amount: "",
    notes: "",
  }
}

function formatDate(value: string) {
  return value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`)) : "-"
}

type AccountPeriod = { start: string; end: string }
type PayableSort = "supplier-asc" | "supplier-desc" | "due-asc" | "due-desc" | "amount-asc" | "amount-desc"

function isInAccountPeriod(dueDate: string, period: AccountPeriod) {
  if (!period.start && !period.end) return true
  if (!dueDate) return false
  return (!period.start || dueDate >= period.start) && (!period.end || dueDate <= period.end)
}

function escapeReportHtml(value: unknown) {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function transactionFilterDate(item: FinancialTransaction) {
  return item.dueDate || item.competenceDate || item.realizedDate || ""
}

function statusFromDates(status: string, dueDate: string, doneDate: string) {
  if (isOverdue(dueDate, doneDate, status)) return "Vencido"
  return status
}

function transactionAmount(item: FinancialTransaction) {
  return item.status === "Realizado" ? (Number(item.realizedAmount || 0) || Number(item.expectedAmount || 0)) : Number(item.expectedAmount || 0)
}

function isRealizedForFinancialOverview(item: FinancialTransaction) {
  return item.status === "Realizado"
    || item.origin === "Conta a pagar"
    || item.origin === "Conta a receber"
    || (item.origin === "Cartao de credito" && Boolean(item.creditCardInvoiceId))
}

function financialOverviewDate(item: FinancialTransaction) {
  return isRealizedForFinancialOverview(item)
    ? item.realizedDate || item.competenceDate || item.dueDate || ""
    : item.competenceDate || item.dueDate || item.realizedDate || ""
}

function buildFinancialPeriodOverview(transactions: FinancialTransaction[], startDate: string, endDate: string) {
  const monthly: Array<{ key: string; month: string; receitaPrevista: number; receitaRealizada: number; despesaPrevista: number; despesaRealizada: number; saldoPrevisto: number; saldoRealizado: number }> = []
  if (startDate && endDate && startDate <= endDate) {
    const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`)
    const finish = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`)
    while (cursor <= finish && monthly.length < 120) {
      const key = cursor.toISOString().slice(0, 7)
      const month = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(cursor).replace(". de ", "/").replace(".", "")
      monthly.push({ key, month, receitaPrevista: 0, receitaRealizada: 0, despesaPrevista: 0, despesaRealizada: 0, saldoPrevisto: 0, saldoRealizado: 0 })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }
  const byMonth = new Map(monthly.map((row) => [row.key, row]))
  transactions.forEach((item) => {
    const realized = isRealizedForFinancialOverview(item)
    const date = financialOverviewDate(item)
    if (!date || date < startDate || date > endDate) return
    const row = byMonth.get(date.slice(0, 7))
    if (!row) return
    const amount = realized
      ? Number(item.realizedAmount || item.expectedAmount || 0)
      : Number(item.expectedAmount || item.realizedAmount || 0)
    if (item.type === "Entrada") {
      if (realized) row.receitaRealizada += amount
      else row.receitaPrevista += amount
    } else if (realized) row.despesaRealizada += amount
    else row.despesaPrevista += amount
  })
  monthly.forEach((row) => {
    row.saldoPrevisto = row.receitaPrevista - row.despesaPrevista
    row.saldoRealizado = row.receitaRealizada - row.despesaRealizada
  })
  const sum = (key: keyof (typeof monthly)[number]) => monthly.reduce((total, row) => total + Number(row[key] || 0), 0)
  const plannedRevenue = sum("receitaPrevista")
  const realizedRevenue = sum("receitaRealizada")
  const plannedExpense = sum("despesaPrevista")
  const realizedExpense = sum("despesaRealizada")
  return { monthly, metrics: { plannedRevenue, realizedRevenue, plannedExpense, realizedExpense, plannedBalance: plannedRevenue - plannedExpense, realizedBalance: realizedRevenue - realizedExpense } }
}

function compactMoney(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
}

function parseBrazilianInvoiceAmount(value = "") {
  return Number(value.replace(/\./g, "").replace(",", "."))
}

type FinancialSpreadsheetKind = "payable" | "receivable"

function normalizeExcelHeader(value = "") {
  return normalizeDescription(String(value)).replace(/\s+/g, " ").trim()
}

function fieldFromRow(row: Record<string, string>, names: string[]) {
  const wanted = names.map(normalizeExcelHeader)
  const entry = Object.entries(row).find(([key]) => wanted.includes(normalizeExcelHeader(key)))
  return String(entry?.[1] || "").trim()
}

function excelDateToIso(value = "") {
  const text = String(value || "").trim()
  if (!text) return ""
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const serial = Number(text)
  if (Number.isFinite(serial) && serial > 20000) {
    const date = XLSX.SSF.parse_date_code(serial)
    if (date) return `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
  }
  return ""
}

async function readFinancialWorkbook(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false })
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeExcelHeader(cell) === "CODIGO") && row.some((cell) => normalizeExcelHeader(cell) === "VALOR TOTAL"))
  if (headerIndex < 0) throw new Error("Nao encontrei o cabecalho da planilha. Preciso das colunas Codigo e Valor total.")
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim())
  return rows.slice(headerIndex + 1)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header || `Coluna ${index + 1}`, String(cells[index] || "").trim()])))
    .filter((row) => fieldFromRow(row, ["Codigo"]) && fieldFromRow(row, ["Valor total"]))
}

function importedAccountStatus(kind: FinancialSpreadsheetKind, situation: string, dueDate: string) {
  const normalized = normalizeExcelHeader(situation)
  if (normalized.includes("CANCEL")) return kind === "payable" ? "Cancelada" : "Cancelada"
  if (normalized.includes("CONFIRM") || normalized.includes("PAGO") || normalized.includes("RECEB")) return kind === "payable" ? "Paga" : "Recebida"
  if (dueDate && dueDate < financeToday()) return "Vencida"
  return "Aberta"
}

function ensureImportedCategory(state: FinancialState, categories: FinancialCategory[], name: string, type: "entrada" | "saida") {
  const label = name?.trim() || "Sem classificacao"
  const found = categories.find((item) => normalizeDescription(item.name) === normalizeDescription(label))
  if (found) return found.id
  const now = financeNow()
  const category: FinancialCategory = {
    id: financeId("cat"),
    name: label,
    type,
    dreAccountId: type === "entrada" ? "dre-receita-bruta" : "dre-sem-classificacao",
    status: "Ativo",
    createdAt: now,
    updatedAt: now,
  }
  categories.push(category)
  return category.id
}

function ensureImportedCostCenter(state: FinancialState, costCenters: FinancialState["costCenters"], name: string) {
  const label = name?.trim()
  if (!label || label === "-----") return ""
  const found = costCenters.find((item) => normalizeDescription(item.name) === normalizeDescription(label))
  if (found) return found.id
  const now = financeNow()
  const record = { id: financeId("cc"), name: label, description: "Importado de planilha financeira", status: "Ativo" as const, createdAt: now, updatedAt: now }
  costCenters.push(record)
  return record.id
}

function transactionFromImportedPayable(item: AccountsPayable): FinancialTransaction | null {
  if (item.status === "Cancelada") return null
  const now = financeNow()
  return {
    id: item.transactionId,
    type: "Saida",
    description: item.description,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    costCenterId: item.costCenterId,
    dreAccountId: item.dreAccountId,
    clientId: "",
    serviceOrderId: item.serviceOrderId,
    providerId: item.providerId,
    vehicleId: item.vehicleId,
    supplierName: item.supplierName,
    competenceDate: item.competenceDate,
    dueDate: item.dueDate,
    realizedDate: item.paymentDate || item.dueDate,
    expectedAmount: item.expectedAmount,
    realizedAmount: item.paidAmount || item.expectedAmount,
    paymentMethod: item.paymentMethod,
    bankAccountId: item.bankAccountId,
    creditCardId: item.creditCardId,
    creditCardInvoiceId: item.creditCardInvoiceId,
    status: "Realizado",
    origin: "Conta a pagar",
    notes: item.notes,
    attachmentName: item.attachmentName,
    createdAt: now,
    updatedAt: now,
  }
}

function transactionFromImportedReceivable(item: AccountsReceivable): FinancialTransaction | null {
  if (item.status === "Cancelada") return null
  const now = financeNow()
  return {
    id: item.transactionId,
    type: "Entrada",
    description: item.description,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    costCenterId: item.costCenterId,
    dreAccountId: item.dreAccountId,
    clientId: item.clientId,
    serviceOrderId: item.serviceOrderId,
    providerId: "",
    vehicleId: "",
    supplierName: "",
    competenceDate: item.competenceDate,
    dueDate: item.dueDate,
    realizedDate: item.receivedDate || item.dueDate,
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

async function importAccountsSpreadsheet(file: File, kind: FinancialSpreadsheetKind, current: FinancialState) {
  const rows = await readFinancialWorkbook(file)
  const now = financeNow()
  const categories = [...current.categories]
  const costCenters = [...current.costCenters]
  const payables = [...current.accountsPayable]
  const receivables = [...current.accountsReceivable]
  const transactions = [...current.transactions]
  let imported = 0
  let skipped = 0

  rows.forEach((row) => {
    const code = fieldFromRow(row, ["Codigo", "Código"])
    const total = parseMoney(fieldFromRow(row, ["Valor total", "Valor"]))
    if (!code || !Number.isFinite(total) || !total) {
      skipped += 1
      return
    }
    const marker = `Importacao ${kind === "payable" ? "Contas a Pagar" : "Contas a Receber"} | Codigo: ${code} | Arquivo: ${file.name}`
    const alreadyExists = payables.some((item) => item.notes.includes(marker)) || receivables.some((item) => item.notes.includes(marker)) || transactions.some((item) => item.notes.includes(marker))
    if (alreadyExists) {
      skipped += 1
      return
    }
    const description = fieldFromRow(row, ["Descricao", "Descrição"]) || `Lancamento ${code}`
    const plan = fieldFromRow(row, ["Plano de contas"]) || "Sem classificacao"
    const situation = fieldFromRow(row, ["Situacao", "Situação"])
    const competenceDate = excelDateToIso(fieldFromRow(row, ["Data de competencia", "Data de competência"])) || financeToday()
    const dueDate = excelDateToIso(fieldFromRow(row, ["Data de vencimento"])) || competenceDate
    const doneDate = excelDateToIso(fieldFromRow(row, ["Data de confirmacao", "Data de confirmação"]))
    const paymentMethod = fieldFromRow(row, ["Forma de pagamento"])
    const bankAccountId = fieldFromRow(row, ["Conta bancaria", "Conta bancária"])
    const costCenterId = ensureImportedCostCenter(current, costCenters, fieldFromRow(row, ["Centro de custo"]))
    const categoryId = ensureImportedCategory(current, categories, plan, kind === "payable" ? "saida" : "entrada")
    const dreAccountId = categories.find((item) => item.id === categoryId)?.dreAccountId || (kind === "payable" ? "dre-sem-classificacao" : "dre-receita-bruta")
    const status = importedAccountStatus(kind, situation, dueDate)
    const transactionId = financeId("ft")

    if (kind === "payable") {
      const payable: AccountsPayable = {
        id: financeId("ap"),
        supplierName: fieldFromRow(row, ["Destinado a", "Destinado à"]) || "Fornecedor nao informado",
        description,
        categoryId,
        subcategoryId: "",
        costCenterId,
        dreAccountId,
        serviceOrderId: "",
        providerId: "",
        vehicleId: "",
        competenceDate,
        dueDate,
        paymentDate: status === "Paga" ? doneDate || dueDate : "",
        expectedAmount: total,
        paidAmount: status === "Paga" ? total : 0,
        paymentMethod,
        bankAccountId,
        creditCardId: "",
        creditCardInvoiceId: "",
        status: status as PayableStatus,
        origin: "Importacao Excel",
        notes: `${marker}\nSituacao: ${situation}\nPlano de contas: ${plan}`,
        attachmentName: file.name,
        transactionId,
        createdAt: now,
        updatedAt: now,
      }
      const transaction = transactionFromImportedPayable(payable)
      payables.unshift(payable)
      if (transaction) transactions.unshift(transaction)
    } else {
      const receivable: AccountsReceivable = {
        id: financeId("ar"),
        clientId: "",
        serviceOrderId: "",
        description,
        categoryId,
        subcategoryId: "",
        costCenterId,
        dreAccountId,
        competenceDate,
        dueDate,
        receivedDate: status === "Recebida" ? doneDate || dueDate : "",
        expectedAmount: total,
        receivedAmount: status === "Recebida" ? total : 0,
        receiptMethod: paymentMethod,
        bankAccountId,
        status: status as ReceivableStatus,
        origin: "Importacao Excel",
        notes: `${marker}\nCliente/Destinado: ${fieldFromRow(row, ["Destinado a", "Destinado à"])}\nSituacao: ${situation}\nPlano de contas: ${plan}`,
        attachmentName: file.name,
        transactionId,
        createdAt: now,
        updatedAt: now,
      }
      const transaction = transactionFromImportedReceivable(receivable)
      receivables.unshift(receivable)
      if (transaction) transactions.unshift(transaction)
    }
    imported += 1
  })

  return {
    state: { ...current, categories, costCenters, accountsPayable: payables, accountsReceivable: receivables, transactions: dedupeTransactions(transactions) },
    imported,
    skipped,
  }
}

function officialInvoiceTotalFromText(rawText = "") {
  const totals = [...rawText.matchAll(/(?:^|\r|\n)\s*TOTAL\s+((?:\d{1,3}\.)*\d{1,3},\d{2})/gi)]
    .map((match) => parseBrazilianInvoiceAmount(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
  return totals.length ? Math.max(...totals) : 0
}

function invoiceTransactionKey(item: FinancialTransaction) {
  if (item.origin !== "Cartao de credito") return item.id
  const line = item.notes?.match(/Linha:\s*(.+)$/i)?.[1] || ""
  const parcel = item.notes?.match(/Parcela:\s*(\d{1,2}\/\d{1,2})/i)?.[1] || ""
  return [
    item.creditCardInvoiceId,
    item.creditCardId,
    item.description,
    item.dueDate,
    item.competenceDate,
    item.realizedDate,
    transactionAmount(item).toFixed(2),
    parcel,
    line,
  ].map((value) => normalizeDescription(String(value || ""))).join("|")
}

function dedupeTransactions(items: FinancialTransaction[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = invoiceTransactionKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


function accountForm(item: AccountsPayable | AccountsReceivable, kind: "pagar" | "receber") {
  const payable = kind === "pagar" ? item as AccountsPayable : null
  const receivable = kind === "receber" ? item as AccountsReceivable : null
  return {
    ...emptyTransaction,
    description: item.description || "",
    supplierId: payable?.supplierId || "",
    supplierName: payable?.supplierName || "",
    clientId: receivable?.clientId || "",
    serviceOrderId: item.serviceOrderId || "",
    providerId: payable?.providerId || "",
    vehicleId: payable?.vehicleId || "",
    categoryId: item.categoryId || "",
    subcategoryId: item.subcategoryId || "",
    costCenterId: item.costCenterId || "",
    dreAccountId: item.dreAccountId || "",
    competenceDate: item.competenceDate || "",
    dueDate: item.dueDate || "",
    realizedDate: payable?.paymentDate || receivable?.receivedDate || "",
    expectedAmount: String(item.expectedAmount || ""),
    realizedAmount: String(payable?.paidAmount || receivable?.receivedAmount || ""),
    paymentMethod: payable?.paymentMethod || receivable?.receiptMethod || "",
    bankAccountId: item.bankAccountId || "",
    creditCardId: payable?.creditCardId || "",
    status: item.status,
    attachmentName: item.attachmentName || "",
    notes: item.notes || "",
    documentNumber: item.documentNumber || "",
    paymentConditionId: item.paymentConditionId || "",
    installments: String(item.installmentCount || 1),
    interestAmount: item.interestAmount ? String(item.interestAmount) : "",
    fineAmount: item.fineAmount ? String(item.fineAmount) : "",
    discountAmount: item.discountAmount ? String(item.discountAmount) : "",
    sourceType: item.sourceType || (item.serviceOrderId ? "OS" : "Manual"),
    sourceReference: item.sourceReference || "",
    cancelled: item.status === "Cancelada",
  }
}

function accountOriginLabel(item: AccountsPayable | AccountsReceivable, orderNumber?: string) {
  if (item.sourceType === "OS") return `OS ${orderNumber || ""}`.trim()
  if (item.sourceType && item.sourceType !== "Manual") return `${item.sourceType} ${item.sourceReference || ""}`.trim()
  return item.origin || "Manual"
}

function accountTransaction(state: FinancialState, item: AccountsPayable | AccountsReceivable, kind: "pagar" | "receber") {
  if (item.transactionId) {
    const direct = state.transactions.find((transaction) => transaction.id === item.transactionId)
    if (direct) return direct
  }
  return state.transactions.find((transaction) => {
    if (transaction.type !== (kind === "pagar" ? "Saida" : "Entrada")) return false
    if (transaction.description !== item.description || transaction.dueDate !== item.dueDate) return false
    if (transaction.serviceOrderId !== item.serviceOrderId) return false
    if (kind === "pagar" && transaction.supplierName !== (item as AccountsPayable).supplierName) return false
    if (kind === "receber" && transaction.clientId !== (item as AccountsReceivable).clientId) return false
    return Number(transaction.expectedAmount || 0) === Number(item.expectedAmount || 0)
  })
}

function FinanceSheets({
  state,
  commit,
  sheet,
  setSheet,
  editingAccount,
  clearEditingAccount,
  saveState,
  refreshState,
}: {
  state: FinancialState
  commit: (updater: (current: FinancialState) => FinancialState) => void
  sheet: SheetKind
  setSheet: (sheet: SheetKind) => void
  editingAccount: AccountEditTarget
  clearEditingAccount: () => void
  saveState: (next: FinancialState) => Promise<void>
  refreshState: () => Promise<FinancialState | undefined>
}) {
  const operational = useOperationalStore()
  const opNames = names(operational.state)
  const { user } = useAuth()
  const currentUserName = user?.name || user?.email || ""
  const { requireFields, toast } = useCrudFeedback()
  const [form, setForm] = useState<Record<string, any>>(emptyTransaction)
  const accountSubmissionRef = React.useRef(false)
  const [accountSubmitting, setAccountSubmitting] = useState(false)
  const quickSupplierSubmissionRef = React.useRef(false)
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false)
  const [quickSupplierSubmitting, setQuickSupplierSubmitting] = useState(false)
  const [quickSupplierLookup, setQuickSupplierLookup] = useState(false)
  const lastQuickSupplierCnpjRef = React.useRef("")
  const [quickSupplier, setQuickSupplier] = useState({ ...emptyQuickSupplier })
  const [dreForm, setDreForm] = useState<Record<string, any>>(emptyDreManualForm())
  const [category, setCategory] = useState({ name: "", type: "ambos", dreAccountId: "dre-sem-classificacao", status: "Ativo", subcategory: "" })
  const [card, setCard] = useState({ name: "", bankName: "", cardLastDigits: "", holderName: "", cardAccount: "", closingDay: "10", dueDay: "20", creditLimit: "0", status: "Ativo", notes: "" })
  const [rule, setRule] = useState({ name: "", priority: "10", searchText: "", comparisonType: "Contem", categoryId: "", subcategoryId: "", costCenterId: "", dreAccountId: "", creditCardId: "", cardHolder: "", defaultConfidence: "Alta", active: true, notes: "" })

  useEffect(() => {
    if (sheet === "pagar" || sheet === "receber") {
      setForm(editingAccount?.kind === sheet ? accountForm(editingAccount.item, sheet) : { ...emptyTransaction, status: "Aberta" })
    } else if (["entrada", "saida"].includes(sheet)) {
      setForm({ ...emptyTransaction, status: "Previsto" })
    }
    if (["dre-receita", "dre-despesa"].includes(sheet)) setDreForm(emptyDreManualForm())
  }, [sheet, editingAccount])

  useEffect(() => {
    const document = cleanCpfCnpj(quickSupplier.document)
    if (!quickSupplierOpen || document.length !== 14 || lastQuickSupplierCnpjRef.current === document) return
    const timer = window.setTimeout(() => {
      lastQuickSupplierCnpjRef.current = document
      void lookupQuickSupplierCnpj()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [quickSupplierOpen, quickSupplier.document])

  const categoryOptions = (kind: "entrada" | "saida" | "ambos") =>
    state.categories.filter((item) => item.status === "Ativo" && (item.type === "ambos" || item.type === kind || kind === "ambos")).map((item) => ({ value: item.id, label: item.name }))
  const subcategoryOptions = state.subcategories.filter((item) => !form.categoryId || item.categoryId === form.categoryId).map((item) => ({ value: item.id, label: item.name }))
  const costCenterOptions = state.costCenters.map((item) => ({ value: item.id, label: item.name }))
  const dreOptions = state.dreAccounts.map((item) => ({ value: item.id, label: item.name }))
  const clientOptions = [{ value: "nenhum", label: "Sem cliente" }, ...operational.state.clients.map((item) => ({ value: item.id, label: item.name }))]
  const orderOptions = [{ value: "nenhuma", label: "Sem OS" }, ...operational.state.serviceOrders.map((item) => ({ value: item.id, label: item.orderNumber }))]
  const supplierOptions = operational.state.suppliers.map((item) => ({
    value: item.id,
    label: `${item.name}${item.document ? ` - ${item.document}` : ""}${item.status === "Inativo" ? " (Inativo)" : ""}`,
  }))
  const selectedSupplierId = form.supplierId || operational.state.suppliers.find(
    (item) => normalizeDescription(item.name) === normalizeDescription(form.supplierName),
  )?.id || ""

  function close() {
    clearEditingAccount()
    setSheet("")
  }

  function openQuickSupplier() {
    setQuickSupplier({ ...emptyQuickSupplier })
    lastQuickSupplierCnpjRef.current = ""
    setQuickSupplierOpen(true)
  }

  async function lookupQuickSupplierCnpj() {
    const document = cleanCpfCnpj(quickSupplier.document)
    if (document.length !== 14) {
      toast({ title: "CNPJ incompleto", description: "Informe os 14 caracteres do CNPJ.", variant: "destructive" })
      return
    }
    lastQuickSupplierCnpjRef.current = document
    setQuickSupplierLookup(true)
    try {
      const response = await fetch(`/api/cnpj/${encodeURIComponent(document)}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.company) throw new Error(payload?.error || `Falha ao consultar CNPJ (HTTP ${response.status}).`)
      const company = payload.company as CnpjCompany
      setQuickSupplier((current) => ({
        ...current,
        document: company.document,
        name: company.tradeName || company.legalName || current.name,
        phone: company.phone || current.phone,
        email: company.email || current.email,
        city: company.city || current.city,
        state: company.state || current.state,
        notes: cnpjRegistrationNotes(company),
      }))
      toast({ title: "CNPJ encontrado", description: `${company.tradeName || company.legalName} preenchido automaticamente.` })
    } catch (error) {
      toast({ title: "Nao foi possivel consultar o CNPJ", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setQuickSupplierLookup(false)
    }
  }

  async function saveQuickSupplier() {
    if (quickSupplierSubmissionRef.current) return
    if (!requireFields([["Fornecedor", quickSupplier.name], ["Telefone", quickSupplier.phone]])) return

    const now = nowIso()
    const supplier: Supplier = {
      id: makeId("supplier"),
      ...quickSupplier,
      category: "",
      categoryIds: [],
      status: "Ativo",
      notes: quickSupplier.notes,
      createdAt: now,
      updatedAt: now,
    }

    quickSupplierSubmissionRef.current = true
    setQuickSupplierSubmitting(true)
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar fornecedor (HTTP ${response.status}).`)

      const saved: Supplier = payload.supplier
      operational.commit((current) => ({
        ...current,
        suppliers: [saved, ...(current.suppliers || []).filter((item) => item.id !== saved.id)],
      }), { persist: false })
      setForm((current) => ({ ...current, supplierId: saved.id, supplierName: saved.name }))
      setQuickSupplierOpen(false)
      setQuickSupplier({ ...emptyQuickSupplier })
      toast({ title: "Fornecedor salvo", description: `${saved.name} foi selecionado nesta conta.` })
    } catch (error) {
      toast({ title: "Erro ao salvar fornecedor", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      quickSupplierSubmissionRef.current = false
      setQuickSupplierSubmitting(false)
    }
  }

  function transactionPayload(type: "Entrada" | "Saida", statusOverride?: string): FinancialTransaction {
    const now = financeNow()
    return {
      id: financeId("ft"),
      type,
      description: form.description,
      categoryId: form.categoryId,
      subcategoryId: form.subcategoryId,
      costCenterId: form.costCenterId,
      dreAccountId: form.dreAccountId || state.categories.find((item) => item.id === form.categoryId)?.dreAccountId || "dre-sem-classificacao",
      clientId: form.clientId === "nenhum" ? "" : form.clientId,
      serviceOrderId: form.serviceOrderId === "nenhuma" ? "" : form.serviceOrderId,
      providerId: form.providerId || "",
      vehicleId: form.vehicleId || "",
      supplierName: form.supplierName,
      competenceDate: form.competenceDate,
      dueDate: form.dueDate,
      realizedDate: statusOverride === "Realizado" ? form.realizedDate || financeToday() : form.realizedDate,
      expectedAmount: parseMoney(form.expectedAmount),
      realizedAmount: statusOverride === "Realizado" ? parseMoney(form.realizedAmount || form.expectedAmount) : parseMoney(form.realizedAmount),
      paymentMethod: form.paymentMethod,
      bankAccountId: form.bankAccountId,
      creditCardId: form.creditCardId === "nenhum" ? "" : form.creditCardId,
      creditCardInvoiceId: "",
      status: (statusOverride || form.status) as any,
      origin: "Manual",
      notes: form.notes,
      attachmentName: form.attachmentName,
      createdAt: now,
      updatedAt: now,
    }
  }

  function saveTransaction(type: "Entrada" | "Saida", realized = false) {
    if (!requireFields([["Descricao", form.description], ["Valor previsto", form.expectedAmount], ["Categoria", form.categoryId]])) return
    const record = transactionPayload(type, realized ? "Realizado" : form.status)
    commit((current) => ({ ...current, transactions: [record, ...current.transactions] }))
    toast({ title: `${type} salva`, description: "Lancamento criado no financeiro." })
    close()
  }

  function saveDreManualTransaction(type: "Entrada" | "Saida") {
    const amount = parseMoney(dreForm.amount)
    const selectedMonths = Array.isArray(dreForm.months) ? dreForm.months : []
    const selectedYears = String(dreForm.years || "").split(/[,\s;]+/).map((year) => year.trim()).filter(Boolean)
    if (!requireFields([["Categoria", dreForm.categoryId], ["Valor", dreForm.amount], ["Mes", selectedMonths.length ? "ok" : ""], ["Ano", selectedYears.length ? "ok" : ""]])) return
    if (!amount || amount <= 0) {
      toast({ title: "Valor invalido", description: "Informe um valor maior que zero." })
      return
    }

    const now = financeNow()
    const category = state.categories.find((item) => item.id === dreForm.categoryId)
    const status = dreForm.status === "Previsto" ? "Previsto" : "Realizado"
    const description = dreForm.description || `${type === "Entrada" ? "Receita" : "Despesa"} - ${category?.name || "Sem categoria"}`
    const records: FinancialTransaction[] = selectedYears.flatMap((year) => selectedMonths.map((month) => {
      const safeYear = year.replace(/\D/g, "").slice(0, 4)
      const date = `${safeYear}-${month}-01`
      return {
        id: financeId("ft"),
        type,
        description,
        categoryId: dreForm.categoryId,
        subcategoryId: dreForm.subcategoryId === "nenhuma" ? "" : dreForm.subcategoryId,
        costCenterId: dreForm.costCenterId === "nenhum" ? "" : dreForm.costCenterId,
        dreAccountId: category?.dreAccountId || "dre-sem-classificacao",
        clientId: "",
        serviceOrderId: "",
        providerId: "",
        vehicleId: "",
        supplierName: "",
        competenceDate: date,
        dueDate: date,
        realizedDate: status === "Realizado" ? date : "",
        expectedAmount: status === "Previsto" ? amount : 0,
        realizedAmount: status === "Realizado" ? amount : 0,
        paymentMethod: type === "Entrada" ? "Receita manual DRE" : "Despesa manual DRE",
        bankAccountId: "Conta principal",
        creditCardId: "",
        creditCardInvoiceId: "",
        status,
        origin: "Manual",
        notes: dreForm.notes,
        attachmentName: "",
        createdAt: now,
        updatedAt: now,
      }
    })).filter((record) => /^\d{4}-\d{2}-01$/.test(record.competenceDate))

    if (!records.length) {
      toast({ title: "Ano invalido", description: "Informe ao menos um ano com 4 digitos." })
      return
    }

    commit((current) => ({ ...current, transactions: [...records, ...current.transactions] }))
    toast({ title: type === "Entrada" ? "Receita salva" : "Despesa salva", description: `${records.length} lancamento(s) incluido(s) em Entradas e Saidas e somado(s) na DRE.` })
    close()
  }

  function accountErpFields(editing: AccountsPayable | AccountsReceivable | null) {
    const sourceType = (form.sourceType || "Manual") as NonNullable<AccountsPayable["sourceType"]>
    return {
      documentNumber: String(form.documentNumber || "").trim(),
      paymentConditionId: form.paymentConditionId || "",
      interestAmount: parseMoney(form.interestAmount || 0),
      fineAmount: parseMoney(form.fineAmount || 0),
      discountAmount: parseMoney(form.discountAmount || 0),
      sourceType,
      sourceReference: sourceType === "OS" || sourceType === "Manual" ? "" : String(form.sourceReference || "").trim(),
      installmentNumber: editing?.installmentNumber,
      installmentCount: editing?.installmentCount,
      installmentGroupId: editing?.installmentGroupId || "",
      createdBy: editing?.createdBy || currentUserName,
      updatedBy: currentUserName,
    }
  }

  function validateAccountForm(kind: "pagar" | "receber") {
    const party: [string, string] = kind === "pagar" ? ["Fornecedor", selectedSupplierId] : ["Cliente", form.clientId === "nenhum" ? "" : form.clientId]
    if (!requireFields([party, ["Descricao", form.description], ["Categoria financeira", form.categoryId], ["Valor original", form.expectedAmount], ["Data de emissao/competencia", form.competenceDate], ["Data de vencimento", form.dueDate]])) return false
    if (parseMoney(form.expectedAmount) <= 0) {
      toast({ title: "Valor invalido", description: "O valor original deve ser maior que zero.", variant: "destructive" })
      return false
    }
    if (form.dueDate < form.competenceDate) {
      toast({ title: "Vencimento invalido", description: "O vencimento nao pode ser anterior a emissao/competencia.", variant: "destructive" })
      return false
    }
    if (["Contrato", "Venda", "Compra"].includes(form.sourceType) && !String(form.sourceReference || "").trim()) {
      toast({ title: "Informe a origem", description: `Informe o numero do(a) ${String(form.sourceType).toLowerCase()} de origem.`, variant: "destructive" })
      return false
    }
    if (form.sourceType === "OS" && (!form.serviceOrderId || form.serviceOrderId === "nenhuma")) {
      toast({ title: "Informe a OS", description: "Selecione a ordem de servico de origem.", variant: "destructive" })
      return false
    }
    const installments = Number(form.installments || 1)
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) {
      toast({ title: "Parcelas invalidas", description: "Informe de 1 a 120 parcelas.", variant: "destructive" })
      return false
    }
    return true
  }

  /** Gera uma conta por parcela (somente na criacao). A primeira pode ser baixada no ato. */
  function splitInstallments<T extends AccountsPayable | AccountsReceivable>(record: T, idPrefix: string): T[] {
    const count = Number(form.installments || 1)
    if (count <= 1) return [{ ...record, installmentNumber: undefined, installmentCount: undefined }]
    const groupId = financeId("grp")
    return buildInstallments(record.expectedAmount, count, record.dueDate, Number(form.intervalDays || 30)).map((installment, index) => ({
      ...record,
      id: index === 0 ? record.id : financeId(idPrefix),
      dueDate: installment.dueDate,
      expectedAmount: installment.amount,
      installmentNumber: installment.number,
      installmentCount: installment.count,
      installmentGroupId: groupId,
      // juros/multa/desconto e baixa informados no cadastro valem so para a 1a parcela
      ...(index === 0 ? {} : { interestAmount: 0, fineAmount: 0, discountAmount: 0, transactionId: "" }),
      ...(index === 0 ? {} : "paidAmount" in record ? { paidAmount: 0, paymentDate: "" } : { receivedAmount: 0, receivedDate: "" }),
    }) as T)
  }

  async function persistAccounts(kind: "pagar" | "receber", records: Array<AccountsPayable | AccountsReceivable>, editing: AccountsPayable | AccountsReceivable | null) {
    const linked = editing ? accountTransaction(state, editing, kind) : undefined
    let transactions = linked ? state.transactions.filter((item) => item.id !== linked.id) : [...state.transactions]
    const withTransactions = records.map((record) => {
      const payable = kind === "pagar" ? record as AccountsPayable : null
      const receivable = kind === "receber" ? record as AccountsReceivable : null
      const realized = payable ? Boolean(payable.paymentDate && payable.paidAmount > 0) : Boolean(receivable!.receivedDate && receivable!.receivedAmount > 0)
      if (!realized || record.status === "Cancelada") return { ...record, transactionId: "" }
      const next = { ...record, transactionId: (record.id === editing?.id ? linked?.id : "") || record.transactionId || financeId("ft") }
      const transaction = payable ? transactionFromPayable(next as AccountsPayable) : transactionFromReceivable(next as AccountsReceivable)
      transactions = [transaction, ...transactions.filter((item) => item.id !== transaction.id)]
      return next
    })
    const ids = new Set(withTransactions.map((item) => item.id))
    const next = kind === "pagar"
      ? { ...state, transactions, accountsPayable: [...(withTransactions as AccountsPayable[]), ...state.accountsPayable.filter((item) => !ids.has(item.id))] }
      : { ...state, transactions, accountsReceivable: [...(withTransactions as AccountsReceivable[]), ...state.accountsReceivable.filter((item) => !ids.has(item.id))] }
    await saveState(next)
  }

  async function savePayable(pay = false) {
    if (!validateAccountForm("pagar")) return
    if (accountSubmissionRef.current) return
    accountSubmissionRef.current = true
    setAccountSubmitting(true)
    const now = financeNow()
    const editing = editingAccount?.kind === "pagar" ? editingAccount.item : null
    const supplier = operational.state.suppliers.find((item) => item.id === selectedSupplierId)
    const erp = accountErpFields(editing)
    const draft: AccountsPayable = {
      id: editing?.id || financeId("ap"),
      supplierId: selectedSupplierId,
      supplierName: supplier?.name || form.supplierName,
      description: form.description,
      categoryId: form.categoryId,
      subcategoryId: form.subcategoryId,
      costCenterId: form.costCenterId,
      dreAccountId: form.dreAccountId || state.categories.find((item) => item.id === form.categoryId)?.dreAccountId || "dre-sem-classificacao",
      serviceOrderId: erp.sourceType === "OS" && form.serviceOrderId !== "nenhuma" ? form.serviceOrderId : "",
      providerId: form.providerId || "",
      vehicleId: form.vehicleId || "",
      competenceDate: form.competenceDate,
      dueDate: form.dueDate,
      paymentDate: "",
      expectedAmount: parseMoney(form.expectedAmount),
      paidAmount: 0,
      paymentMethod: form.paymentMethod,
      bankAccountId: form.bankAccountId === "nenhuma" ? "" : form.bankAccountId,
      creditCardId: form.creditCardId === "nenhum" ? "" : form.creditCardId,
      creditCardInvoiceId: editing?.creditCardInvoiceId || "",
      status: form.cancelled ? "Cancelada" : "Aberta",
      origin: editing?.origin || (erp.sourceType === "Manual" ? "Manual" : erp.sourceType),
      notes: form.notes,
      attachmentName: form.attachmentName,
      transactionId: editing?.transactionId || "",
      ...erp,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    }
    const [first, ...rest] = editing ? [draft] : splitInstallments(draft, "ap")
    const firstSettlement = accountSettlementAmount(first)
    const paidAmount = pay ? parseMoney(form.realizedAmount || firstSettlement) : parseMoney(form.realizedAmount)
    const firstWithBaixa = { ...first, paidAmount, paymentDate: paidAmount > 0 ? form.realizedDate || financeToday() : "" }
    const records = [firstWithBaixa, ...rest].map((item) => ({ ...item, status: payableAutoStatus(item) }))
    try {
      await persistAccounts("pagar", records, editing)
      toast({ title: editing ? "Conta a pagar atualizada" : records.length > 1 ? `${records.length} parcelas geradas` : "Conta a pagar salva", description: "Alteracoes confirmadas no Supabase." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar conta a pagar", description: error instanceof Error ? error.message : "O Supabase recusou a alteracao.", variant: "destructive" })
    } finally {
      accountSubmissionRef.current = false
      setAccountSubmitting(false)
    }
  }

  async function saveReceivable(receive = false) {
    if (!validateAccountForm("receber")) return
    if (accountSubmissionRef.current) return
    accountSubmissionRef.current = true
    setAccountSubmitting(true)
    const now = financeNow()
    const editing = editingAccount?.kind === "receber" ? editingAccount.item : null
    const erp = accountErpFields(editing)
    const draft: AccountsReceivable = {
      id: editing?.id || financeId("ar"),
      clientId: form.clientId === "nenhum" ? "" : form.clientId,
      serviceOrderId: erp.sourceType === "OS" && form.serviceOrderId !== "nenhuma" ? form.serviceOrderId : "",
      description: form.description,
      categoryId: form.categoryId,
      subcategoryId: form.subcategoryId,
      costCenterId: form.costCenterId,
      dreAccountId: form.dreAccountId || state.categories.find((item) => item.id === form.categoryId)?.dreAccountId || "dre-receita-bruta",
      competenceDate: form.competenceDate,
      dueDate: form.dueDate,
      receivedDate: "",
      expectedAmount: parseMoney(form.expectedAmount),
      receivedAmount: 0,
      receiptMethod: form.paymentMethod,
      bankAccountId: form.bankAccountId === "nenhuma" ? "" : form.bankAccountId,
      status: form.cancelled ? "Cancelada" : "Aberta",
      origin: editing?.origin || (erp.sourceType === "Manual" ? "Manual" : erp.sourceType),
      notes: form.notes,
      attachmentName: form.attachmentName,
      transactionId: editing?.transactionId || "",
      ...erp,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    }
    const [first, ...rest] = editing ? [draft] : splitInstallments(draft, "ar")
    const firstSettlement = accountSettlementAmount(first)
    const receivedAmount = receive ? parseMoney(form.realizedAmount || firstSettlement) : parseMoney(form.realizedAmount)
    const firstWithBaixa = { ...first, receivedAmount, receivedDate: receivedAmount > 0 ? form.realizedDate || financeToday() : "" }
    const records = [firstWithBaixa, ...rest].map((item) => ({ ...item, status: receivableAutoStatus(item) }))
    try {
      await persistAccounts("receber", records, editing)
      toast({ title: editing ? "Conta a receber atualizada" : records.length > 1 ? `${records.length} parcelas geradas` : "Conta a receber salva", description: "Alteracoes confirmadas no Supabase." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar conta a receber", description: error instanceof Error ? error.message : "O Supabase recusou a alteracao.", variant: "destructive" })
    } finally {
      accountSubmissionRef.current = false
      setAccountSubmitting(false)
    }
  }

  function saveCategory() {
    if (!requireFields([["Nome", category.name]])) return
    const now = financeNow()
    const record: FinancialCategory = { id: financeId("cat"), name: category.name, type: category.type as any, dreAccountId: category.dreAccountId, status: category.status as any, createdAt: now, updatedAt: now }
    const sub = category.subcategory ? { id: financeId("sub"), categoryId: record.id, name: category.subcategory, status: "Ativo" as const, createdAt: now, updatedAt: now } : null
    commit((current) => ({ ...current, categories: [record, ...current.categories], subcategories: sub ? [sub, ...current.subcategories] : current.subcategories }))
    close()
  }

  function saveCard() {
    if (!requireFields([["Nome do cartao", card.name], ["Banco", card.bankName], ["Final", card.cardLastDigits]])) return
    const now = financeNow()
    commit((current) => ({ ...current, creditCards: [{ id: financeId("card"), ...card, closingDay: Number(card.closingDay), dueDay: Number(card.dueDay), creditLimit: parseMoney(card.creditLimit), status: card.status as any, createdAt: now, updatedAt: now }, ...current.creditCards] }))
    close()
  }

  function saveRule() {
    if (!requireFields([["Texto de busca", rule.searchText], ["Categoria", rule.categoryId]])) return
    const now = financeNow()
    const record: CategoryRule = { id: financeId("rule"), name: rule.name || rule.searchText, priority: Number(rule.priority), searchText: rule.searchText, normalizedSearchText: normalizeDescription(rule.searchText), comparisonType: rule.comparisonType as any, categoryId: rule.categoryId, subcategoryId: rule.subcategoryId, costCenterId: rule.costCenterId, dreAccountId: rule.dreAccountId || state.categories.find((item) => item.id === rule.categoryId)?.dreAccountId || "dre-sem-classificacao", creditCardId: rule.creditCardId === "todos" ? "" : rule.creditCardId, cardHolder: rule.cardHolder, defaultConfidence: rule.defaultConfidence as any, active: rule.active, notes: rule.notes, createdAt: now, updatedAt: now }
    commit((current) => ({ ...current, categoryRules: [record, ...current.categoryRules] }))
    close()
  }

  function applyPaymentCondition(conditionId: string) {
    const condition = state.paymentConditions.find((item) => item.id === conditionId)
    if (!condition) {
      setForm({ ...form, paymentConditionId: "" })
      return
    }
    setForm({
      ...form,
      paymentConditionId: condition.id,
      installments: String(condition.installments),
      intervalDays: String(condition.intervalDays || 30),
      paymentMethod: condition.paymentMethod || form.paymentMethod,
      dueDate: addDays(form.competenceDate || financeToday(), condition.firstDueDays),
    })
  }

  function CommonFields({ kind, account = false }: { kind: "entrada" | "saida"; account?: boolean }) {
    const editingThis = Boolean(account && editingAccount)
    const installments = Number(form.installments || 1)
    const preview = account && !editingThis && installments > 1 && parseMoney(form.expectedAmount) > 0 && form.dueDate
      ? buildInstallments(parseMoney(form.expectedAmount), installments, form.dueDate, Number(form.intervalDays || 30))
      : []
    const settlement = accountSettlementAmount({ expectedAmount: parseMoney(form.expectedAmount), interestAmount: parseMoney(form.interestAmount || 0), fineAmount: parseMoney(form.fineAmount || 0), discountAmount: parseMoney(form.discountAmount || 0) })
    const bankOptions = [{ value: "nenhuma", label: "Sem conta" }, ...state.bankAccounts.filter((item) => item.status === "Ativo" || item.id === form.bankAccountId).map((item) => ({ value: item.id, label: item.name }))]
    const methodOptions = Array.from(new Set([...paymentMethodOptions, form.paymentMethod].filter(Boolean))).map((value) => ({ value, label: value }))
    const editingInstallment = editingThis && editingAccount ? installmentLabel(editingAccount.item) : "-"
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Descricao" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
        {kind === "saida" ? <SelectField
          label="Fornecedor"
          value={selectedSupplierId}
          onChange={(value) => {
            const supplier = operational.state.suppliers.find((item) => item.id === value)
            setForm({ ...form, supplierId: value, supplierName: supplier?.name || "" })
          }}
          options={supplierOptions}
          placeholder="Selecione o fornecedor"
          actionLabel="Cadastrar novo fornecedor"
          onAction={openQuickSupplier}
        /> : null}
        {kind === "entrada" ? <SelectField label="Cliente" value={form.clientId || "nenhum"} onChange={(value) => setForm({ ...form, clientId: value })} options={clientOptions} /> : null}
        {account ? <TextField label="Numero do documento / NF" value={form.documentNumber} onChange={(value) => setForm({ ...form, documentNumber: value })} /> : null}
        <SelectField label="Categoria financeira" value={form.categoryId || "nenhuma"} onChange={(value) => setForm({ ...form, categoryId: value === "nenhuma" ? "" : value })} options={[{ value: "nenhuma", label: "Sem categoria" }, ...categoryOptions(kind)]} />
        <SelectField label="Subcategoria" value={form.subcategoryId || "nenhuma"} onChange={(value) => setForm({ ...form, subcategoryId: value === "nenhuma" ? "" : value })} options={[{ value: "nenhuma", label: "Sem subcategoria" }, ...subcategoryOptions]} />
        <SelectField label="Centro de custo" value={form.costCenterId || "nenhum"} onChange={(value) => setForm({ ...form, costCenterId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem centro" }, ...costCenterOptions]} />
        <TextField label="Data de emissao / competencia" type="date" value={form.competenceDate} onChange={(value) => setForm({ ...form, competenceDate: value })} />
        <TextField label="Valor original" value={form.expectedAmount} onChange={(value) => setForm({ ...form, expectedAmount: value })} />
        {account && !editingThis ? <SelectField label="Condicao de pagamento" value={form.paymentConditionId || "nenhuma"} onChange={(value) => applyPaymentCondition(value === "nenhuma" ? "" : value)} options={[{ value: "nenhuma", label: "Personalizada" }, ...state.paymentConditions.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} /> : null}
        {account && !editingThis ? <TextField label="Numero de parcelas" type="number" value={form.installments} onChange={(value) => setForm({ ...form, installments: value, paymentConditionId: "" })} /> : null}
        {account && !editingThis && installments > 1 ? <TextField label="Intervalo entre parcelas (dias)" type="number" value={form.intervalDays} onChange={(value) => setForm({ ...form, intervalDays: value, paymentConditionId: "" })} /> : null}
        {editingThis ? <div className="space-y-2"><Label>Parcela</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{editingInstallment}</div></div> : null}
        <TextField label={account && !editingThis && installments > 1 ? "Vencimento da 1a parcela" : "Data de vencimento"} type="date" value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} />
        <SelectField label={kind === "entrada" ? "Forma de recebimento" : "Forma de pagamento"} value={form.paymentMethod || "Pix"} onChange={(value) => setForm({ ...form, paymentMethod: value })} options={methodOptions} />
        <SelectField label="Conta bancaria / caixa" value={form.bankAccountId || "nenhuma"} onChange={(value) => setForm({ ...form, bankAccountId: value === "nenhuma" ? "" : value })} options={bankOptions} />
        {kind === "saida" ? <SelectField label="Cartao de credito" value={form.creditCardId || "nenhum"} onChange={(value) => setForm({ ...form, creditCardId: value })} options={[{ value: "nenhum", label: "Sem cartao" }, ...state.creditCards.map((item) => ({ value: item.id, label: item.name }))]} /> : null}
        {account ? <TextField label="Juros (R$)" value={form.interestAmount} onChange={(value) => setForm({ ...form, interestAmount: value })} /> : null}
        {account ? <TextField label="Multa (R$)" value={form.fineAmount} onChange={(value) => setForm({ ...form, fineAmount: value })} /> : null}
        {account ? <TextField label="Desconto (R$)" value={form.discountAmount} onChange={(value) => setForm({ ...form, discountAmount: value })} /> : null}
        {account ? <div className="space-y-2"><Label>Valor para quitacao</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">{money(settlement)}</div></div> : null}
        <TextField label={kind === "entrada" ? "Data de recebimento (baixa)" : "Data de pagamento (baixa)"} type="date" value={form.realizedDate} onChange={(value) => setForm({ ...form, realizedDate: value })} />
        <TextField label={kind === "entrada" ? "Valor recebido" : "Valor pago"} value={form.realizedAmount} onChange={(value) => setForm({ ...form, realizedAmount: value })} />
        {account ? <SelectField label="Origem do lancamento" value={form.sourceType || "Manual"} onChange={(value) => setForm({ ...form, sourceType: value })} options={accountSourceTypeOptions.map((value) => ({ value, label: value === "OS" ? "Ordem de servico" : value }))} /> : null}
        {(!account || form.sourceType === "OS") ? <SelectField label="Ordem de Servico" value={form.serviceOrderId || "nenhuma"} onChange={(value) => setForm({ ...form, serviceOrderId: value })} options={orderOptions} /> : null}
        {account && ["Contrato", "Venda", "Compra"].includes(form.sourceType) ? <TextField label={`Numero do(a) ${String(form.sourceType).toLowerCase()}`} value={form.sourceReference} onChange={(value) => setForm({ ...form, sourceReference: value })} /> : null}
        <TextField label="Comprovante/anexo" value={form.attachmentName} onChange={(value) => setForm({ ...form, attachmentName: value })} />
        {editingThis ? <div className="flex items-center gap-3 rounded-md border px-3 py-2"><Checkbox checked={Boolean(form.cancelled)} onCheckedChange={(checked) => setForm({ ...form, cancelled: checked === true })} /><Label>Lancamento cancelado</Label></div> : null}
        {preview.length ? <div className="rounded-md border bg-muted/20 p-3 text-sm md:col-span-2"><p className="mb-1 font-medium">Parcelas que serao geradas</p>{preview.map((item) => <p key={item.number}>{String(item.number).padStart(2, "0")}/{String(item.count).padStart(2, "0")} - {formatDate(item.dueDate)} - {money(item.amount)}</p>)}</div> : null}
        {editingThis && editingAccount ? <p className="text-xs text-muted-foreground md:col-span-2">Criado por {editingAccount.item.createdBy || "-"} em {formatDate(String(editingAccount.item.createdAt || "").slice(0, 10))} · Ultima alteracao por {editingAccount.item.updatedBy || "-"} em {formatDate(String(editingAccount.item.updatedAt || "").slice(0, 10))}</p> : null}
        {kind === "saida" ? (
          <Dialog open={quickSupplierOpen} onOpenChange={(open) => !quickSupplierSubmitting && setQuickSupplierOpen(open)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Novo fornecedor</DialogTitle>
                <DialogDescription>Cadastre e selecione o fornecedor sem perder os dados desta conta.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Nome do fornecedor" value={quickSupplier.name} onChange={(value) => setQuickSupplier((current) => ({ ...current, name: value }))} />
                <div className="space-y-2">
                  <Label>CPF/CNPJ</Label>
                  <div className="flex gap-2">
                    <Input value={quickSupplier.document} onChange={(event) => setQuickSupplier((current) => ({ ...current, document: formatCpfCnpjDocument(event.target.value) }))} placeholder="CPF ou CNPJ" />
                    {cleanCpfCnpj(quickSupplier.document).length === 14 ? <Button type="button" size="icon" variant="outline" title="Consultar dados do CNPJ" disabled={quickSupplierLookup} onClick={lookupQuickSupplierCnpj}>
                      <Search className={`h-4 w-4 ${quickSupplierLookup ? "animate-pulse" : ""}`} />
                    </Button> : null}
                  </div>
                  {quickSupplierLookup ? <p className="text-xs text-muted-foreground">Consultando dados cadastrais...</p> : null}
                </div>
                <TextField label="Nome do contato" value={quickSupplier.contactName} onChange={(value) => setQuickSupplier((current) => ({ ...current, contactName: value }))} />
                <TextField label="Telefone" value={quickSupplier.phone} onChange={(value) => setQuickSupplier((current) => ({ ...current, phone: value }))} />
                <TextField label="E-mail" type="email" value={quickSupplier.email} onChange={(value) => setQuickSupplier((current) => ({ ...current, email: value }))} />
                <TextField label="Cidade" value={quickSupplier.city} onChange={(value) => setQuickSupplier((current) => ({ ...current, city: value }))} />
                <TextField label="Estado" value={quickSupplier.state} onChange={(value) => setQuickSupplier((current) => ({ ...current, state: value }))} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={quickSupplierSubmitting} onClick={() => setQuickSupplierOpen(false)}>Cancelar</Button>
                <SaveButton disabled={quickSupplierSubmitting} onClick={saveQuickSupplier}>{quickSupplierSubmitting ? "Salvando..." : "Salvar fornecedor"}</SaveButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    )
  }

  function DreManualFields({ kind }: { kind: "entrada" | "saida" }) {
    const categorySubcategoryOptions = categoryOptions(kind).flatMap((categoryOption) => {
      const children = state.subcategories.filter((item) => item.categoryId === categoryOption.value)
      if (!children.length) return [{ value: `${categoryOption.value}::nenhuma`, label: categoryOption.label }]
      return children.map((item) => ({ value: `${categoryOption.value}::${item.id}`, label: `${categoryOption.label} / ${item.name}` }))
    })
    const selectedCategoryValue = dreForm.categoryId ? `${dreForm.categoryId}::${dreForm.subcategoryId || "nenhuma"}` : "nenhuma"
    const selectedMonths = Array.isArray(dreForm.months) ? dreForm.months : []
    const toggleMonth = (month: string, checked: boolean) => {
      const next = checked ? Array.from(new Set([...selectedMonths, month])) : selectedMonths.filter((item: string) => item !== month)
      setDreForm({ ...dreForm, months: next.sort() })
    }
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Descricao" value={dreForm.description} onChange={(value) => setDreForm({ ...dreForm, description: value })} />
        <SelectField
          label="Categoria / Subcategoria"
          value={selectedCategoryValue}
          onChange={(value) => {
            const [categoryId, subcategoryId] = value.split("::")
            setDreForm({ ...dreForm, categoryId: categoryId === "nenhuma" ? "" : categoryId, subcategoryId: subcategoryId === "nenhuma" ? "" : subcategoryId })
          }}
          options={[{ value: "nenhuma", label: "Selecione a categoria" }, ...categorySubcategoryOptions]}
        />
        <SelectField
          label="Centro de custo"
          value={dreForm.costCenterId || "nenhum"}
          onChange={(value) => setDreForm({ ...dreForm, costCenterId: value === "nenhum" ? "" : value })}
          options={[{ value: "nenhum", label: "Sem centro" }, ...costCenterOptions]}
        />
        <SelectField
          label="Previsto ou Realizado"
          value={dreForm.status}
          onChange={(value) => setDreForm({ ...dreForm, status: value })}
          options={[{ value: "Previsto", label: "Previsto" }, { value: "Realizado", label: "Realizado" }]}
        />
        <TextField label="Ano(s)" value={dreForm.years} onChange={(value) => setDreForm({ ...dreForm, years: value })} />
        <TextField label="Valor" value={dreForm.amount} onChange={(value) => setDreForm({ ...dreForm, amount: value })} />
        <div className="space-y-2 md:col-span-2">
          <Label>Meses para lancar o mesmo valor</Label>
          <div className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-2 lg:grid-cols-4">
            {dreMonthOptions.map((month) => (
              <label key={month.value} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selectedMonths.includes(month.value)} onCheckedChange={(checked) => toggleMonth(month.value, checked === true)} />
                {month.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Exemplo: selecione Janeiro, Fevereiro e Marco com valor R$ 1.000,00 para criar um lancamento igual em cada mes. Em anos, use 2026 ou 2025, 2026.</p>
        </div>
        <div className="md:col-span-2">
          <TextAreaField label="Observacoes" value={dreForm.notes} onChange={(value) => setDreForm({ ...dreForm, notes: value })} />
        </div>
      </div>
    )
  }

  return (
    <>
      {sheet === "entrada" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Nova Entrada">
        {CommonFields({ kind: "entrada" })}
        <TextAreaField label="Observacoes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        <div className="flex gap-2"><SaveButton onClick={() => saveTransaction("Entrada")}>Salvar</SaveButton><Button onClick={() => saveTransaction("Entrada", true)}>Salvar como recebido</Button><Button variant="outline" onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "saida" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Nova Saida">
        {CommonFields({ kind: "saida" })}
        <TextAreaField label="Observacoes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        <div className="flex gap-2"><SaveButton onClick={() => saveTransaction("Saida")}>Salvar</SaveButton><Button onClick={() => saveTransaction("Saida", true)}>Salvar como pago</Button><Button variant="outline" onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "pagar" ? <FormSheet open onOpenChange={(open) => !open && !accountSubmitting && close()} title={editingAccount?.kind === "pagar" ? "Editar Conta a Pagar" : "Nova Conta a Pagar"}>
        {CommonFields({ kind: "saida", account: true })}
        <TextAreaField label="Observacoes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        <div className="flex gap-2"><SaveButton disabled={accountSubmitting} onClick={() => savePayable(false)}>{accountSubmitting ? "Salvando..." : editingAccount?.kind === "pagar" ? "Salvar alteracoes" : "Salvar"}</SaveButton><Button disabled={accountSubmitting} onClick={() => savePayable(true)}>{accountSubmitting ? "Salvando..." : Number(form.installments || 1) > 1 && editingAccount?.kind !== "pagar" ? "Salvar e pagar 1a parcela" : "Salvar e pagar"}</Button><Button variant="outline" disabled={accountSubmitting} onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "receber" ? <FormSheet open onOpenChange={(open) => !open && !accountSubmitting && close()} title={editingAccount?.kind === "receber" ? "Editar Conta a Receber" : "Nova Conta a Receber"}>
        {CommonFields({ kind: "entrada", account: true })}
        <TextAreaField label="Observacoes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        {editingAccount?.kind !== "receber" ? <AsaasReceivableChargePanel input={{ clientId: form.clientId, serviceOrderId: form.serviceOrderId, value: form.expectedAmount, dueDate: form.dueDate, description: form.description }} onCreated={refreshState} /> : null}
        <div className="flex flex-wrap gap-2"><SaveButton disabled={accountSubmitting} onClick={() => saveReceivable(false)}>{accountSubmitting ? "Salvando..." : editingAccount?.kind === "receber" ? "Salvar alteracoes" : "Salvar somente no financeiro"}</SaveButton><Button disabled={accountSubmitting} onClick={() => saveReceivable(true)}>{accountSubmitting ? "Salvando..." : Number(form.installments || 1) > 1 && editingAccount?.kind !== "receber" ? "Salvar e receber 1a parcela" : "Salvar e receber"}</Button><Button variant="outline" disabled={accountSubmitting} onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "dre-receita" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Nova Receita na DRE" description="Escolha categoria, mes, ano e se o valor e previsto ou realizado. A receita entra como Entrada e soma na DRE.">
        {DreManualFields({ kind: "entrada" })}
        <div className="flex gap-2"><SaveButton onClick={() => saveDreManualTransaction("Entrada")}>Salvar receita</SaveButton><Button variant="outline" onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "dre-despesa" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Nova Despesa na DRE" description="Escolha categoria, mes, ano e se o valor e previsto ou realizado. A despesa entra como Saida e soma na DRE.">
        {DreManualFields({ kind: "saida" })}
        <div className="flex gap-2"><SaveButton onClick={() => saveDreManualTransaction("Saida")}>Salvar despesa</SaveButton><Button variant="outline" onClick={close}>Cancelar</Button></div>
      </FormSheet> : null}
      {sheet === "categoria" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Categoria Financeira">
        <div className="grid gap-4 md:grid-cols-2"><TextField label="Nome" value={category.name} onChange={(value) => setCategory({ ...category, name: value })} /><SelectField label="Tipo" value={category.type} onChange={(value) => setCategory({ ...category, type: value })} options={[{ value: "entrada", label: "Entrada" }, { value: "saida", label: "Saida" }, { value: "ambos", label: "Ambos" }]} /><SelectField label="Conta DRE" value={category.dreAccountId} onChange={(value) => setCategory({ ...category, dreAccountId: value })} options={dreOptions} /><TextField label="Subcategoria inicial" value={category.subcategory} onChange={(value) => setCategory({ ...category, subcategory: value })} /></div><SaveButton onClick={saveCategory}>Salvar categoria</SaveButton>
      </FormSheet> : null}
      {sheet === "cartao" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Novo Cartao">
        <div className="grid gap-4 md:grid-cols-2"><TextField label="Nome do cartao" value={card.name} onChange={(value) => setCard({ ...card, name: value })} /><TextField label="Banco" value={card.bankName} onChange={(value) => setCard({ ...card, bankName: value })} /><TextField label="Final do cartao" value={card.cardLastDigits} onChange={(value) => setCard({ ...card, cardLastDigits: value })} /><TextField label="Titular" value={card.holderName} onChange={(value) => setCard({ ...card, holderName: value })} /><TextField label="Conta cartao" value={card.cardAccount} onChange={(value) => setCard({ ...card, cardAccount: value })} /><TextField label="Dia de fechamento" type="number" value={card.closingDay} onChange={(value) => setCard({ ...card, closingDay: value })} /><TextField label="Dia de vencimento" type="number" value={card.dueDay} onChange={(value) => setCard({ ...card, dueDay: value })} /><TextField label="Limite" value={card.creditLimit} onChange={(value) => setCard({ ...card, creditLimit: value })} /></div><TextAreaField label="Observacoes" value={card.notes} onChange={(value) => setCard({ ...card, notes: value })} /><SaveButton onClick={saveCard}>Salvar cartao</SaveButton>
      </FormSheet> : null}
      {sheet === "regra" ? <FormSheet open onOpenChange={(open) => !open && close()} title="Regra de Categoria">
        <div className="grid gap-4 md:grid-cols-2"><TextField label="Nome da regra" value={rule.name} onChange={(value) => setRule({ ...rule, name: value })} /><TextField label="Prioridade" type="number" value={rule.priority} onChange={(value) => setRule({ ...rule, priority: value })} /><TextField label="Texto de busca" value={rule.searchText} onChange={(value) => setRule({ ...rule, searchText: value })} /><SelectField label="Tipo de comparacao" value={rule.comparisonType} onChange={(value) => setRule({ ...rule, comparisonType: value })} options={["Contem", "Comeca com", "Igual", "Regex", "Similaridade"].map((value) => ({ value, label: value }))} /><SelectField label="Categoria" value={rule.categoryId || "nenhuma"} onChange={(value) => setRule({ ...rule, categoryId: value === "nenhuma" ? "" : value })} options={[{ value: "nenhuma", label: "Selecione" }, ...categoryOptions("ambos")]} /><SelectField label="Subcategoria" value={rule.subcategoryId || "nenhuma"} onChange={(value) => setRule({ ...rule, subcategoryId: value === "nenhuma" ? "" : value })} options={[{ value: "nenhuma", label: "Sem subcategoria" }, ...state.subcategories.map((item) => ({ value: item.id, label: item.name }))]} /><SelectField label="Centro de custo" value={rule.costCenterId || "nenhum"} onChange={(value) => setRule({ ...rule, costCenterId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem centro" }, ...costCenterOptions]} /><SelectField label="Conta DRE" value={rule.dreAccountId || "dre-sem-classificacao"} onChange={(value) => setRule({ ...rule, dreAccountId: value })} options={dreOptions} /><SelectField label="Confianca padrao" value={rule.defaultConfidence} onChange={(value) => setRule({ ...rule, defaultConfidence: value })} options={["Alta", "Media", "Baixa"].map((value) => ({ value, label: value }))} /></div><TextAreaField label="Observacao" value={rule.notes} onChange={(value) => setRule({ ...rule, notes: value })} /><div className="flex gap-2"><SaveButton onClick={saveRule}>Salvar regra</SaveButton><Button variant="outline" onClick={() => alert(normalizeDescription(rule.searchText))}>Testar regra</Button></div>
      </FormSheet> : null}
    </>
  )
}

export default function FinanceiroPage() {
  const { state, commit, replace, save, refresh, loading, loadError } = useFinancialStore()
  const { user } = useAuth()
  const operational = useOperationalStore()
  const opNames = names(operational.state)
  const [sheet, setSheet] = useState<SheetKind>("")
  const [editingAccount, setEditingAccount] = useState<AccountEditTarget>(null)
  const [activeTab, setActiveTab] = useState("visao")
  const [query, setQuery] = useState("")
  const [monthFilter, setMonthFilter] = useState("todos")
  const [yearFilter, setYearFilter] = useState("todos")
  const currentYear = String(new Date().getFullYear())
  const [overviewPeriod, setOverviewPeriod] = useState<AccountPeriod>({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` })
  const [asaasSyncing, setAsaasSyncing] = useState(false)
  const [asaasSyncMessage, setAsaasSyncMessage] = useState("")
  const [payablePeriod, setPayablePeriod] = useState<AccountPeriod>({ start: "", end: "" })
  const [payableQuery, setPayableQuery] = useState("")
  const [payableSort, setPayableSort] = useState<PayableSort>("due-asc")
  const [receivablePeriod, setReceivablePeriod] = useState<AccountPeriod>({ start: "", end: "" })
  const [preview, setPreview] = useState<any>(null)
  const [rulePreview, setRulePreview] = useState<any[]>([])
  const [ocrStatus, setOcrStatus] = useState("")
  const visibleTransactions = useMemo(() => dedupeTransactions(Array.isArray(state.transactions) ? state.transactions : []), [state.transactions])
  const yearOptions = Array.from(new Set([currentYear, ...visibleTransactions.map((item) => transactionFilterDate(item).slice(0, 4)).filter(Boolean)])).sort((a, b) => b.localeCompare(a))
  const filteredTransactions = visibleTransactions.filter((item) => {
    const date = transactionFilterDate(item)
    const textMatch = [item.description, item.type, item.status, categoryName(state, item.categoryId), item.origin].join(" ").toLowerCase().includes(query.toLowerCase())
    const monthMatch = monthFilter === "todos" || date.slice(5, 7) === monthFilter
    const yearMatch = yearFilter === "todos" || date.slice(0, 4) === yearFilter
    return textMatch && monthMatch && yearMatch
  })
  const overviewTransactions = useMemo(() => visibleTransactions.filter((item) => {
    const date = financialOverviewDate(item)
    return isInAccountPeriod(date, overviewPeriod)
  }), [visibleTransactions, overviewPeriod])
  const overviewPayables = useMemo(
    () => state.accountsPayable.filter((item) => isInAccountPeriod(item.dueDate, overviewPeriod)),
    [state.accountsPayable, overviewPeriod],
  )
  const overviewReceivables = useMemo(
    () => state.accountsReceivable.filter((item) => isInAccountPeriod(item.dueDate, overviewPeriod)),
    [state.accountsReceivable, overviewPeriod],
  )
  const overviewInvoices = useMemo(
    () => state.creditCardInvoices.filter((item) => isInAccountPeriod(item.dueDate, overviewPeriod)),
    [state.creditCardInvoices, overviewPeriod],
  )
  const filteredPayables = useMemo(() => {
    const search = normalizeDescription(payableQuery)
    return state.accountsPayable.filter((item) => {
      if (!isInAccountPeriod(item.dueDate, payablePeriod)) return false
      if (!search) return true
      const searchableText = normalizeDescription([
        item.supplierName,
        item.description,
        String(item.expectedAmount || 0),
        money(Number(item.expectedAmount || 0)),
        String(item.paidAmount || 0),
        money(Number(item.paidAmount || 0)),
      ].join(" "))
      return searchableText.includes(search)
    })
  }, [state.accountsPayable, payablePeriod, payableQuery])
  const sortedPayables = useMemo(() => [...filteredPayables].sort((left, right) => {
    const [field, direction] = payableSort.split("-") as ["supplier" | "due" | "amount", "asc" | "desc"]
    const multiplier = direction === "asc" ? 1 : -1
    let comparison = 0

    if (field === "supplier") {
      const leftSupplier = String(left.supplierName || "").trim()
      const rightSupplier = String(right.supplierName || "").trim()
      if (!leftSupplier && rightSupplier) return 1
      if (leftSupplier && !rightSupplier) return -1
      comparison = leftSupplier.localeCompare(rightSupplier, "pt-BR", { sensitivity: "base", numeric: true })
    } else if (field === "due") {
      if (!left.dueDate && right.dueDate) return 1
      if (left.dueDate && !right.dueDate) return -1
      comparison = String(left.dueDate || "").localeCompare(String(right.dueDate || ""))
    } else {
      comparison = Number(left.expectedAmount || 0) - Number(right.expectedAmount || 0)
    }

    if (comparison !== 0) return comparison * multiplier
    return String(left.supplierName || "").trim().localeCompare(String(right.supplierName || "").trim(), "pt-BR", { sensitivity: "base", numeric: true })
  }), [filteredPayables, payableSort])
  const filteredReceivables = useMemo(
    () => state.accountsReceivable.filter((item) => isInAccountPeriod(item.dueDate, receivablePeriod)),
    [state.accountsReceivable, receivablePeriod],
  )
  const payableTotals = useMemo(() => filteredPayables.reduce((totals, item) => {
    if (item.status === "Cancelada") return totals
    totals.expected += Number(item.expectedAmount || 0)
    totals.done += Number(item.paidAmount || 0)
    return totals
  }, { expected: 0, done: 0 }), [filteredPayables])
  const receivableTotals = useMemo(() => filteredReceivables.reduce((totals, item) => {
    if (item.status === "Cancelada") return totals
    totals.expected += Number(item.expectedAmount || 0)
    totals.done += Number(item.receivedAmount || 0)
    return totals
  }, { expected: 0, done: 0 }), [filteredReceivables])
  const summary = useMemo(() => {
    const entriesExpected = overviewTransactions.filter((item) => item.type === "Entrada" && !isRealizedForFinancialOverview(item)).reduce((sum, item) => sum + Number(item.expectedAmount || 0), 0)
    const entriesDone = overviewTransactions.filter((item) => item.type === "Entrada" && isRealizedForFinancialOverview(item)).reduce((sum, item) => sum + transactionAmount(item), 0)
    const outputsExpected = overviewTransactions.filter((item) => item.type === "Saida" && !isRealizedForFinancialOverview(item)).reduce((sum, item) => sum + Number(item.expectedAmount || 0), 0)
    const outputsDone = overviewTransactions.filter((item) => item.type === "Saida" && isRealizedForFinancialOverview(item)).reduce((sum, item) => sum + transactionAmount(item), 0)
    return { entriesExpected, entriesDone, outputsExpected, outputsDone, plannedBalance: entriesExpected - outputsExpected, realizedBalance: entriesDone - outputsDone }
  }, [overviewTransactions])
  const financialPeriodOverview = useMemo(
    () => buildFinancialPeriodOverview(visibleTransactions, overviewPeriod.start, overviewPeriod.end),
    [visibleTransactions, overviewPeriod],
  )
  const overviewPeriodLabel = `${formatDate(overviewPeriod.start)} a ${formatDate(overviewPeriod.end)}`

  async function syncOverviewAsaas() {
    if (!overviewPeriod.start || !overviewPeriod.end || overviewPeriod.start > overviewPeriod.end) {
      setAsaasSyncMessage("Informe um periodo valido.")
      return
    }
    setAsaasSyncing(true)
    setAsaasSyncMessage("")
    try {
      const response = await fetch("/api/integrations/asaas/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "all", startDate: overviewPeriod.start, finishDate: overviewPeriod.end }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Falha ao sincronizar as contas Asaas.")
      await refresh()
      const succeeded = Array.isArray(payload.accounts) ? payload.accounts.filter((item: { success?: boolean }) => item.success).length : 2
      setAsaasSyncMessage(`${succeeded} conta(s) Asaas sincronizada(s). Indicadores atualizados.`)
    } catch (error) {
      setAsaasSyncMessage(error instanceof Error ? error.message : "Falha ao sincronizar as contas Asaas.")
    } finally {
      setAsaasSyncing(false)
    }
  }

  function markPayablePaid(item: AccountsPayable, partial = false) {
    const openAmount = Math.max(accountSettlementAmount(item) - Number(item.paidAmount || 0), 0)
    const amount = partial ? parseMoney(prompt(`Valor pago agora (em aberto: ${money(openAmount)}):`) || "0") : openAmount
    if (!amount || amount < 0) return
    const updated = { ...item, paidAmount: Number(item.paidAmount || 0) + amount, paymentDate: financeToday(), updatedAt: financeNow(), updatedBy: user?.name || user?.email || "" }
    const paid = { ...updated, status: payableAutoStatus(updated) }
    if (item.origin === "Cartao de credito" && item.creditCardInvoiceId) {
      commit((current) => ({
        ...current,
        accountsPayable: current.accountsPayable.map((row) => row.id === item.id ? paid : row),
        creditCardInvoices: current.creditCardInvoices.map((invoice) => invoice.id === item.creditCardInvoiceId ? { ...invoice, status: paid.status === "Paga" ? "Paga" : "Em revisao", updatedAt: financeNow() } : invoice),
      }))
      return
    }
    const transaction = transactionFromPayable(paid)
    paid.transactionId = transaction.id
    commit((current) => ({ ...current, accountsPayable: current.accountsPayable.map((row) => row.id === item.id ? paid : row), transactions: [transaction, ...current.transactions.filter((row) => row.id !== item.transactionId)] }))
  }

  function markReceivableReceived(item: AccountsReceivable, partial = false) {
    const openAmount = Math.max(accountSettlementAmount(item) - Number(item.receivedAmount || 0), 0)
    const amount = partial ? parseMoney(prompt(`Valor recebido agora (em aberto: ${money(openAmount)}):`) || "0") : openAmount
    if (!amount || amount < 0) return
    const updated = { ...item, receivedAmount: Number(item.receivedAmount || 0) + amount, receivedDate: financeToday(), updatedAt: financeNow(), updatedBy: user?.name || user?.email || "" }
    const received = { ...updated, status: receivableAutoStatus(updated) }
    const transaction = transactionFromReceivable(received)
    received.transactionId = transaction.id
    commit((current) => ({ ...current, accountsReceivable: current.accountsReceivable.map((row) => row.id === item.id ? received : row), transactions: [transaction, ...current.transactions.filter((row) => row.id !== item.transactionId)] }))
  }

  function openNewAccount(kind: "pagar" | "receber") {
    setEditingAccount(null)
    setSheet(kind)
  }

  function openAccountEdit(target: Exclude<AccountEditTarget, null>) {
    setEditingAccount(target)
    setSheet(target.kind)
  }

  async function deleteAccount(target: Exclude<AccountEditTarget, null>) {
    const label = target.kind === "pagar" ? "conta a pagar" : "conta a receber"
    if (!window.confirm(`Excluir definitivamente esta ${label}? Esta acao tambem remove o lancamento financeiro vinculado e nao pode ser desfeita.`)) return
    const linked = accountTransaction(state, target.item, target.kind)
    const next = {
      ...state,
      accountsPayable: target.kind === "pagar" ? state.accountsPayable.filter((item) => item.id !== target.item.id) : state.accountsPayable,
      accountsReceivable: target.kind === "receber" ? state.accountsReceivable.filter((item) => item.id !== target.item.id) : state.accountsReceivable,
      transactions: linked ? state.transactions.filter((item) => item.id !== linked.id) : state.transactions,
    }
    try {
      const params = new URLSearchParams({ kind: target.kind, id: target.item.id })
      if (linked?.id) params.set("transactionId", linked.id)
      const response = await fetch(`/api/financial-state/account?${params.toString()}`, { method: "DELETE" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || `Erro ao excluir ${label} no Supabase.`)
      replace(next)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `Erro ao excluir ${label} no Supabase.`)
    }
  }

  function generateAccountsReport(kind: "pagar" | "receber") {
    const isPayable = kind === "pagar"
    const period = isPayable ? payablePeriod : receivablePeriod
    if (period.start && period.end && period.start > period.end) {
      alert("A data inicial nao pode ser posterior a data final.")
      return
    }

    const rows = isPayable ? sortedPayables : filteredReceivables
    if (!rows.length) {
      alert("Nao existem contas no periodo selecionado para gerar o relatorio.")
      return
    }

    const totalExpected = rows.reduce((sum, item) => item.status === "Cancelada" ? sum : sum + Number(item.expectedAmount || 0), 0)
    const totalDone = rows.reduce((sum, item) => item.status === "Cancelada" ? sum : sum + Number(isPayable ? (item as AccountsPayable).paidAmount : (item as AccountsReceivable).receivedAmount), 0)
    const title = isPayable ? "Relatorio de Contas a Pagar" : "Relatorio de Contas a Receber"
    const periodLabel = period.start || period.end
      ? `${period.start ? formatDate(period.start) : "inicio"} a ${period.end ? formatDate(period.end) : "hoje"}`
      : "Todos os vencimentos"
    const reportRows = rows.map((item) => {
      const done = Number(isPayable ? (item as AccountsPayable).paidAmount : (item as AccountsReceivable).receivedAmount)
      const party = isPayable ? (item as AccountsPayable).supplierName : opNames.client((item as AccountsReceivable).clientId)
      const status = statusFromDates(item.status, item.dueDate, isPayable ? (item as AccountsPayable).paymentDate : (item as AccountsReceivable).receivedDate)
      return `<tr><td>${escapeReportHtml(formatDate(item.dueDate))}</td><td>${escapeReportHtml(party)}</td><td>${escapeReportHtml(item.description)}</td><td>${escapeReportHtml(categoryName(state, item.categoryId))}</td><td class="money">${escapeReportHtml(money(item.expectedAmount))}</td><td class="money">${escapeReportHtml(money(done))}</td><td class="money">${escapeReportHtml(money(Math.max(Number(item.expectedAmount || 0) - done, 0)))}</td><td>${escapeReportHtml(status)}</td></tr>`
    }).join("")
    const reportWindow = window.open("", "_blank")
    if (!reportWindow) {
      alert("O navegador bloqueou a abertura do relatorio. Libere pop-ups para este sistema.")
      return
    }
    reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:11px}h1{font-size:22px;margin:0 0 4px}.meta{color:#526078;margin-bottom:18px}.summary{display:flex;gap:12px;margin-bottom:18px}.summary div{border:1px solid #d8e0ec;padding:10px 14px;min-width:180px}.summary span{display:block;color:#526078;margin-bottom:4px}.summary strong{font-size:15px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8e0ec;padding:7px;text-align:left;vertical-align:top}th{background:#eef3f9}.money{text-align:right;white-space:nowrap}.footer{margin-top:12px;color:#68758a}@media print{button{display:none}}</style></head><body><h1>${title}</h1><div class="meta">Periodo de vencimento: ${escapeReportHtml(periodLabel)} | Gerado em ${escapeReportHtml(new Date().toLocaleString("pt-BR"))}</div><div class="summary"><div><span>Total previsto</span><strong>${escapeReportHtml(money(totalExpected))}</strong></div><div><span>${isPayable ? "Total pago" : "Total recebido"}</span><strong>${escapeReportHtml(money(totalDone))}</strong></div><div><span>${isPayable ? "Saldo a pagar" : "Saldo a receber"}</span><strong>${escapeReportHtml(money(Math.max(totalExpected - totalDone, 0)))}</strong></div></div><table><thead><tr><th>Vencimento</th><th>${isPayable ? "Fornecedor" : "Cliente"}</th><th>Descricao</th><th>Categoria</th><th>Previsto</th><th>${isPayable ? "Pago" : "Recebido"}</th><th>Saldo</th><th>Status</th></tr></thead><tbody>${reportRows}</tbody></table><div class="footer">${rows.length} conta(s) encontrada(s). Contas canceladas aparecem no relatorio, mas nao compoem os totais.</div><script>window.addEventListener('load',()=>window.print())</script></body></html>`)
    reportWindow.document.close()
  }

  async function processInvoice(file?: File | null, cardId = state.creditCards[0]?.id || "", rawText = "") {
    if ((!file && !rawText.trim()) || !cardId) return
    setOcrStatus("Enviando arquivo para processamento web...")
    try {
      const parsed = await processInvoiceOnServer(file, state, cardId, rawText)
      setOcrStatus(parsed.items.length ? `Importacao pronta: ${parsed.items.length} linhas extraidas e categorizadas.` : "Nao consegui montar a tabela. Verifique se o PDF tem texto selecionavel ou cole o texto no campo de apoio.")
      const officialTotal = officialInvoiceTotalFromText(parsed.rawText)
      setPreview({ ...parsed, invoice: { ...parsed.invoice, totalAmount: officialTotal || parsed.invoice.totalAmount }, fileName: file?.name || "texto-extraido.txt", creditCardId: cardId })
    } catch (error) {
      setOcrStatus(error instanceof Error ? error.message : "Falha ao processar fatura pela API.")
    }
  }

  async function confirmInvoice(createPayable = true) {
    if (!preview) return
    const now = financeNow()
    const invoiceId = financeId("invoice")
    const selectedItems = preview.items.filter((item: CreditCardInvoiceItem) => item.reviewStatus !== "Ignorado")
    const extractedTotal = selectedItems.reduce((sum: number, item: CreditCardInvoiceItem) => sum + item.amount, 0)
    const total = Number((officialInvoiceTotalFromText(preview.rawText) || extractedTotal).toFixed(2))
    const payableId = createPayable ? financeId("ap") : ""
    const dueDatePeriod = String(preview.invoice.dueDate || "").match(/^(\d{4})-(\d{2})-\d{2}$/)
    const referenceMonth = dueDatePeriod ? String(Number(dueDatePeriod[2])) : preview.invoice.referenceMonth
    const referenceYear = dueDatePeriod ? dueDatePeriod[1] : preview.invoice.referenceYear
    const invoice = { id: invoiceId, creditCardId: preview.creditCardId, referenceMonth, referenceYear, dueDate: preview.invoice.dueDate, holderName: preview.invoice.holderName, cardAccount: preview.invoice.cardAccount, totalAmount: total, importedAmount: total, differenceAmount: 0, status: "Importada" as const, pdfFileName: preview.fileName, rawText: preview.rawText, accountsPayableId: payableId, createdAt: now, updatedAt: now }
    const pairs = selectedItems.map((item: CreditCardInvoiceItem) => {
      const itemId = financeId("ccitem")
      const transactionId = financeId("ft")
      const installment = `${String(item.currentInstallment).padStart(2, "0")}/${String(item.totalInstallments).padStart(2, "0")}`
      const auto = item.categoryId ? null : categorizeTransaction(state, item.originalDescription)
      const fixedItem = {
        ...item,
        categoryId: item.categoryId || auto?.categoryId || "",
        subcategoryId: item.subcategoryId || auto?.subcategoryId || "",
        costCenterId: item.costCenterId || auto?.costCenterId || "",
        dreAccountId: item.dreAccountId || auto?.dreAccountId || "",
        categoryRuleId: item.categoryRuleId || auto?.ruleId || "",
        categoryConfidence: item.categoryId ? item.categoryConfidence : (auto?.confidence as any) || item.categoryConfidence,
        categoryStatus: item.categoryId ? item.categoryStatus : (auto?.status as any) || item.categoryStatus,
      }
      const transaction = { id: transactionId, type: "Saida" as const, description: fixedItem.originalDescription, categoryId: fixedItem.categoryId, subcategoryId: fixedItem.subcategoryId, costCenterId: fixedItem.costCenterId, dreAccountId: fixedItem.dreAccountId, clientId: "", serviceOrderId: fixedItem.linkedServiceOrderId, providerId: fixedItem.linkedProviderId, vehicleId: fixedItem.linkedVehicleId, supplierName: invoice.holderName, competenceDate: fixedItem.purchaseDate, dueDate: invoice.dueDate, realizedDate: fixedItem.purchaseDate, expectedAmount: 0, realizedAmount: fixedItem.amount, paymentMethod: "Cartao de credito", bankAccountId: "", creditCardId: invoice.creditCardId, creditCardInvoiceId: invoiceId, status: "Realizado" as const, origin: "Cartao de credito", notes: `Fatura ${invoice.referenceMonth}/${invoice.referenceYear} | Parcela: ${installment} | Linha: ${fixedItem.rawLine}`, attachmentName: invoice.pdfFileName, createdAt: now, updatedAt: now }
      const invoiceItem = { ...fixedItem, id: itemId, invoiceId, linkedTransactionId: transactionId }
      return { item: invoiceItem, transaction }
    })
    const items = pairs.map((pair) => pair.item)
    const transactions = pairs.map((pair) => pair.transaction)
    const adjustment = Number((total - extractedTotal).toFixed(2))
    if (Math.abs(adjustment) >= 0.01) {
      transactions.push({ id: financeId("ft"), type: "Saida" as const, description: "Ajuste total da fatura", categoryId: "", subcategoryId: "", costCenterId: "", dreAccountId: "dre-sem-classificacao", clientId: "", serviceOrderId: "", providerId: "", vehicleId: "", supplierName: invoice.holderName, competenceDate: invoice.dueDate, dueDate: invoice.dueDate, realizedDate: invoice.dueDate, expectedAmount: 0, realizedAmount: adjustment, paymentMethod: "Cartao de credito", bankAccountId: "", creditCardId: invoice.creditCardId, creditCardInvoiceId: invoiceId, status: "Realizado" as const, origin: "Cartao de credito", notes: `Ajuste automatico para fechar o total oficial da fatura em ${money(total)}. Base extraida: ${money(extractedTotal)}.`, attachmentName: invoice.pdfFileName, createdAt: now, updatedAt: now })
    }
    const card = state.creditCards.find((row) => row.id === preview.creditCardId)
    const payable = createPayable ? { id: payableId, supplierName: card?.bankName || card?.name || "Cartao de credito", description: `Fatura cartao ${invoice.referenceMonth}/${invoice.referenceYear}`, categoryId: "cat-veiculos", subcategoryId: "", costCenterId: "cc-admin", dreAccountId: "dre-financeiras", serviceOrderId: "", providerId: "", vehicleId: "", competenceDate: invoice.dueDate, dueDate: invoice.dueDate, paymentDate: "", expectedAmount: total, paidAmount: 0, paymentMethod: "Cartao de credito", bankAccountId: "", creditCardId: invoice.creditCardId, creditCardInvoiceId: invoiceId, status: "Aberta" as const, origin: "Cartao de credito", notes: "", attachmentName: invoice.pdfFileName, transactionId: "", createdAt: now, updatedAt: now } : null
    const sameInvoice = (row: { creditCardId?: string; referenceMonth?: string; referenceYear?: string; pdfFileName?: string }) => row.creditCardId === invoice.creditCardId && row.referenceMonth === invoice.referenceMonth && row.referenceYear === invoice.referenceYear && (!invoice.pdfFileName || row.pdfFileName === invoice.pdfFileName)
    const oldInvoiceIds = new Set(state.creditCardInvoices.filter(sameInvoice).map((row) => row.id))
    const oldTransactionIds = new Set(state.creditCardInvoiceItems.filter((item) => oldInvoiceIds.has(item.invoiceId)).map((item) => item.linkedTransactionId).filter(Boolean))
    const baseTransactions = state.transactions.filter((item) => !oldTransactionIds.has(item.id) && !oldInvoiceIds.has(item.creditCardInvoiceId))
    const baseItems = state.creditCardInvoiceItems.filter((item) => !oldInvoiceIds.has(item.invoiceId))
    const baseInvoices = state.creditCardInvoices.filter((row) => !oldInvoiceIds.has(row.id))
    const basePayables = state.accountsPayable.filter((item) => !oldInvoiceIds.has(item.creditCardInvoiceId))
    const next = { ...state, creditCardInvoices: [invoice, ...baseInvoices], creditCardInvoiceItems: [...items, ...baseItems], transactions: dedupeTransactions([...transactions, ...baseTransactions]), accountsPayable: payable ? [payable, ...basePayables] : basePayables }
    try {
      setOcrStatus("Salvando importacao no Supabase...")
      await save(next)
      setPreview(null)
      setOcrStatus(`Importacao salva no Supabase: ${transactions.length} lancamentos em Entradas e Saidas.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar a fatura no Supabase."
      setOcrStatus(message)
      alert(message)
    }
  }

  async function processRules(file?: File | null) {
    if (!file) return
    setRulePreview(await importCategoryRulesFromExcel(file))
  }

  function confirmRulePreview() {
    const now = financeNow()
    const newCategories: FinancialCategory[] = []
    const newRules = rulePreview.filter((item) => !item.ignored).map((item) => {
      let category = state.categories.find((row) => row.name.toLowerCase() === item.category.toLowerCase()) || newCategories.find((row) => row.name.toLowerCase() === item.category.toLowerCase())
      if (!category) {
        category = { id: financeId("cat"), name: item.category, type: "saida", dreAccountId: item.category.toLowerCase().includes("chat") ? "dre-ti" : "dre-materiais", status: "Ativo", createdAt: now, updatedAt: now }
        newCategories.push(category)
      }
      return { id: financeId("rule"), name: item.searchText, priority: 20, searchText: item.searchText, normalizedSearchText: normalizeDescription(item.searchText), comparisonType: "Contem" as const, categoryId: category.id, subcategoryId: "", costCenterId: "cc-operacao", dreAccountId: category.dreAccountId, creditCardId: "", cardHolder: "", defaultConfidence: item.confidence, active: true, notes: `Importado de Excel: ${item.originalDescription}`, createdAt: now, updatedAt: now }
    })
    commit((current) => ({ ...current, categories: [...newCategories, ...current.categories], categoryRules: [...newRules, ...current.categoryRules] }))
    setRulePreview([])
  }

  return (
    <FinanceErrorBoundary>
    <PageShell title="Financeiro" description="Controle financeiro da empresa com previsto, realizado, contas, DRE, cartoes e importacao de fatura." actions={activeTab === "lancamentos" ? <><Button onClick={() => setSheet("entrada")}><Plus className="h-4 w-4" />Nova Entrada</Button><Button variant="secondary" onClick={() => setSheet("saida")}>Nova Saida</Button><Button variant="secondary" onClick={() => openNewAccount("pagar")}>Nova Conta a Pagar</Button><Button variant="secondary" onClick={() => openNewAccount("receber")}>Nova Conta a Receber</Button></> : null}>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="visao">Visao Geral</TabsTrigger><TabsTrigger value="lancamentos">Entradas e Saidas</TabsTrigger><TabsTrigger value="pagar">Contas a Pagar</TabsTrigger><TabsTrigger value="receber">Contas a Receber</TabsTrigger><TabsTrigger value="emitir-nf">Emitir NF</TabsTrigger><TabsTrigger value="dre">DRE</TabsTrigger><TabsTrigger value="cartao">Cartao de Credito</TabsTrigger><TabsTrigger value="importar">Importar</TabsTrigger><TabsTrigger value="regras">Regras de Categoria</TabsTrigger><TabsTrigger value="cadastros">Cadastros</TabsTrigger><TabsTrigger value="asaas">Integracao Asaas</TabsTrigger></TabsList>
        {activeTab === "pagar" ? <div className="my-4 flex flex-wrap gap-2"><AsaasSupplierPaymentButton state={operational.state} /></div> : null}
        <TabsContent value="visao" className="space-y-4">
          <div className="flex flex-col gap-3 rounded-md border bg-background p-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-semibold">Periodo da Visao Geral</p><p className="text-xs text-muted-foreground">Inclui lancamentos do sistema e extratos das contas Asaas de Servicos e Materiais.</p></div>
            <div className="grid gap-2 sm:grid-cols-[170px_170px_auto]">
              <div className="space-y-1"><Label htmlFor="overview-period-start">Data inicial</Label><Input id="overview-period-start" type="date" value={overviewPeriod.start} max={overviewPeriod.end || undefined} onChange={(event) => setOverviewPeriod((current) => ({ ...current, start: event.target.value }))} /></div>
              <div className="space-y-1"><Label htmlFor="overview-period-end">Data final</Label><Input id="overview-period-end" type="date" value={overviewPeriod.end} min={overviewPeriod.start || undefined} onChange={(event) => setOverviewPeriod((current) => ({ ...current, end: event.target.value }))} /></div>
              {user?.role === "admin" ? <Button className="self-end" variant="outline" disabled={asaasSyncing} onClick={syncOverviewAsaas}><RefreshCw className={`h-4 w-4 ${asaasSyncing ? "animate-spin" : ""}`} />{asaasSyncing ? "Sincronizando" : "Sincronizar Asaas"}</Button> : null}
            </div>
          </div>
          {asaasSyncMessage ? <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{asaasSyncMessage}</p> : null}
          <DueAlertsPanel state={state} clientName={opNames.client} />
          <AsaasWebhookAlertsPanel />
          <AsaasBalanceCards />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="Receita prevista" value={loading ? "..." : money(financialPeriodOverview.metrics.plannedRevenue)} note={overviewPeriodLabel} icon={BarChart3} /><MetricCard title="Receita realizada" value={loading ? "..." : money(financialPeriodOverview.metrics.realizedRevenue)} note={overviewPeriodLabel} icon={TrendingUp} /><MetricCard title="Despesa realizada" value={loading ? "..." : money(financialPeriodOverview.metrics.realizedExpense)} note={overviewPeriodLabel} icon={TrendingDown} /><MetricCard title="Saldo realizado" value={loading ? "..." : money(financialPeriodOverview.metrics.realizedBalance)} note={overviewPeriodLabel} icon={Wallet} /></div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><MetricCard title="Entradas previstas no periodo" value={money(summary.entriesExpected)} note="Fluxo previsto" icon={TrendingUp} /><MetricCard title="Entradas realizadas no periodo" value={money(summary.entriesDone)} note="Sistema + Asaas" icon={TrendingUp} /><MetricCard title="Saidas previstas no periodo" value={money(summary.outputsExpected)} note="A pagar" icon={TrendingDown} /><MetricCard title="Saidas realizadas no periodo" value={money(summary.outputsDone)} note="Sistema + Asaas" icon={TrendingDown} /><MetricCard title="Saldo previsto" value={money(summary.plannedBalance)} note="Entradas - saidas" icon={Wallet} /><MetricCard title="Saldo realizado" value={money(summary.realizedBalance)} note="Caixa realizado" icon={Wallet} /><MetricCard title="Contas a pagar vencidas" value={overviewPayables.filter((item) => isOverdue(item.dueDate, item.paymentDate, item.status)).length} note="No periodo" icon={Receipt} /><MetricCard title="Contas a receber vencidas" value={overviewReceivables.filter((item) => isOverdue(item.dueDate, item.receivedDate, item.status)).length} note="No periodo" icon={Receipt} /><MetricCard title="Faturas de cartao no periodo" value={money(overviewInvoices.reduce((total, item) => total + Number(item.totalAmount || 0), 0))} note={`${overviewInvoices.length} fatura(s)`} icon={CreditCard} /><MetricCard title="Resultado do periodo" value={money(summary.realizedBalance)} note="Realizado" icon={BarChart3} /></div>
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Financeiro mensal" description={`Receitas e despesas previstas e realizadas: ${overviewPeriodLabel}.`}><div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={financialPeriodOverview.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis tickFormatter={compactMoney} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="receitaPrevista" name="Receita prevista" fill="#93c5fd" /><Bar dataKey="receitaRealizada" name="Receita realizada" fill="#2563eb" /><Bar dataKey="despesaPrevista" name="Despesa prevista" fill="#fdba74" /><Bar dataKey="despesaRealizada" name="Despesa realizada" fill="#f97316" /></BarChart></ResponsiveContainer></div></SectionCard>
            <SectionCard title="Saldo mensal" description={`Resultado previsto e realizado: ${overviewPeriodLabel}.`}><div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={financialPeriodOverview.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis tickFormatter={compactMoney} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Line type="monotone" dataKey="saldoPrevisto" name="Saldo previsto" stroke="#64748b" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="saldoRealizado" name="Saldo realizado" stroke="#16a34a" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div></SectionCard>
          </div>
          <SectionCard title="Fluxo do periodo"><TransactionsTable state={state} transactions={overviewTransactions} opNames={opNames} compact /></SectionCard>
        </TabsContent>
        <TabsContent value="lancamentos" className="space-y-4"><div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_160px_160px] lg:max-w-4xl"><Input placeholder="Filtrar lancamentos" value={query} onChange={(event) => setQuery(event.target.value)} /><Select value={monthFilter} onValueChange={setMonthFilter}><SelectTrigger><SelectValue placeholder="Mes" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os meses</SelectItem><SelectItem value="01">Janeiro</SelectItem><SelectItem value="02">Fevereiro</SelectItem><SelectItem value="03">Marco</SelectItem><SelectItem value="04">Abril</SelectItem><SelectItem value="05">Maio</SelectItem><SelectItem value="06">Junho</SelectItem><SelectItem value="07">Julho</SelectItem><SelectItem value="08">Agosto</SelectItem><SelectItem value="09">Setembro</SelectItem><SelectItem value="10">Outubro</SelectItem><SelectItem value="11">Novembro</SelectItem><SelectItem value="12">Dezembro</SelectItem></SelectContent></Select><Select value={yearFilter} onValueChange={setYearFilter}><SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os anos</SelectItem>{yearOptions.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent></Select></div><TransactionsTable state={state} transactions={filteredTransactions} opNames={opNames} /></TabsContent>
        <TabsContent value="pagar">
          <SectionCard title="Contas a Pagar">
            <DueAlertsPanel state={state} clientName={opNames.client} kind="pagar" />
            <div className="mb-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openNewAccount("pagar")}><Plus className="h-4 w-4" />Nova Conta a Pagar</Button>
                <Button variant="outline" onClick={() => generateAccountsReport("pagar")}><FileText className="h-4 w-4" />Gerar relatorio do periodo</Button>
              </div>
              <div className="grid gap-3 rounded-md border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,240px)_minmax(180px,240px)_minmax(240px,300px)_auto]">
                <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                  <Label htmlFor="payable-search">Pesquisar contas</Label>
                  <div className="relative max-w-2xl">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="payable-search" className="pl-9" value={payableQuery} onChange={(event) => setPayableQuery(event.target.value)} placeholder="Fornecedor, descricao ou valor" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payable-period-start">Data inicial</Label>
                  <Input id="payable-period-start" type="date" value={payablePeriod.start} onChange={(event) => setPayablePeriod((current) => ({ ...current, start: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payable-period-end">Data final</Label>
                  <Input id="payable-period-end" type="date" value={payablePeriod.end} min={payablePeriod.start || undefined} onChange={(event) => setPayablePeriod((current) => ({ ...current, end: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payable-sort">Ordenar por</Label>
                  <Select value={payableSort} onValueChange={(value) => setPayableSort(value as PayableSort)}>
                    <SelectTrigger id="payable-sort"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier-asc">Fornecedor: A a Z</SelectItem>
                      <SelectItem value="supplier-desc">Fornecedor: Z a A</SelectItem>
                      <SelectItem value="due-asc">Vencimento: mais proximo</SelectItem>
                      <SelectItem value="due-desc">Vencimento: mais distante</SelectItem>
                      <SelectItem value="amount-asc">Valor: menor para maior</SelectItem>
                      <SelectItem value="amount-desc">Valor: maior para menor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button variant="ghost" onClick={() => setPayablePeriod({ start: "", end: "" })}><CalendarRange className="h-4 w-4" />Limpar periodo</Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Previsto no periodo</p><strong>{money(payableTotals.expected)}</strong></div>
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Pago no periodo</p><strong>{money(payableTotals.done)}</strong></div>
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Saldo a pagar</p><strong>{money(Math.max(payableTotals.expected - payableTotals.done, 0))}</strong></div>
              </div>
            </div>
            <DataTable headers={["Vencimento", "Fornecedor", "Descricao", "Documento", "Parcela", "Categoria", "Valor", "Pago", "Status", "Origem", "Acoes"]} empty={!sortedPayables.length} stickyHeader viewportClassName={financeTableViewport} tableClassName={`min-w-[1500px] ${financeTableRows}`}>
              {sortedPayables.map((item) => <TableRow key={item.id}><TableCell>{formatDate(item.dueDate)}</TableCell><TableCell>{item.supplierName}</TableCell><TableCell>{item.description}</TableCell><TableCell>{item.documentNumber || "-"}</TableCell><TableCell>{installmentLabel(item)}</TableCell><TableCell>{categoryName(state, item.categoryId)}</TableCell><TableCell>{money(accountSettlementAmount(item))}</TableCell><TableCell>{money(item.paidAmount)}</TableCell><TableCell><StatusBadge status={payableAutoStatus(item)} /></TableCell><TableCell>{accountOriginLabel(item)}</TableCell><TableCell className="space-x-1"><Button size="sm" variant="outline" onClick={() => markPayablePaid(item)}>Pagar</Button><Button size="sm" variant="outline" onClick={() => markPayablePaid(item, true)}>Parcial</Button><Button size="sm" variant="outline" title="Editar conta" onClick={() => openAccountEdit({ kind: "pagar", item })}><Pencil className="h-4 w-4" />Editar</Button><Button size="sm" variant="destructive" title="Excluir conta" onClick={() => deleteAccount({ kind: "pagar", item })}><Trash2 className="h-4 w-4" />Excluir</Button></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="receber"><SectionCard title="Contas a Receber"><DueAlertsPanel state={state} clientName={opNames.client} kind="receber" /><div className="mb-4 space-y-4"><div className="flex flex-wrap gap-2"><Button onClick={() => openNewAccount("receber")}><Plus className="h-4 w-4" />Nova Conta a Receber</Button><Button variant="outline" onClick={() => generateAccountsReport("receber")}><FileText className="h-4 w-4" />Gerar relatorio do periodo</Button></div><div className="grid gap-3 rounded-md border bg-muted/20 p-4 md:grid-cols-[minmax(180px,240px)_minmax(180px,240px)_auto]"><div className="space-y-1.5"><Label htmlFor="receivable-period-start">Data inicial</Label><Input id="receivable-period-start" type="date" value={receivablePeriod.start} onChange={(event) => setReceivablePeriod((current) => ({ ...current, start: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="receivable-period-end">Data final</Label><Input id="receivable-period-end" type="date" value={receivablePeriod.end} min={receivablePeriod.start || undefined} onChange={(event) => setReceivablePeriod((current) => ({ ...current, end: event.target.value }))} /></div><div className="flex items-end"><Button variant="ghost" onClick={() => setReceivablePeriod({ start: "", end: "" })}><CalendarRange className="h-4 w-4" />Limpar periodo</Button></div></div><div className="grid gap-3 md:grid-cols-3"><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Previsto no periodo</p><strong>{money(receivableTotals.expected)}</strong></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Recebido no periodo</p><strong>{money(receivableTotals.done)}</strong></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Saldo a receber</p><strong>{money(Math.max(receivableTotals.expected - receivableTotals.done, 0))}</strong></div></div></div><DataTable headers={["Vencimento", "Cliente", "Descricao", "Documento", "Parcela", "Valor", "Recebido", "Status", "Origem", "Acoes"]} empty={!filteredReceivables.length} stickyHeader viewportClassName={financeTableViewport} tableClassName={`min-w-[1500px] ${financeTableRows}`}>{filteredReceivables.map((item) => <TableRow key={item.id}><TableCell>{formatDate(item.dueDate)}</TableCell><TableCell>{opNames.client(item.clientId)}</TableCell><TableCell>{item.description}</TableCell><TableCell>{item.documentNumber || "-"}</TableCell><TableCell>{installmentLabel(item)}</TableCell><TableCell>{money(accountSettlementAmount(item))}</TableCell><TableCell>{money(item.receivedAmount)}</TableCell><TableCell><StatusBadge status={receivableAutoStatus(item)} /></TableCell><TableCell>{accountOriginLabel(item, operational.state.serviceOrders.find((order) => order.id === item.serviceOrderId)?.orderNumber)}</TableCell><TableCell className="space-x-1">{item.origin.toLowerCase().includes("asaas") ? <AsaasSavedChargeButton accountsReceivableId={item.id} /> : null}<Button size="sm" variant="outline" onClick={() => markReceivableReceived(item)}>Receber</Button><Button size="sm" variant="outline" onClick={() => markReceivableReceived(item, true)}>Parcial</Button><Button size="sm" variant="outline" title="Editar conta" onClick={() => openAccountEdit({ kind: "receber", item })}><Pencil className="h-4 w-4" />Editar</Button><Button size="sm" variant="destructive" title="Excluir conta" onClick={() => deleteAccount({ kind: "receber", item })}><Trash2 className="h-4 w-4" />Excluir</Button></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="dre"><DreTab state={state} transactions={state.transactions} commit={commit} operationalState={operational.state} opNames={opNames} openDreSheet={setSheet} loading={loading} loadError={loadError} /></TabsContent>
        <TabsContent value="emitir-nf"><NotaAsInvoicePanel state={operational.state} /></TabsContent>
        <TabsContent value="cartao"><CreditCardTab state={state} commit={commit} openCard={() => setSheet("cartao")} /></TabsContent>
        <TabsContent value="importar"><ImportInvoiceTab state={state} commit={commit} save={save} preview={preview} setPreview={setPreview} processInvoice={processInvoice} confirmInvoice={confirmInvoice} ocrStatus={ocrStatus} /></TabsContent>
        <TabsContent value="regras"><RulesTab state={state} openRule={() => setSheet("regra")} processRules={processRules} rulePreview={rulePreview} setRulePreview={setRulePreview} confirmRulePreview={confirmRulePreview} /></TabsContent>
        <TabsContent value="asaas"><AsaasIntegrationTab /></TabsContent>
        <TabsContent value="cadastros"><FinanceRegistriesTab state={state} commit={commit} /></TabsContent>
      </Tabs>
      <FinanceSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} editingAccount={editingAccount} clearEditingAccount={() => setEditingAccount(null)} saveState={save} refreshState={refresh} />
    </PageShell>
    </FinanceErrorBoundary>
  )
}

type AsaasStatusPayload = {
  configuration: Array<{ code: "services" | "materials"; label: string; environment: string; apiConfigured: boolean; webhookConfigured: boolean }>
  accounts: Array<{ code: string; name: string; purpose: string; enabled: boolean; last_statement_sync_at?: string; last_webhook_at?: string }>
  fiscalDocuments: Array<{ id: string; document_kind: string; provider: string; status: string; service_order_id?: string; value: number; effective_date?: string; pdf_url?: string; error_message?: string }>
  webhookAlerts: AsaasWebhookAlert[]
  webhookEventCount: number
  materialInvoiceProviderConfigured: boolean
}

type AsaasWebhookAlert = {
  id: string
  eventType: string
  category: string
  account: "services" | "materials"
  accountName: string
  resourceId?: string
  description: string
  value: number
  receivedAt: string
  processingError?: string
}

function AsaasAlertList({ alerts, emptyMessage = "Nenhum alerta critico recebido das duas contas Asaas." }: { alerts: AsaasWebhookAlert[]; emptyMessage?: string }) {
  if (!alerts.length) {
    return <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{emptyMessage}</div>
  }
  return <div className="divide-y rounded-md border border-amber-200 bg-amber-50/60">
    {alerts.map((alert) => <div key={alert.id} className="grid gap-2 p-3 text-sm md:grid-cols-[minmax(120px,160px)_minmax(160px,1fr)_auto] md:items-center">
      <div className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />{alert.category}</div>
      <div className="min-w-0"><p className="break-words font-medium">{alert.description}</p><p className="break-all text-xs text-muted-foreground">{alert.eventType}{alert.resourceId ? ` | ${alert.resourceId}` : ""}</p></div>
      <div className="text-left md:text-right"><StatusBadge status={alert.account === "services" ? "Servicos" : "Materiais"} /><p className="mt-1 text-xs text-muted-foreground">{new Date(alert.receivedAt).toLocaleString("pt-BR")}</p></div>
    </div>)}
  </div>
}

function AsaasWebhookAlertsPanel() {
  const [alerts, setAlerts] = useState<AsaasWebhookAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setInterval> | null = null
    const load = async () => {
      try {
        const response = await fetch("/api/integrations/asaas/status", { cache: "no-store" })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "Falha ao consultar alertas Asaas.")
        if (active) {
          setAlerts(Array.isArray(payload.webhookAlerts) ? payload.webhookAlerts.slice(0, 8) : [])
          setUnavailable(false)
        }
      } catch {
        if (active) setUnavailable(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    timer = setInterval(() => void load(), 30_000)
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [])

  return <SectionCard title="Alertas Asaas" description="Ocorrencias criticas recebidas em tempo real das contas de servicos e materiais.">
    {loading ? <p className="text-sm text-muted-foreground">Consultando os webhooks...</p> : unavailable ? <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><XCircle className="h-4 w-4" />Nao foi possivel consultar os alertas da integracao.</div> : <AsaasAlertList alerts={alerts} />}
  </SectionCard>
}

function AsaasIntegrationTab() {
  const [status, setStatus] = useState<AsaasStatusPayload | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [connectionResults, setConnectionResults] = useState<Array<{ code: string; label: string; environment: string; connected: boolean; message: string }>>([])

  async function testConnection() {
    setBusy(true)
    setConnectionResults([])
    try {
      const response = await fetch("/api/integrations/asaas/test-connection", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao testar conexao.")
      setConnectionResults(payload.accounts)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao testar conexao.")
    } finally {
      setBusy(false)
    }
  }

  const load = async () => {
    setBusy(true)
    try {
      const response = await fetch("/api/integrations/asaas/status", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar Asaas.")
      setStatus(payload)
      setMessage("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao consultar Asaas.")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [])

  const setupWebhooks = async () => {
    setBusy(true)
    try {
      const response = await fetch("/api/integrations/asaas/setup-webhooks", { method: "POST" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao registrar webhooks.")
      setMessage("Webhooks das duas contas registrados com sucesso.")
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar webhooks.")
    } finally {
      setBusy(false)
    }
  }

  const sync = async (account: "services" | "materials") => {
    setBusy(true)
    const finishDate = new Date().toISOString().slice(0, 10)
    const start = new Date()
    start.setDate(1)
    try {
      const response = await fetch("/api/integrations/asaas/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, startDate: start.toISOString().slice(0, 10), finishDate }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao sincronizar extrato.")
      setMessage(`${payload.imported} movimento(s) conciliado(s) na conta de ${account === "services" ? "servicos" : "materiais"}.`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao sincronizar extrato.")
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-4">
    <SectionCard title="Duas contas Asaas" description="Servicos e materiais permanecem separados nas cobrancas e na conciliacao financeira.">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Atualizar status</Button>
        <Button variant="outline" disabled={busy} onClick={() => void testConnection()}><PlugZap className="h-4 w-4" />Testar conexao</Button>
        <Button disabled={busy} onClick={() => void setupWebhooks()}><PlugZap className="h-4 w-4" />Registrar webhooks</Button>
      </div>
      {message ? <p className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">{message}</p> : null}
      <div aria-live="polite">{connectionResults.map((result) => <p key={result.code} className={`mb-3 rounded-md border p-3 text-sm ${result.connected ? "text-emerald-700" : "text-red-700"}`}><strong>{result.label} ({result.environment}): </strong>{result.message}</p>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["services", "materials"] as const).map((code) => {
          const config = status?.configuration.find((item) => item.code === code)
          const account = status?.accounts.find((item) => item.code === code)
          return <div key={code} className="rounded-md border bg-background p-4">
            <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{code === "services" ? "Conta de servicos" : "Conta de materiais"}</h3><p className="text-sm text-muted-foreground">Cobrancas, pagamentos e conciliacao financeira</p></div><StatusBadge status={account?.enabled === false ? "Inativa" : "Ativa"} /></div>
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2">{config?.apiConfigured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />} Chave da API</p>
              <p className="flex items-center gap-2">{config?.webhookConfigured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />} Token do webhook</p>
              <p>Ambiente: <strong>{config?.environment || "-"}</strong></p>
              <p>Ultimo webhook: <strong>{account?.last_webhook_at ? new Date(account.last_webhook_at).toLocaleString("pt-BR") : "Nenhum"}</strong></p>
              <p>Ultima conciliacao: <strong>{account?.last_statement_sync_at ? new Date(account.last_statement_sync_at).toLocaleString("pt-BR") : "Nenhuma"}</strong></p>
            </div>
            <Button className="mt-4" variant="outline" disabled={busy || !config?.apiConfigured} onClick={() => void sync(code)}><RefreshCw className="h-4 w-4" />Sincronizar mes atual</Button>
          </div>
        })}
      </div>
      <div className="mt-4 rounded-md border p-4 text-sm"><strong>Fluxo fiscal:</strong> a emissao de NFS-e e NF-e agora e feita pelo NotaAS na aba Emitir NF. O Asaas permanece responsavel pelo fluxo financeiro.</div>
    </SectionCard>
    <SectionCard title="Alertas dos webhooks" description={`Eventos criticos das duas contas. ${status?.webhookEventCount || 0} evento(s) recente(s) consultado(s).`}>
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><BellRing className="h-4 w-4" />Cada alerta identifica se veio da conta de servicos ou de materiais.</div>
      <AsaasAlertList alerts={status?.webhookAlerts || []} />
    </SectionCard>
    <SectionCard title="Documentos fiscais anteriores" description="Historico legado do fluxo fiscal antigo. As novas notas aparecem na aba Emitir NF.">
      <DataTable headers={["Tipo", "Provedor", "OS", "Data", "Valor", "Status", "Documento"]} empty={!status?.fiscalDocuments.length}>
        {(status?.fiscalDocuments || []).map((document) => <TableRow key={document.id}><TableCell>{document.document_kind === "service" ? "Servico" : "Material"}</TableCell><TableCell>{document.provider === "asaas_nfse" ? "Asaas NFS-e" : "Base NF-e"}</TableCell><TableCell>{document.service_order_id || "-"}</TableCell><TableCell>{formatDate(document.effective_date || "")}</TableCell><TableCell>{money(Number(document.value || 0))}</TableCell><TableCell><StatusBadge status={document.status} /></TableCell><TableCell>{document.pdf_url ? <a className="text-primary underline" href={document.pdf_url} target="_blank" rel="noreferrer">Abrir PDF</a> : document.error_message || "-"}</TableCell></TableRow>)}
      </DataTable>
    </SectionCard>
  </div>
}

function TransactionsTable({ state, transactions, opNames, compact = false }: { state: FinancialState; transactions: FinancialTransaction[]; opNames: ReturnType<typeof names>; compact?: boolean }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const installment = (item: FinancialTransaction) => {
    const invoiceItem = state.creditCardInvoiceItems.find((row) => row.linkedTransactionId === item.id)
    if (invoiceItem) return `${String(invoiceItem.currentInstallment).padStart(2, "0")}/${String(invoiceItem.totalInstallments).padStart(2, "0")}`
    const match = item.notes.match(/Parcela:\s*(\d{1,2})\/(\d{1,2})/i)
    return match ? `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}` : "-"
  }
  const amount = transactionAmount
  const signed = (item: FinancialTransaction) => (item.type === "Entrada" ? 1 : -1) * amount(item)
  const visibleRows = useMemo(
    () => [...dedupeTransactions(transactions)].sort((left, right) => transactionFilterDate(right).localeCompare(transactionFilterDate(left))),
    [transactions],
  )
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize))
  const paginatedRows = visibleRows.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => setPage(1), [transactions, pageSize])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const inputTotal = visibleRows.filter((item) => item.type === "Entrada").reduce((sum, item) => sum + amount(item), 0)
  const outputTotal = visibleRows.filter((item) => item.type === "Saida").reduce((sum, item) => sum + amount(item), 0)
  const balanceTotal = visibleRows.reduce((sum, item) => sum + signed(item), 0)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Total de entradas</p><strong>{money(inputTotal)}</strong></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Total de saidas</p><strong>{money(outputTotal)}</strong></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Saldo da tabela</p><strong>{money(balanceTotal)}</strong></div>
      </div>
      <DataTable headers={compact ? ["Data", "Descricao", "Parcela", "Tipo", "Categoria", "Valor", "Status", "Origem"] : ["Competencia", "Vencimento", "Descricao", "Parcela", "Tipo", "Categoria", "Subcategoria", "Centro de custo", "Valor", "Status", "Origem", "Acoes"]} empty={!visibleRows.length} stickyHeader viewportClassName={financeTableViewport} tableClassName={`${compact ? "min-w-[1080px]" : "min-w-[1680px]"} ${financeTableRows}`}>
        {paginatedRows.map((item) => <TableRow key={item.id}><TableCell>{formatDate(compact ? financialOverviewDate(item) : item.competenceDate)}</TableCell>{!compact ? <TableCell>{formatDate(item.dueDate)}</TableCell> : null}<TableCell>{item.description}</TableCell><TableCell>{installment(item)}</TableCell><TableCell>{item.type}</TableCell><TableCell>{categoryName(state, item.categoryId)}</TableCell>{!compact ? <TableCell>{subcategoryName(state, item.subcategoryId)}</TableCell> : null}{!compact ? <TableCell>{costCenterName(state, item.costCenterId)}</TableCell> : null}<TableCell>{money(amount(item))}</TableCell><TableCell><StatusBadge status={statusFromDates(item.status, item.dueDate, item.realizedDate)} /></TableCell><TableCell>{item.origin}</TableCell>{!compact ? <TableCell><Button size="sm" variant="outline" onClick={() => alert(`${item.description}\nParcela: ${installment(item)}\nValor: ${money(amount(item))}\nOS: ${item.serviceOrderId}`)}>Detalhes</Button></TableCell> : null}</TableRow>)}
      </DataTable>
      {visibleRows.length ? <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Exibindo {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, visibleRows.length)} de {visibleRows.length} lancamentos</p><div className="flex flex-wrap items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent>{[10, 20, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} por pagina</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button><span className="min-w-20 text-center text-sm">{page} de {totalPages}</span><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Proxima</Button></div></div> : null}
    </div>
  )
}

function DreTab({
  state,
  transactions,
  commit,
  operationalState,
  opNames,
  openDreSheet,
  loading,
  loadError,
}: {
  state: FinancialState
  transactions: FinancialTransaction[]
  commit: (updater: (current: FinancialState) => FinancialState) => void
  operationalState: ReturnType<typeof useOperationalStore>["state"]
  opNames: ReturnType<typeof names>
  openDreSheet: (sheet: SheetKind) => void
  loading: boolean
  loadError: string
}) {
  type DreMode = "Previsto" | "Realizado"
  type DreView = "resumo" | "receitas" | "despesas"
  type DreDetail = { title: string; rows: FinancialTransaction[]; amount: number } | null
  type EditForm = {
    id: string
    type: "Entrada" | "Saida"
    description: string
    categoryId: string
    subcategoryId: string
    costCenterId: string
    status: "Previsto" | "Realizado"
    month: string
    year: string
    amount: string
    notes: string
  }
  type DreGroup = {
    key: string
    name: string
    planned: number[]
    realized: number[]
    plannedRows: FinancialTransaction[][]
    realizedRows: FinancialTransaction[][]
  }

  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  const suggestedAccounts = ["Sem classificacao"]
  const accountAlias = (label = "") => {
    const normalized = normalizeDescription(label)
    if (!normalized || /^[\d.,\sR$-]+$/.test(label) || /^[\d.,-]+$/.test(normalized)) return "Sem classificacao"
    const direct = suggestedAccounts.find((account) => normalizeDescription(account) === normalized)
    if (direct) return direct
    const compact = normalized.replace(/\s+/g, " ")
    if (compact.includes("AJUSTE TOTAL DA FATURA")) return "Sem classificacao"
    const aliases: Array<[string, string]> = []
    const alias = aliases.find(([search]) => compact.includes(search))?.[1]
    if (alias) return alias
    const generic = compact.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim()
    if (!generic || generic === "-" || generic === "SEM CATEGORIA" || generic === "SEM CLASSIFICACAO" || generic === "SEM CATEGORIA SEM CATEGORIA") return "Sem classificacao"
    return label || "Sem classificacao"
  }
  const currentYear = String(new Date().getFullYear())
  const [filters, setFilters] = useState({
    year: currentYear,
    month: "todos",
    costCenterId: "todos",
    clientId: "todos",
    categoryId: "todos",
    subcategoryId: "todos",
    origin: "todos",
  })
  const [detail, setDetail] = useState<DreDetail>(null)
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [dreView, setDreView] = useState<DreView>("resumo")
  const hasId = <T extends { id?: string }>(item: T): item is T & { id: string } => Boolean(item?.id)
  const rawTransactions = useMemo(() => Array.isArray(transactions) ? transactions.filter((item) => Boolean(item?.id)) : [], [transactions])
  const categories = useMemo(() => Array.isArray(state.categories) ? state.categories.filter(hasId) : [], [state.categories])
  const subcategories = useMemo(() => Array.isArray(state.subcategories) ? state.subcategories.filter(hasId) : [], [state.subcategories])
  const costCenters = useMemo(() => Array.isArray(state.costCenters) ? state.costCenters.filter(hasId) : [], [state.costCenters])
  const creditCards = useMemo(() => Array.isArray(state.creditCards) ? state.creditCards.filter(hasId) : [], [state.creditCards])
  const safeTransactions = useMemo(() => dedupeTransactions(rawTransactions), [rawTransactions])
  const clients = useMemo(() => Array.isArray(operationalState.clients) ? operationalState.clients.filter(hasId) : [], [operationalState.clients])
  const serviceOrders = useMemo(() => Array.isArray(operationalState.serviceOrders) ? operationalState.serviceOrders.filter(hasId) : [], [operationalState.serviceOrders])
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
  const subcategoryById = useMemo(() => new Map(subcategories.map((item) => [item.id, item])), [subcategories])
  const serviceOrderById = useMemo(() => new Map(serviceOrders.map((item) => [item.id, item])), [serviceOrders])
  const invoiceItemByTransactionId = useMemo(() => {
    const map = new Map<string, CreditCardInvoiceItem>()
    state.creditCardInvoiceItems.forEach((item) => {
      if (item.linkedTransactionId) map.set(item.linkedTransactionId, item)
      map.set(`dre-${item.id}`, item)
    })
    return map
  }, [state.creditCardInvoiceItems])
  const categorizedByTransactionId = useMemo(() => new Map(
    safeTransactions.map((item) => [item.id, categorizeTransaction(state, item.description)]),
  ), [safeTransactions, state.categories, state.subcategories, state.categoryRules, state.dreAccounts])
  const invoiceItemFor = (item: FinancialTransaction) => invoiceItemByTransactionId.get(item.id)
  const knownCategoryId = (id = "") => categoryById.has(id) ? id : ""
  const knownSubcategoryId = (id = "") => subcategoryById.has(id) ? id : ""
  const resolvedCategoryFor = (item: FinancialTransaction) => knownCategoryId(item.categoryId) || knownCategoryId(invoiceItemFor(item)?.categoryId) || categorizedByTransactionId.get(item.id)?.categoryId || ""
  const resolvedSubcategoryFor = (item: FinancialTransaction) => knownSubcategoryId(item.subcategoryId) || knownSubcategoryId(invoiceItemFor(item)?.subcategoryId) || categorizedByTransactionId.get(item.id)?.subcategoryId || ""
  const normalizedContains = (value: string, search: string) => normalizeDescription(value).includes(normalizeDescription(search))
  const textForAccount = (item: FinancialTransaction) => {
    const category = categoryById.get(resolvedCategoryFor(item))
    const subcategory = subcategoryById.get(resolvedSubcategoryFor(item))
    return [category?.name, subcategory?.name, item.description, item.notes].filter(Boolean).join(" ")
  }
  const labelFromInvoiceLine = (line = "") => {
    const clean = line.replace(/\s+/g, " ").trim()
    const match = clean.match(/(?:R\$\s*)?-?[\d.]+,\d{1,2}\s+(.+)$/i)
    const label = match?.[1]?.trim() || ""
    if (!label || /^\d{1,2}\/\d{1,2}$/.test(label) || /^[A-Z\s]{2,20}$/i.test(label) || /^[\d.,\sR$-]+$/.test(label)) return ""
    return label
  }
  const importedCategoryLabelFor = (item: FinancialTransaction) => {
    const invoiceItem = invoiceItemFor(item)
    const rawLine = invoiceItem?.rawLine || item.notes?.match(/Linha:\s*(.+)$/i)?.[1] || ""
    const label = labelFromInvoiceLine(rawLine)
    const aliased = accountAlias(label)
    if (!label || aliased === "Sem classificacao") return ""
    const normalized = normalizeDescription(aliased)
    const known = suggestedAccounts.some((account) => normalizeDescription(account) === normalized)
      || categories.some((category) => normalizeDescription(category.name) === normalized)
      || subcategories.some((subcategory) => normalizeDescription(subcategory.name) === normalized)
    return known ? aliased : ""
  }

  const transactionDate = (item: FinancialTransaction, mode: DreMode) => {
    if (mode === "Realizado") return item.realizedDate || item.competenceDate || item.dueDate || ""
    return item.competenceDate || item.dueDate || item.realizedDate || ""
  }
  const isCreditCardCharge = (item: FinancialTransaction) => item.origin === "Cartao de credito" && Boolean(item.creditCardInvoiceId) && !/^fatura cartao/i.test(item.description)
  const isRealized = (item: FinancialTransaction) => isCreditCardCharge(item) || item.origin === "Conta a pagar" || item.origin === "Conta a receber" || item.status === "Realizado" || item.status === ("Paga" as any) || item.status === ("Recebida" as any)
  const signedAmount = (item: FinancialTransaction, mode: DreMode) => {
    return mode === "Realizado" ? Number(item.realizedAmount || item.expectedAmount || 0) : Number(item.expectedAmount || item.realizedAmount || 0)
  }
  const accountNameFor = (item: FinancialTransaction) => {
    const importedLabel = importedCategoryLabelFor(item)
    if (importedLabel && importedLabel !== "Sem classificacao") return importedLabel
    if (item.id.startsWith("dre-")) {
      const invoiceItem = invoiceItemFor(item)
      const category = categoryById.get(invoiceItem?.categoryId || item.categoryId)
      const subcategory = subcategoryById.get(invoiceItem?.subcategoryId || item.subcategoryId)
      const combined = category?.name && subcategory?.name && !normalizedContains(category.name, subcategory.name) && !normalizedContains(subcategory.name, category.name)
        ? `${category.name} - ${subcategory.name}`
        : subcategory?.name || category?.name || ""
      return accountAlias(combined) || "Sem classificacao"
    }
    const category = categoryById.get(resolvedCategoryFor(item))
    const subcategory = subcategoryById.get(resolvedSubcategoryFor(item))
    const combined = category?.name && subcategory?.name && !normalizedContains(category.name, subcategory.name) && !normalizedContains(subcategory.name, category.name)
      ? `${category.name} - ${subcategory.name}`
      : subcategory?.name || category?.name || ""
    return accountAlias(combined) || accountAlias(textForAccount(item)) || "Sem classificacao"
  }
  const variationText = (planned: number, realized: number) => {
    if (!planned && !realized) return "0%"
    if (planned && !realized) return "100%"
    if (!planned && realized) return "-100%"
    return `${(((planned - realized) / realized) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
  }
  const updateFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  const firstDayOfCurrentMonth = () => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  }
  const transactionEditableDate = (item: FinancialTransaction) => {
    const date = transactionDate(item, isRealized(item) ? "Realizado" : "Previsto")
    return date ? new Date(`${date.slice(0, 7)}-01T12:00:00`) : null
  }
  const canEditTransaction = (item: FinancialTransaction) => {
    if (isAdmin) return true
    if (isRealized(item)) return false
    const date = transactionEditableDate(item)
    return Boolean(date && date >= firstDayOfCurrentMonth())
  }
  const editRestrictionMessage = "Somente Admin pode editar realizado ou meses anteriores. Outros usuarios alteram apenas previsto do mes atual ou futuro."
  const openTransactionEditor = (item: FinancialTransaction) => {
    if (!canEditTransaction(item)) {
      alert(editRestrictionMessage)
      return
    }
    const mode: DreMode = isRealized(item) ? "Realizado" : "Previsto"
    const date = transactionDate(item, mode) || financeToday()
    setEditing({
      id: item.id,
      type: item.type,
      description: item.description,
      categoryId: resolvedCategoryFor(item),
      subcategoryId: resolvedSubcategoryFor(item),
      costCenterId: item.costCenterId || "",
      status: mode,
      month: date.slice(5, 7),
      year: date.slice(0, 4),
      amount: String(signedAmount(item, mode)).replace(".", ","),
      notes: item.notes || "",
    })
  }
  const saveEditedTransaction = () => {
    if (!editing) return
    const current = safeTransactions.find((item) => item.id === editing.id)
    if (!current || !canEditTransaction(current)) {
      alert(editRestrictionMessage)
      return
    }
    const amount = parseMoney(editing.amount)
    if (!editing.description || !editing.categoryId || !editing.year || !editing.month || !amount) {
      alert("Preencha descricao, categoria, mes, ano e valor.")
      return
    }
    const category = categories.find((item) => item.id === editing.categoryId)
    const status = isAdmin ? editing.status : "Previsto"
    const date = `${editing.year.replace(/\D/g, "").slice(0, 4)}-${editing.month}-01`
    if (!/^\d{4}-\d{2}-01$/.test(date)) {
      alert("Ano invalido.")
      return
    }
    const nextTransaction: FinancialTransaction = {
      ...current,
      type: editing.type,
      description: editing.description,
      categoryId: editing.categoryId,
      subcategoryId: editing.subcategoryId === "nenhuma" ? "" : editing.subcategoryId,
      costCenterId: editing.costCenterId === "nenhum" ? "" : editing.costCenterId,
      dreAccountId: category?.dreAccountId || current.dreAccountId || "dre-sem-classificacao",
      competenceDate: date,
      dueDate: date,
      realizedDate: status === "Realizado" ? date : "",
      expectedAmount: status === "Previsto" ? amount : 0,
      realizedAmount: status === "Realizado" ? amount : 0,
      status,
      notes: editing.notes,
      updatedAt: financeNow(),
    }
    commit((currentState) => ({
      ...currentState,
      transactions: currentState.transactions.map((item) => item.id === nextTransaction.id ? nextTransaction : item),
      creditCardInvoiceItems: currentState.creditCardInvoiceItems.map((item) => item.linkedTransactionId === nextTransaction.id ? { ...item, categoryId: nextTransaction.categoryId, subcategoryId: nextTransaction.subcategoryId, dreAccountId: nextTransaction.dreAccountId, amount } : item),
    }))
    setDetail((currentDetail) => currentDetail ? {
      ...currentDetail,
      rows: currentDetail.rows.map((item) => item.id === nextTransaction.id ? nextTransaction : item),
    } : currentDetail)
    setEditing(null)
  }
  const deleteEditedTransaction = () => {
    if (!editing) return
    const current = safeTransactions.find((item) => item.id === editing.id)
    if (!current || !canEditTransaction(current)) {
      alert(editRestrictionMessage)
      return
    }
    if (!confirm("Excluir este lancamento do banco de dados?")) return
    commit((currentState) => ({
      ...currentState,
      transactions: currentState.transactions.filter((item) => item.id !== editing.id),
      creditCardInvoiceItems: currentState.creditCardInvoiceItems.map((item) => item.linkedTransactionId === editing.id ? { ...item, linkedTransactionId: "" } : item),
      accountsPayable: currentState.accountsPayable.map((item) => item.transactionId === editing.id ? { ...item, transactionId: "" } : item),
      accountsReceivable: currentState.accountsReceivable.map((item) => item.transactionId === editing.id ? { ...item, transactionId: "" } : item),
    }))
    setDetail((currentDetail) => currentDetail ? {
      ...currentDetail,
      rows: currentDetail.rows.filter((item) => item.id !== editing.id),
    } : currentDetail)
    setEditing(null)
  }
  const categorySubcategoryEditOptions = (type: "Entrada" | "Saida") => {
    const kind = type === "Entrada" ? "entrada" : "saida"
    return categories
      .filter((category) => category.status === "Ativo" && (category.type === "ambos" || category.type === kind))
      .flatMap((category) => {
        const children = subcategories.filter((item) => item.categoryId === category.id)
        if (!children.length) return [{ value: `${category.id}::nenhuma`, label: category.name }]
        return children.map((child) => ({ value: `${category.id}::${child.id}`, label: `${category.name} / ${child.name}` }))
      })
  }

  const passesDreFilters = (item: FinancialTransaction, realized: boolean) => {
    const date = transactionDate(item, realized ? "Realizado" : "Previsto")
    if (!date || !date.startsWith(filters.year)) return false
    if (filters.month !== "todos" && date.slice(5, 7) !== filters.month) return false
    if (filters.costCenterId !== "todos" && item.costCenterId !== filters.costCenterId) return false
    if (filters.clientId !== "todos" && item.clientId !== filters.clientId) return false
    if (filters.categoryId !== "todos" && resolvedCategoryFor(item) !== filters.categoryId) return false
    if (filters.subcategoryId !== "todos" && resolvedSubcategoryFor(item) !== filters.subcategoryId) return false
    if (filters.origin !== "todos" && item.origin !== filters.origin) return false
    return true
  }

  const filteredTransactions = useMemo(() => {
    return safeTransactions.filter((item) => {
      if (item.type !== "Saida") return false
      const realized = isRealized(item)
      return passesDreFilters(item, realized)
    })
  }, [filters, safeTransactions, serviceOrders])

  const revenueTransactions = useMemo(() => {
    return safeTransactions.filter((item) => {
      if (item.type !== "Entrada") return false
      const realized = isRealized(item)
      return passesDreFilters(item, realized)
    })
  }, [filters, safeTransactions, serviceOrders])

  const createGroup = (key: string, name: string): DreGroup => ({
    key,
    name,
    planned: Array(12).fill(0),
    realized: Array(12).fill(0),
    plannedRows: Array.from({ length: 12 }, () => []),
    realizedRows: Array.from({ length: 12 }, () => []),
  })
  const buildDreGroups = (items: FinancialTransaction[]) => {
    const map = new Map<string, DreGroup>()
    items.forEach((item) => {
      const realized = isRealized(item)
      const mode: DreMode = realized ? "Realizado" : "Previsto"
      const date = transactionDate(item, mode)
      const month = Number(date.slice(5, 7)) - 1
      if (month < 0 || month > 11) return
      const name = accountNameFor(item) || "Sem classificacao"
      const key = normalizeDescription(name) || "SEM CLASSIFICACAO"
      const group = map.get(key) || createGroup(key, name)
      const value = signedAmount(item, mode)
      if (realized) {
        group.realized[month] += value
        group.realizedRows[month].push(item)
      } else {
        group.planned[month] += value
        group.plannedRows[month].push(item)
      }
      map.set(key, group)
    })
    const orderOf = (name: string) => suggestedAccounts.findIndex((account) => normalizeDescription(account) === normalizeDescription(name))
    return Array.from(map.values())
      .filter((group) => group.planned.some((value) => Math.abs(value) > 0.0001) || group.realized.some((value) => Math.abs(value) > 0.0001))
      .sort((a, b) => {
        const orderA = orderOf(a.name)
        const orderB = orderOf(b.name)
        if (orderA >= 0 || orderB >= 0) return (orderA >= 0 ? orderA : Number.MAX_SAFE_INTEGER) - (orderB >= 0 ? orderB : Number.MAX_SAFE_INTEGER)
        return a.name.localeCompare(b.name, "pt-BR")
      })
  }
  const accountGroups = useMemo(() => buildDreGroups(filteredTransactions), [categories, subcategories, filteredTransactions])
  const revenueGroups = useMemo(() => buildDreGroups(revenueTransactions), [categories, subcategories, revenueTransactions])
  const dreRealizedTotal = accountGroups.reduce((sum, group) => sum + group.realized.reduce((rowSum, value) => rowSum + value, 0), 0)
  const revenueRealizedTotal = revenueGroups.reduce((sum, group) => sum + group.realized.reduce((rowSum, value) => rowSum + value, 0), 0)
  const drePlannedTotal = accountGroups.reduce((sum, group) => sum + group.planned.reduce((rowSum, value) => rowSum + value, 0), 0)
  const revenuePlannedTotal = revenueGroups.reduce((sum, group) => sum + group.planned.reduce((rowSum, value) => rowSum + value, 0), 0)
  const transactionRealizedTotal = filteredTransactions.filter((item) => isRealized(item)).reduce((sum, item) => sum + signedAmount(item, "Realizado"), 0)
  const monthlyRevenueRealized = months.map((_, index) => revenueGroups.reduce((sum, group) => sum + group.realized[index], 0))
  const monthlyExpenseRealized = months.map((_, index) => accountGroups.reduce((sum, group) => sum + group.realized[index], 0))
  const monthlyRevenuePlanned = months.map((_, index) => revenueGroups.reduce((sum, group) => sum + group.planned[index], 0))
  const monthlyExpensePlanned = months.map((_, index) => accountGroups.reduce((sum, group) => sum + group.planned[index], 0))
  const expenseRevenueVariationText = (revenue: number, expense: number) => {
    if (!revenue && !expense) return "0%"
    if (revenue && !expense) return "100%"
    if (!revenue && expense) return "-100%"
    return `${((revenue / expense) - 1).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`
  }

  const exportCsv = () => {
    const lines: string[] = []
    const addTable = (title: string, groups: DreGroup[]) => {
      lines.push(title)
      lines.push(["Conta Gerencial", "P x R", ...months, "Total", "Variacao Previsto x Realizado"].join(";"))
      groups.forEach((group) => {
        const plannedTotal = group.planned.reduce((sum, value) => sum + value, 0)
        const realizedTotal = group.realized.reduce((sum, value) => sum + value, 0)
        lines.push([group.name, "Previsto", ...group.planned.map((value) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })), plannedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), variationText(plannedTotal, realizedTotal)].join(";"))
        lines.push([group.name, "Realizado", ...group.realized.map((value) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })), realizedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), ""].join(";"))
      })
      lines.push("")
    }
    addTable("Receitas", revenueGroups)
    addTable("Despesas / Saidas", accountGroups)
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `dre-${filters.year}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const importPlanned = async (file?: File | null) => {
    if (!file) return
    const text = await file.text()
    const now = financeNow()
    const newCategories: FinancialCategory[] = []
    const newTransactions: FinancialTransaction[] = []
    text.split(/\r?\n/).slice(1).forEach((line) => {
      const parts = line.split(/[;\t|,]/).map((part) => part.trim())
      const account = parts[0]
      if (!account) return
      let category = categories.find((item) => item.name.toLowerCase() === account.toLowerCase()) || newCategories.find((item) => item.name.toLowerCase() === account.toLowerCase())
      if (!category) {
        category = { id: financeId("cat"), name: account, type: account.toLowerCase().includes("receita") ? "entrada" : "saida", dreAccountId: "dre-sem-classificacao", status: "Ativo", createdAt: now, updatedAt: now }
        newCategories.push(category)
      }
      months.forEach((_, index) => {
        const value = parseMoney(parts[index + 1] || "0")
        if (!value) return
        const month = String(index + 1).padStart(2, "0")
        newTransactions.push({ id: financeId("ft"), type: category?.type === "entrada" ? "Entrada" : "Saida", description: `Previsto ${account} ${months[index]}/${filters.year}`, categoryId: category!.id, subcategoryId: "", costCenterId: "", dreAccountId: category!.dreAccountId, clientId: "", serviceOrderId: "", providerId: "", vehicleId: "", supplierName: "", competenceDate: `${filters.year}-${month}-01`, dueDate: `${filters.year}-${month}-01`, realizedDate: "", expectedAmount: value, realizedAmount: 0, paymentMethod: "", bankAccountId: "", creditCardId: "", creditCardInvoiceId: "", status: "Previsto", origin: "Importacao Excel", notes: "Previsto importado na DRE", attachmentName: file.name, createdAt: now, updatedAt: now })
      })
    })
    commit((current) => ({ ...current, categories: [...newCategories, ...current.categories], transactions: [...newTransactions, ...current.transactions] }))
    alert(`${newTransactions.length} valores previstos importados.`)
  }
  const SpreadsheetTable = ({ title, firstColumn, groups }: { title: string; firstColumn: string; groups: DreGroup[] }) => {
    const totalPlanned = months.map((_, index) => groups.reduce((sum, group) => sum + group.planned[index], 0))
    const totalRealized = months.map((_, index) => groups.reduce((sum, group) => sum + group.realized[index], 0))
    const rowButton = (group: DreGroup, mode: DreMode, index: number) => {
      const rows = mode === "Previsto" ? group.plannedRows[index] : group.realizedRows[index]
      const amount = mode === "Previsto" ? group.planned[index] : group.realized[index]
      return <button className="w-full text-right tabular-nums hover:text-primary" onClick={() => setDetail({ title: `${group.name} / ${mode} / ${months[index]}`, rows, amount })}>{money(amount)}</button>
    }
    return <SectionCard title={title} description={`${firstColumn}, P x R, meses, total anual e variacao.`}>
      <div className="relative max-h-[35rem] overflow-auto overscroll-contain rounded-md border bg-background [scrollbar-gutter:stable]">
        <table className="min-w-[1680px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-40 w-64 min-w-64 border-b bg-slate-100 px-3 py-3 text-left">{firstColumn}</th>
              <th className="sticky left-64 top-0 z-30 w-28 min-w-28 border-b bg-slate-100 px-3 py-3 text-left">P x R</th>
              {months.map((month) => <th key={month} className="sticky top-0 z-20 border-b bg-slate-100 px-3 py-3 text-right">{month}</th>)}
              <th className="sticky top-0 z-20 border-b bg-slate-100 px-3 py-3 text-right">Total</th>
              <th className="sticky top-0 z-20 w-48 border-b bg-slate-100 px-3 py-3 text-right">Variacao Previsto x Realizado</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, groupIndex) => {
              const plannedTotal = group.planned.reduce((sum, value) => sum + value, 0)
              const realizedTotal = group.realized.reduce((sum, value) => sum + value, 0)
              const bg = groupIndex % 2 ? "bg-emerald-50/45" : "bg-white"
              return <React.Fragment key={group.key}>
                <tr className={bg}>
                  <td className={`sticky left-0 z-10 border-b px-3 py-2 font-semibold ${bg}`}>{group.name}</td>
                  <td className={`sticky left-64 z-10 border-b px-3 py-2 ${bg}`}>Previsto</td>
                  {months.map((month, index) => <td key={`${group.key}-p-${month}`} className="border-b px-3 py-2">{rowButton(group, "Previsto", index)}</td>)}
                  <td className="border-b px-3 py-2 text-right font-semibold tabular-nums">{money(plannedTotal)}</td>
                  <td className="border-b px-3 py-2 text-right text-xs font-medium">{variationText(plannedTotal, realizedTotal)}</td>
                </tr>
                <tr className={bg}>
                  <td className={`sticky left-0 z-10 border-b px-3 py-2 text-muted-foreground ${bg}`}>{group.name}</td>
                  <td className={`sticky left-64 z-10 border-b px-3 py-2 ${bg}`}>Realizado</td>
                  {months.map((month, index) => <td key={`${group.key}-r-${month}`} className="border-b px-3 py-2">{rowButton(group, "Realizado", index)}</td>)}
                  <td className="border-b px-3 py-2 text-right font-semibold tabular-nums">{money(realizedTotal)}</td>
                  <td className="border-b px-3 py-2" />
                </tr>
              </React.Fragment>
            })}
            <tr className="bg-slate-100 font-semibold">
              <td className="sticky left-0 z-10 border-t bg-slate-100 px-3 py-3">Totais mensais</td>
              <td className="sticky left-64 z-10 border-t bg-slate-100 px-3 py-3">Previsto</td>
              {totalPlanned.map((value, index) => <td key={`tp-${index}`} className="border-t px-3 py-3 text-right tabular-nums">{money(value)}</td>)}
              <td className="border-t px-3 py-3 text-right tabular-nums">{money(totalPlanned.reduce((sum, value) => sum + value, 0))}</td>
              <td className="border-t px-3 py-3 text-right">{variationText(totalPlanned.reduce((sum, value) => sum + value, 0), totalRealized.reduce((sum, value) => sum + value, 0))}</td>
            </tr>
            <tr className="bg-slate-100 font-semibold">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-3">Totais mensais</td>
              <td className="sticky left-64 z-10 bg-slate-100 px-3 py-3">Realizado</td>
              {totalRealized.map((value, index) => <td key={`tr-${index}`} className="px-3 py-3 text-right tabular-nums">{money(value)}</td>)}
              <td className="px-3 py-3 text-right tabular-nums">{money(totalRealized.reduce((sum, value) => sum + value, 0))}</td>
              <td className="px-3 py-3" />
            </tr>
            <tr className="bg-emerald-100 font-semibold">
              <td className="sticky left-0 z-10 bg-emerald-100 px-3 py-3">Variacao Previsto x Realizado</td>
              <td className="sticky left-64 z-10 bg-emerald-100 px-3 py-3">%</td>
              {months.map((month, index) => <td key={`var-${month}`} className="px-3 py-3 text-right">{variationText(totalPlanned[index], totalRealized[index])}</td>)}
              <td className="px-3 py-3 text-right">{variationText(totalPlanned.reduce((sum, value) => sum + value, 0), totalRealized.reduce((sum, value) => sum + value, 0))}</td>
              <td className="px-3 py-3" />
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  }

  if (loading) {
    return <SectionCard title="Carregando DRE" description="Buscando os dados financeiros no banco de dados.">
      <div className="space-y-3" aria-busy="true" aria-label="Carregando dados da DRE">
        <div className="h-10 animate-pulse rounded-md bg-slate-100" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-md bg-slate-100" />)}
        </div>
        <div className="h-72 animate-pulse rounded-md bg-slate-100" />
      </div>
    </SectionCard>
  }

  return <div className="space-y-4">
    {loadError ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div> : null}
    <SectionCard title="DRE Gerencial" description="Planilha gerencial por ano. Faturas confirmadas entram como realizado no mes da compra.">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => alert("DRE atualizada com os lancamentos atuais.")}>Atualizar DRE</Button>
        <Button variant="secondary" onClick={() => openDreSheet("dre-receita")}><TrendingUp className="mr-2 h-4 w-4" />Nova Receita</Button>
        <Button variant="secondary" onClick={() => openDreSheet("dre-despesa")}><TrendingDown className="mr-2 h-4 w-4" />Nova Despesa</Button>
        <Button variant="outline" onClick={exportCsv}>Exportar Excel</Button>
        <Button variant="outline" onClick={() => alert("Exportacao PDF sera preparada na proxima etapa.")}>Exportar PDF</Button>
        <Button variant="outline" onClick={() => setShowConfig((current) => !current)}>Configurar Categorias</Button>
        <Label className="inline-flex h-10 cursor-pointer items-center rounded-md border px-3 text-sm font-medium"><FileUp className="mr-2 h-4 w-4" />Importar Previsto<Input className="hidden" type="file" accept=".csv,.txt,.xlsx" onChange={(event) => importPlanned(event.target.files?.[0])} /></Label>
        <Button variant="outline" onClick={() => {
          const rows = [...revenueTransactions, ...filteredTransactions]
          setDetail({ title: "Lancamentos filtrados", rows, amount: rows.reduce((sum, item) => sum + signedAmount(item, "Realizado"), 0) })
        }}>Ver Lancamentos</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SelectField label="Ano" value={filters.year} onChange={(value) => updateFilter("year", value)} options={Array.from({ length: 7 }, (_, index) => String(Number(currentYear) - 2 + index)).map((year) => ({ value: year, label: year }))} />
        <SelectField label="Mes" value={filters.month} onChange={(value) => updateFilter("month", value)} options={[{ value: "todos", label: "Todos" }, ...months.map((month, index) => ({ value: String(index + 1).padStart(2, "0"), label: month }))]} />
        <SelectField label="Centro de custo" value={filters.costCenterId} onChange={(value) => updateFilter("costCenterId", value)} options={[{ value: "todos", label: "Todos" }, ...costCenters.map((item) => ({ value: item.id, label: item.name || "Sem nome" }))]} />
        <SelectField label="Cliente" value={filters.clientId} onChange={(value) => updateFilter("clientId", value)} options={[{ value: "todos", label: "Todos" }, ...clients.map((item) => ({ value: item.id, label: item.name || "Sem nome" }))]} />
        <SelectField label="Categoria" value={filters.categoryId} onChange={(value) => updateFilter("categoryId", value)} options={[{ value: "todos", label: "Todas" }, ...categories.map((item) => ({ value: item.id, label: item.name || "Sem nome" }))]} />
        <SelectField label="Subcategoria" value={filters.subcategoryId} onChange={(value) => updateFilter("subcategoryId", value)} options={[{ value: "todos", label: "Todas" }, ...subcategories.map((item) => ({ value: item.id, label: item.name || "Sem nome" }))]} />
        <SelectField label="Origem" value={filters.origin} onChange={(value) => updateFilter("origin", value)} options={[{ value: "todos", label: "Todas" }, ...Array.from(new Set(safeTransactions.map((item) => item.origin).filter(Boolean))).map((origin) => ({ value: origin, label: origin }))]} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Receitas realizadas</p><strong>{money(revenueRealizedTotal)}</strong></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Saidas realizadas</p><strong>{money(dreRealizedTotal)}</strong></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Resultado realizado</p><strong>{money(revenueRealizedTotal - dreRealizedTotal)}</strong></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">Total de saidas na mesma base</p><strong>{money(transactionRealizedTotal)}</strong></div>
      </div>
    </SectionCard>
    {showConfig ? <SectionCard title="Categorias gerenciais da DRE" description="A DRE usa estas linhas reais da fatura/cartao e agrupa repeticoes automaticamente.">
      <DataTable headers={["Conta gerencial", "Origem", "Status"]}>{suggestedAccounts.map((account) => <TableRow key={account}><TableCell>{account}</TableCell><TableCell>Classificacao da fatura/cartao</TableCell><TableCell><StatusBadge status="Ativo" /></TableCell></TableRow>)}</DataTable>
    </SectionCard> : null}
    <div className="sticky top-2 z-40 flex max-w-full gap-1 overflow-x-auto rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur">
      {([
        ["resumo", "Resumo mensal"],
        ["receitas", "Receitas"],
        ["despesas", "Despesas"],
      ] as Array<[DreView, string]>).map(([value, label]) => (
        <Button key={value} type="button" size="sm" variant={dreView === value ? "default" : "ghost"} className="shrink-0" onClick={() => setDreView(value)}>{label}</Button>
      ))}
    </div>
    {dreView === "receitas" ? <SpreadsheetTable title="Receitas" firstColumn="Conta Gerencial" groups={revenueGroups.length ? revenueGroups : [createGroup("sem-receita", "Sem receitas realizadas")]} /> : null}
    {dreView === "despesas" ? <SpreadsheetTable title="Despesas / Saidas" firstColumn="Conta Gerencial" groups={accountGroups.length ? accountGroups : [createGroup("sem-saida", "Sem saidas realizadas")]} /> : null}
    {dreView === "resumo" ? <SectionCard title="Variacao Despesas x Receita" description="Comparativo mensal entre receitas realizadas e despesas realizadas na base filtrada.">
      <div className="overflow-auto rounded-xl border bg-background">
        <table className="min-w-[1500px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Base</th>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Tipo</th>
              {months.map((month) => <th key={`vr-head-${month}`} className="border-b bg-slate-100 px-3 py-3 text-right">{month}</th>)}
              <th className="border-b bg-slate-100 px-3 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Realizado</td>
              <td className="border-b px-3 py-3 font-semibold">Receita</td>
              {monthlyRevenueRealized.map((value, index) => <td key={`vr-receita-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(revenueRealizedTotal)}</td>
            </tr>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Realizado</td>
              <td className="border-b px-3 py-3 font-semibold">Despesa</td>
              {monthlyExpenseRealized.map((value, index) => <td key={`vr-despesa-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(dreRealizedTotal)}</td>
            </tr>
            <tr className="bg-emerald-100">
              <td className="px-3 py-3 font-semibold">Variacao Despesas x Receita</td>
              <td className="px-3 py-3" />
              {months.map((month, index) => <td key={`vr-var-${month}`} className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(monthlyRevenueRealized[index], monthlyExpenseRealized[index])}</td>)}
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(revenueRealizedTotal, dreRealizedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard> : null}
    {dreView === "resumo" ? <SectionCard title="Variacao Despesas x Receita Prevista" description="Comparativo mensal entre receitas previstas e despesas previstas na base filtrada.">
      <div className="overflow-auto rounded-xl border bg-background">
        <table className="min-w-[1500px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Base</th>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Tipo</th>
              {months.map((month) => <th key={`vp-head-${month}`} className="border-b bg-slate-100 px-3 py-3 text-right">{month}</th>)}
              <th className="border-b bg-slate-100 px-3 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Previsto</td>
              <td className="border-b px-3 py-3 font-semibold">Receita</td>
              {monthlyRevenuePlanned.map((value, index) => <td key={`vp-receita-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(revenuePlannedTotal)}</td>
            </tr>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Previsto</td>
              <td className="border-b px-3 py-3 font-semibold">Despesa</td>
              {monthlyExpensePlanned.map((value, index) => <td key={`vp-despesa-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(drePlannedTotal)}</td>
            </tr>
            <tr className="bg-emerald-100">
              <td className="px-3 py-3 font-semibold">Variacao Despesas x Receita</td>
              <td className="px-3 py-3" />
              {months.map((month, index) => <td key={`vp-var-${month}`} className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(monthlyRevenuePlanned[index], monthlyExpensePlanned[index])}</td>)}
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(revenuePlannedTotal, drePlannedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard> : null}
    {dreView === "resumo" ? <SectionCard title="Variacao Total Despesas x Receita Realizada" description="Comparativo mensal entre receitas realizadas e despesas realizadas na base filtrada.">
      <div className="overflow-auto rounded-xl border bg-background">
        <table className="min-w-[1500px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Base</th>
              <th className="border-b bg-slate-100 px-3 py-3 text-left">Tipo</th>
              {months.map((month) => <th key={`vt-head-${month}`} className="border-b bg-slate-100 px-3 py-3 text-right">{month}</th>)}
              <th className="border-b bg-slate-100 px-3 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Previsto</td>
              <td className="border-b px-3 py-3 font-semibold">Receita</td>
              {monthlyRevenuePlanned.map((value, index) => <td key={`vt-prev-receita-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(revenuePlannedTotal)}</td>
            </tr>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Previsto</td>
              <td className="border-b px-3 py-3 font-semibold">Despesa</td>
              {monthlyExpensePlanned.map((value, index) => <td key={`vt-prev-despesa-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(drePlannedTotal)}</td>
            </tr>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Realizado</td>
              <td className="border-b px-3 py-3 font-semibold">Receita</td>
              {monthlyRevenueRealized.map((value, index) => <td key={`vt-real-receita-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(revenueRealizedTotal)}</td>
            </tr>
            <tr>
              <td className="border-b px-3 py-3 font-semibold">Realizado</td>
              <td className="border-b px-3 py-3 font-semibold">Despesa</td>
              {monthlyExpenseRealized.map((value, index) => <td key={`vt-real-despesa-${index}`} className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(value)}</td>)}
              <td className="border-b px-3 py-3 text-right font-semibold tabular-nums">{money(dreRealizedTotal)}</td>
            </tr>
            <tr className="bg-emerald-100">
              <td className="px-3 py-3 font-semibold">Variacao Total Despesas x Receita Realizada</td>
              <td className="px-3 py-3" />
              {months.map((month, index) => <td key={`vt-var-${month}`} className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(monthlyRevenueRealized[index], monthlyExpenseRealized[index])}</td>)}
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{expenseRevenueVariationText(revenueRealizedTotal, dreRealizedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard> : null}
    <FormSheet open={Boolean(detail)} onOpenChange={(open) => {
      if (!open) {
        setEditing(null)
        setDetail(null)
      }
    }} title={editing ? "Editar lancamento" : detail?.title || "Lancamentos"} description={editing ? "Altere os dados do lancamento selecionado ou exclua do banco de dados." : `Total da celula: ${money(detail?.amount || 0)}`}>
      {editing ? (
        <div className="space-y-4">
          {!isAdmin ? <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-900">{editRestrictionMessage}</div> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="Tipo" value={editing.type} onChange={(value) => setEditing({ ...editing, type: value as "Entrada" | "Saida", categoryId: "", subcategoryId: "" })} options={[{ value: "Entrada", label: "Receita / Entrada" }, { value: "Saida", label: "Despesa / Saida" }]} />
            <SelectField
              label="Previsto ou Realizado"
              value={editing.status}
              onChange={(value) => setEditing({ ...editing, status: isAdmin ? value as "Previsto" | "Realizado" : "Previsto" })}
              options={isAdmin ? [{ value: "Previsto", label: "Previsto" }, { value: "Realizado", label: "Realizado" }] : [{ value: "Previsto", label: "Previsto" }]}
            />
            <TextField label="Descricao" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} />
            <SelectField
              label="Categoria / Subcategoria"
              value={editing.categoryId ? `${editing.categoryId}::${editing.subcategoryId || "nenhuma"}` : "nenhuma"}
              onChange={(value) => {
                const [categoryId, subcategoryId] = value.split("::")
                setEditing({ ...editing, categoryId: categoryId === "nenhuma" ? "" : categoryId, subcategoryId: subcategoryId === "nenhuma" ? "" : subcategoryId })
              }}
              options={[{ value: "nenhuma", label: "Selecione a categoria" }, ...categorySubcategoryEditOptions(editing.type)]}
            />
            <SelectField label="Centro de custo" value={editing.costCenterId || "nenhum"} onChange={(value) => setEditing({ ...editing, costCenterId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem centro" }, ...costCenters.map((item) => ({ value: item.id, label: item.name }))]} />
            <SelectField label="Mes" value={editing.month} onChange={(value) => setEditing({ ...editing, month: value })} options={dreMonthOptions} />
            <TextField label="Ano" value={editing.year} onChange={(value) => setEditing({ ...editing, year: value })} />
            <TextField label="Valor" value={editing.amount} onChange={(value) => setEditing({ ...editing, amount: value })} />
            <div className="md:col-span-2">
              <TextAreaField label="Observacoes" value={editing.notes} onChange={(value) => setEditing({ ...editing, notes: value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SaveButton onClick={saveEditedTransaction}>Salvar alteracoes</SaveButton>
            <Button variant="destructive" onClick={deleteEditedTransaction}>Excluir lancamento</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>Voltar para lista</Button>
          </div>
        </div>
      ) : (
        <DataTable headers={["Data", "Descricao", "Origem", "Categoria", "Subcategoria", "Valor", "Cliente", "OS", "Cartao", "Acoes"]} empty={!detail?.rows.length}>{detail?.rows.map((item) => {
          const editable = canEditTransaction(item)
          return <TableRow key={item.id}><TableCell>{formatDate(transactionDate(item, isRealized(item) ? "Realizado" : "Previsto"))}</TableCell><TableCell>{item.description}</TableCell><TableCell>{item.origin}</TableCell><TableCell>{categoryName(state, resolvedCategoryFor(item))}</TableCell><TableCell>{subcategoryName(state, resolvedSubcategoryFor(item))}</TableCell><TableCell>{money(isRealized(item) ? signedAmount(item, "Realizado") : signedAmount(item, "Previsto"))}</TableCell><TableCell>{opNames.client(item.clientId)}</TableCell><TableCell>{serviceOrderById.get(item.serviceOrderId)?.orderNumber || "-"}</TableCell><TableCell>{creditCards.find((card) => card.id === item.creditCardId)?.name || "-"}</TableCell><TableCell><Button size="sm" variant="outline" disabled={!editable} title={editable ? "Editar lancamento" : editRestrictionMessage} onClick={() => openTransactionEditor(item)}>Editar</Button></TableCell></TableRow>
        })}</DataTable>
      )}
    </FormSheet>
  </div>
}

function CreditCardTab({ state, commit, openCard }: { state: FinancialState; commit: (updater: (current: FinancialState) => FinancialState) => void; openCard: () => void }) {
  return <div className="space-y-4"><SectionCard title="Cartoes"><Button className="mb-3" onClick={openCard}><Plus className="h-4 w-4" />Novo Cartao</Button><DataTable headers={["Nome", "Banco", "Final", "Titular", "Vencimento", "Limite", "Status"]}>{state.creditCards.map((card) => <TableRow key={card.id}><TableCell>{card.name}</TableCell><TableCell>{card.bankName}</TableCell><TableCell>{card.cardLastDigits}</TableCell><TableCell>{card.holderName}</TableCell><TableCell>Dia {card.dueDay}</TableCell><TableCell>{money(card.creditLimit)}</TableCell><TableCell><StatusBadge status={card.status} /></TableCell></TableRow>)}</DataTable></SectionCard><SectionCard title="Faturas"><DataTable headers={["Mes", "Ano", "Vencimento", "Cartao", "Titular", "Total", "Importado", "Diferenca", "Status", "Acoes"]} empty={!state.creditCardInvoices.length}>{state.creditCardInvoices.map((invoice) => <TableRow key={invoice.id}><TableCell>{invoice.referenceMonth}</TableCell><TableCell>{invoice.referenceYear}</TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell>{state.creditCards.find((card) => card.id === invoice.creditCardId)?.name}</TableCell><TableCell>{invoice.holderName}</TableCell><TableCell>{money(invoice.totalAmount)}</TableCell><TableCell>{money(invoice.importedAmount)}</TableCell><TableCell>{money(invoice.differenceAmount)}</TableCell><TableCell><StatusBadge status={invoice.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => commit((current) => ({ ...current, creditCardInvoices: current.creditCardInvoices.map((item) => item.id === invoice.id ? { ...item, status: "Paga" } : item) }))}>Marcar paga</Button></TableCell></TableRow>)}</DataTable></SectionCard><SectionCard title="Lancamentos do cartao"><DataTable headers={["Data", "Descricao original", "Parcela", "Cidade", "Portador", "Final", "Valor", "Categoria", "Status categoria", "Conferencia"]} empty={!state.creditCardInvoiceItems.length}>{state.creditCardInvoiceItems.map((item) => <TableRow key={item.id}><TableCell>{formatDate(item.purchaseDate)}</TableCell><TableCell>{item.originalDescription}</TableCell><TableCell>{item.currentInstallment}/{item.totalInstallments}</TableCell><TableCell>{item.city}</TableCell><TableCell>{item.cardHolder}</TableCell><TableCell>{item.cardLastDigits}</TableCell><TableCell>{money(item.amount)}</TableCell><TableCell>{categoryName(state, item.categoryId)}</TableCell><TableCell>{item.categoryStatus}</TableCell><TableCell>{item.reviewStatus}</TableCell></TableRow>)}</DataTable></SectionCard></div>
}

async function processInvoiceOnServer(file: File | null | undefined, state: FinancialState, cardId: string, rawText = "") {
  const form = new FormData()
  const defaults = defaultFinancialState()
  const parserState = {
    ...defaults,
    categories: state.categories?.length ? state.categories : defaults.categories,
    subcategories: state.subcategories?.length ? state.subcategories : defaults.subcategories,
    costCenters: state.costCenters?.length ? state.costCenters : defaults.costCenters,
    dreAccounts: state.dreAccounts?.length ? state.dreAccounts : defaults.dreAccounts,
    creditCards: state.creditCards?.length ? state.creditCards : defaults.creditCards,
    categoryRules: state.categoryRules?.length ? state.categoryRules : defaults.categoryRules,
    transactions: [],
    accountsPayable: [],
    accountsReceivable: [],
    creditCardInvoices: [],
    creditCardInvoiceItems: [],
  } satisfies FinancialState
  if (file) form.append("file", file)
  form.append("cardId", cardId)
  form.append("rawText", rawText)
  form.append("state", JSON.stringify(parserState))
  form.append("fallback", JSON.stringify({
    referenceMonth: String(new Date().getMonth() + 1),
    referenceYear: String(new Date().getFullYear()),
    dueDate: financeToday(),
    holderName: state.creditCards.find((item) => item.id === cardId)?.holderName || "",
  }))
  const response = await fetch("/api/financeiro/parse-invoice", { method: "POST", body: form })
  const rawResponse = await response.text()
  let payload: any = null
  try {
    payload = rawResponse ? JSON.parse(rawResponse) : null
  } catch {
    const preview = rawResponse.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
    throw new Error(`A API retornou resposta invalida (${response.status}). ${preview || "Sem detalhes."}`)
  }
  if (!response.ok) throw new Error(payload.error || "Falha ao processar PDF.")
  return payload
}

type BankStatementPreview = Omit<BankStatementResult, "items"> & {
  fileName: string
  pages: number
  items: Array<BankStatementItem & { selected: boolean }>
}

function BankStatementImport({ state, save }: { state: FinancialState; save: (next: FinancialState) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BankStatementPreview | null>(null)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)

  const totals = useMemo(() => {
    const selected = preview?.items.filter((item) => item.selected) || []
    return {
      entries: selected.filter((item) => item.type === "Entrada").reduce((sum, item) => sum + item.amount, 0),
      outputs: selected.filter((item) => item.type === "Saida").reduce((sum, item) => sum + item.amount, 0),
      count: selected.length,
    }
  }, [preview])

  const processStatement = async () => {
    if (!file) {
      setStatus("Selecione um extrato em PDF.")
      return
    }
    setBusy(true)
    setStatus("Lendo e conferindo o extrato...")
    try {
      const form = new FormData()
      form.append("file", file)
      const response = await fetch("/api/financeiro/parse-statement", { method: "POST", body: form })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Falha ao processar o extrato.")
      const parsed = payload as BankStatementResult & { pages: number; fileName: string }
      setPreview({ ...parsed, items: parsed.items.map((item) => ({ ...item, selected: true })) })
      setStatus(`${parsed.items.length} movimentacoes encontradas em ${parsed.pages} pagina(s). Confira antes de salvar.`)
    } catch (error) {
      setPreview(null)
      setStatus(error instanceof Error ? error.message : "Falha ao processar o extrato.")
    } finally {
      setBusy(false)
    }
  }

  const toggleAll = (selected: boolean) => {
    setPreview((current) => current ? { ...current, items: current.items.map((item) => ({ ...item, selected })) } : current)
  }

  const toggleItem = (sourceKey: string, selected: boolean) => {
    setPreview((current) => current ? {
      ...current,
      items: current.items.map((item) => item.sourceKey === sourceKey ? { ...item, selected } : item),
    } : current)
  }

  const confirmStatement = async () => {
    if (!preview || !totals.count) return
    setBusy(true)
    setStatus("Salvando movimentacoes em Entradas e Saidas...")
    try {
      const existingKeys = new Set(state.transactions.flatMap((item) => {
        const match = item.notes?.match(/Chave do extrato:\s*([^\s]+)/i)
        return match?.[1] ? [match[1]] : []
      }))
      const now = financeNow()
      const selected = preview.items.filter((item) => item.selected)
      const fresh = selected.filter((item) => !existingKeys.has(item.sourceKey))
      const transactions: FinancialTransaction[] = fresh.map((item) => {
        const category = categorizeTransaction(state, item.description)
        return {
          id: financeId("ft"),
          type: item.type,
          description: item.description,
          categoryId: category?.categoryId || "",
          subcategoryId: category?.subcategoryId || "",
          costCenterId: category?.costCenterId || "",
          dreAccountId: category?.dreAccountId || "",
          clientId: "",
          serviceOrderId: "",
          providerId: "",
          vehicleId: "",
          supplierName: item.type === "Saida" ? item.description : "",
          competenceDate: item.date,
          dueDate: item.date,
          realizedDate: item.date,
          expectedAmount: 0,
          realizedAmount: item.amount,
          paymentMethod: "Movimentacao bancaria",
          bankAccountId: "",
          creditCardId: "",
          creditCardInvoiceId: "",
          status: "Realizado",
          origin: "Extrato bancario",
          notes: `Chave do extrato: ${item.sourceKey}\nBanco: ${preview.bank}\nConta: ${preview.accountNumber}\nTitular: ${preview.accountName}\nLinha original: ${item.rawLine}`,
          attachmentName: preview.fileName,
          createdAt: now,
          updatedAt: now,
        }
      })
      if (transactions.length) await save({ ...state, transactions: [...transactions, ...state.transactions] })
      const skipped = selected.length - transactions.length
      setPreview(null)
      setFile(null)
      setStatus(`${transactions.length} lancamento(s) salvo(s) em Entradas e Saidas.${skipped ? ` ${skipped} duplicado(s) ignorado(s).` : ""}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erro ao salvar o extrato no Supabase.")
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="rounded-md border bg-background p-4">
      <h3 className="mb-3 text-base font-semibold">Extrato bancario</h3>
      <div className="space-y-3">
        <div className="space-y-2"><Label>Extrato Sicoob ou Ailos em PDF</Label><Input type="file" accept=".pdf,application/pdf" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null) }} /></div>
        <p className="text-sm text-muted-foreground">Importa creditos e debitos realizados em Entradas e Saidas, sem duplicar um extrato reenviado.</p>
        <Button className="w-full" variant="outline" disabled={busy || !file} onClick={processStatement}><Landmark className="h-4 w-4" />{busy ? "Processando..." : "Processar extrato"}</Button>
      </div>
    </div>
    {status ? <div className="xl:col-span-2 rounded-md border border-primary/20 bg-primary/10 p-3 text-sm text-primary">{status}</div> : null}
    {preview ? <div className="xl:col-span-2 space-y-4 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Banco e conta</p><strong>{preview.bank} {preview.accountNumber || ""}</strong><p className="text-xs text-muted-foreground">{preview.accountName || "Titular nao identificado"}</p></div>
        <div><p className="text-xs text-muted-foreground">Periodo</p><strong>{formatDate(preview.periodStart)} a {formatDate(preview.periodEnd)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Entradas selecionadas</p><strong className="text-emerald-700">{money(totals.entries)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Saidas selecionadas</p><strong className="text-red-700">{money(totals.outputs)}</strong></div>
      </div>
      {preview.ignoredCount ? <p className="text-sm text-muted-foreground">{preview.ignoredCount} linha(s) de saldo ou aplicacao/resgate automatico foram ignoradas.</p> : null}
      {preview.warnings?.length ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800">{preview.warnings.join(" ")}</div> : null}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => toggleAll(true)}>Selecionar tudo</Button><Button size="sm" variant="outline" onClick={() => toggleAll(false)}>Limpar selecao</Button></div>
      <DataTable headers={["Importar", "Data", "Tipo", "Descricao", "Valor"]} empty={!preview.items.length} stickyHeader viewportClassName={financeTableViewport} tableClassName={`min-w-[900px] ${financeTableRows}`}>
        {preview.items.map((item) => <TableRow key={item.sourceKey}><TableCell><Checkbox checked={item.selected} onCheckedChange={(checked) => toggleItem(item.sourceKey, Boolean(checked))} /></TableCell><TableCell>{formatDate(item.date)}</TableCell><TableCell><StatusBadge status={item.type} /></TableCell><TableCell>{item.description}</TableCell><TableCell>{money(item.amount)}</TableCell></TableRow>)}
      </DataTable>
      <Button disabled={busy || !totals.count} onClick={confirmStatement}>{busy ? "Salvando..." : `Salvar ${totals.count} lancamento(s)`}</Button>
    </div> : null}
  </>
}

function ImportInvoiceTab({
  state,
  commit,
  save,
  preview,
  setPreview,
  processInvoice,
  confirmInvoice,
  ocrStatus,
}: {
  state: FinancialState
  commit: (updater: (current: FinancialState) => FinancialState) => void
  save: (next: FinancialState) => Promise<void>
  preview: any
  setPreview: (preview: any) => void
  processInvoice: (file?: File | null, cardId?: string, rawText?: string) => void
  confirmInvoice: (createPayable?: boolean) => void
  ocrStatus: string
}) {
  const [cardId, setCardId] = useState(state.creditCards[0]?.id || "")
  const [file, setFile] = useState<File | null>(null)
  const [payableFile, setPayableFile] = useState<File | null>(null)
  const [receivableFile, setReceivableFile] = useState<File | null>(null)
  const [rawText, setRawText] = useState("")
  const [importStatus, setImportStatus] = useState("")
  const setAll = (selected: boolean) => {
    if (!preview) return
    setPreview({ ...preview, items: preview.items.map((item: CreditCardInvoiceItem) => ({ ...item, reviewStatus: selected ? (item.categoryConfidence === "Alta" ? "Conferido" : "Pendente") : "Ignorado" })) })
  }
  const toggleItem = (id: string, selected: boolean) => {
    if (!preview) return
    setPreview({ ...preview, items: preview.items.map((item: CreditCardInvoiceItem) => item.id === id ? { ...item, reviewStatus: selected ? (item.categoryConfidence === "Alta" ? "Conferido" : "Pendente") : "Ignorado" } : item) })
  }
  const importAccounts = async (kind: FinancialSpreadsheetKind) => {
    const selected = kind === "payable" ? payableFile : receivableFile
    if (!selected) {
      alert(`Selecione o Excel de ${kind === "payable" ? "contas a pagar" : "contas a receber"}.`)
      return
    }
    try {
      setImportStatus(`Importando ${selected.name}...`)
      const result = await importAccountsSpreadsheet(selected, kind, state)
      commit(() => result.state)
      setImportStatus(`${result.imported} registros importados e refletidos em Entradas e Saidas/DRE. ${result.skipped} ignorados ou duplicados.`)
    } catch (error) {
      setImportStatus("")
      alert(error instanceof Error ? error.message : "Erro ao importar planilha.")
    }
  }

  return <SectionCard title="Importacoes financeiras" description="Importe extratos bancarios, fatura do cartao, contas a pagar e contas a receber. Os registros alimentam Entradas e Saidas e a DRE.">
    <div className="grid gap-4 xl:grid-cols-2">
      <BankStatementImport state={state} save={save} />
      <div className="rounded-xl border bg-background p-4">
        <h3 className="mb-3 text-base font-semibold">Fatura do cartao</h3>
        <div className="space-y-3">
          <SelectField label="Cartao vinculado" value={cardId || "nenhum"} onChange={(value) => setCardId(value === "nenhum" ? "" : value)} options={[{ value: "nenhum", label: "Selecione" }, ...state.creditCards.map((card) => ({ value: card.id, label: card.name }))]} />
          <div className="space-y-2"><Label>Arquivo PDF da fatura</Label><Input type="file" accept=".pdf,.txt,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></div>
          <Button className="w-full" variant="outline" onClick={() => processInvoice(file, cardId, rawText)}>Processar fatura</Button>
        </div>
      </div>
      <div className="rounded-xl border bg-background p-4">
        <h3 className="mb-3 text-base font-semibold">Contas a pagar</h3>
        <div className="space-y-3">
          <div className="space-y-2"><Label>Excel de contas a pagar</Label><Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setPayableFile(event.target.files?.[0] || null)} /></div>
          <p className="text-sm text-muted-foreground">Cria registros em Contas a Pagar e lancamentos de Saida.</p>
          <Button className="w-full" variant="outline" onClick={() => importAccounts("payable")}>Importar contas a pagar</Button>
        </div>
      </div>
      <div className="rounded-xl border bg-background p-4">
        <h3 className="mb-3 text-base font-semibold">Contas a receber</h3>
        <div className="space-y-3">
          <div className="space-y-2"><Label>Excel de contas a receber</Label><Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setReceivableFile(event.target.files?.[0] || null)} /></div>
          <p className="text-sm text-muted-foreground">Cria registros em Contas a Receber e lancamentos de Entrada.</p>
          <Button className="w-full" variant="outline" onClick={() => importAccounts("receivable")}>Importar contas a receber</Button>
        </div>
      </div>
    </div>
    {ocrStatus ? <div className="mt-3 rounded-md border border-primary/20 bg-primary/10 p-3 text-sm text-primary">{ocrStatus}</div> : null}
    {importStatus ? <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800">{importStatus}</div> : null}
    <div className="mt-4 space-y-2"><Label>Texto de apoio, se o PDF for imagem ou vier sem texto selecionavel</Label><textarea className="min-h-36 w-full rounded-md border bg-background p-3 text-sm" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={"Opcional. Cole aqui linhas como:\nMERCADOLIVRE*19PRODU 10/10 Osasco R$ 80,79 Insumos - Finca pino\n18/07 MERCADOPAGO *MASXGEN 07/10 SAO PAU 54,40"} /></div>
    {preview ? <div className="mt-6 space-y-4"><div className="rounded-md border p-3 text-sm">Fatura: {preview.invoice.referenceMonth}/{preview.invoice.referenceYear} | Vencimento: {formatDate(preview.invoice.dueDate)} | Total: {money(preview.invoice.totalAmount)} | Itens selecionados: {preview.items.filter((item: CreditCardInvoiceItem) => item.reviewStatus !== "Ignorado").length}/{preview.items.length}. Ao confirmar, cada linha selecionada vira um lancamento de Saida vinculado a esta fatura/cartao.</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setAll(true)}>Selecionar tudo</Button><Button size="sm" variant="outline" onClick={() => setAll(false)}>Limpar selecao</Button></div>{preview.warnings?.length ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800">{preview.warnings.join(" ")}</div> : null}<DataTable headers={["Selecionar", "Data", "Descricao original", "Parcela", "Cidade", "Valor", "Portador", "Final", "Categoria sugerida", "Subcategoria", "Regra", "Confianca", "Status"]} stickyHeader viewportClassName={financeTableViewport} tableClassName={`min-w-[1780px] ${financeTableRows}`}>{preview.items.map((item: CreditCardInvoiceItem) => <TableRow key={item.id}><TableCell><Checkbox checked={item.reviewStatus !== "Ignorado"} onCheckedChange={(checked) => toggleItem(item.id, Boolean(checked))} /></TableCell><TableCell>{formatDate(item.purchaseDate)}</TableCell><TableCell>{item.originalDescription}</TableCell><TableCell>{String(item.currentInstallment).padStart(2, "0")}/{String(item.totalInstallments).padStart(2, "0")}</TableCell><TableCell>{item.city}</TableCell><TableCell>{money(item.amount)}</TableCell><TableCell>{item.cardHolder}</TableCell><TableCell>{item.cardLastDigits}</TableCell><TableCell>{categoryName(state, item.categoryId)}</TableCell><TableCell>{subcategoryName(state, item.subcategoryId)}</TableCell><TableCell>{state.categoryRules.find((rule) => rule.id === item.categoryRuleId)?.name || "-"}</TableCell><TableCell>{item.categoryConfidence}</TableCell><TableCell>{item.reviewStatus}</TableCell></TableRow>)}</DataTable><div className="flex gap-2"><Button onClick={() => confirmInvoice(false)}>Confirmar importacao</Button><Button onClick={() => confirmInvoice(true)}>Confirmar e criar conta a pagar</Button><Button variant="outline" onClick={() => alert("Previa em Excel simulada no MVP local.")}>Baixar previa em Excel</Button></div></div> : null}
  </SectionCard>
}

function RulesTab({ state, openRule, processRules, rulePreview, setRulePreview, confirmRulePreview }: { state: FinancialState; openRule: () => void; processRules: (file?: File | null) => void; rulePreview: any[]; setRulePreview: (items: any[]) => void; confirmRulePreview: () => void }) {
  return <div className="space-y-4"><SectionCard title="Regras de Categoria"><div className="mb-3 flex flex-wrap gap-2"><Button onClick={openRule}><Plus className="h-4 w-4" />Nova Regra</Button><Label className="inline-flex h-10 cursor-pointer items-center rounded-md border px-3 text-sm"><FileUp className="mr-2 h-4 w-4" />Importar Regras do Excel<Input className="hidden" type="file" accept=".csv,.txt,.xlsx" onChange={(event) => processRules(event.target.files?.[0])} /></Label><Button variant="outline" onClick={() => alert("Exportacao de regras simulada no MVP local.")}>Exportar Regras</Button></div><DataTable headers={["Prioridade", "Texto de busca", "Comparacao", "Categoria", "Subcategoria", "Centro", "Conta DRE", "Confianca", "Ativo"]}>{state.categoryRules.map((rule) => <TableRow key={rule.id}><TableCell>{rule.priority}</TableCell><TableCell>{rule.searchText}</TableCell><TableCell>{rule.comparisonType}</TableCell><TableCell>{categoryName(state, rule.categoryId)}</TableCell><TableCell>{subcategoryName(state, rule.subcategoryId)}</TableCell><TableCell>{costCenterName(state, rule.costCenterId)}</TableCell><TableCell>{dreName(state, rule.dreAccountId)}</TableCell><TableCell>{rule.defaultConfidence}</TableCell><TableCell>{rule.active ? "Sim" : "Nao"}</TableCell></TableRow>)}</DataTable></SectionCard>{rulePreview.length ? <SectionCard title="Previa das regras importadas"><DataTable headers={["Descricao original", "Texto sugerido", "Categoria", "Subcategoria", "Confianca", "Acao"]}>{rulePreview.map((item) => <TableRow key={item.id}><TableCell>{item.originalDescription}</TableCell><TableCell>{item.searchText}</TableCell><TableCell>{item.category}</TableCell><TableCell>{item.subcategory}</TableCell><TableCell>{item.confidence}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setRulePreview(rulePreview.map((row) => row.id === item.id ? { ...row, ignored: !row.ignored } : row))}>{item.ignored ? "Confirmar" : "Ignorar"}</Button></TableCell></TableRow>)}</DataTable><Button className="mt-3" onClick={confirmRulePreview}>Confirmar regras</Button></SectionCard> : null}</div>
}
