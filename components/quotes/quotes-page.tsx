"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, FileText, Plus, RefreshCw, Trash2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { emitSalesOrderPdf } from "@/lib/sales-pdf-client"
import { ConfiguratorDialog } from "@/components/configurator/configurator-dialog"
import { configStatusLabel, configStatusTone } from "@/lib/configurator"
import { resolveTablePrice } from "@/lib/config"
import { buildInstallments, quoteTotals, quoteTypes, shareMessage } from "@/lib/quotes"
import { buildQuotePdf } from "@/lib/quote-pdf"

type Row = Record<string, any>
type Options = {
  clients: Array<{ id: string; name: string; document: string; status: string; phone: string; email: string }>
  salespeople: Array<{ id: string; name: string }>
  paymentConditions: Array<{ id: string; name: string; installments: number; firstDueDays: number; intervalDays: number }>
  products: Array<{ id: string; name: string; code: string; unit: string; price: number; cost: number; stock: number; reserved: number; controlsStock: boolean; bomVersion?: number | null; leadTimeDays?: number | null; marginPercent?: number | null; hasEngineering?: boolean; photoUrl?: string | null }>
  services: Array<{ id: string; name: string; code: string; unit: string; price: number; cost: number; warrantyDays: number }>
  warehouses: Array<{ id: string; name: string; isDefault: boolean }>
  opportunities: Array<{ id: string; code: string; title: string; clientId: string; salespersonId: string; interest: string; estimatedValue: number; stage: string }>
  company: { id: string; name: string; legalName: string; cnpj: string; email: string; phone: string; address: string; hasLogo: boolean }
  templates: Array<{ id: string; name: string; quoteType: string; validityDays: number; paymentConditionId: string; deliveryText: string; warrantyDays: number; notes: string }>
  priceTables: Array<{ id: string; name: string; clientId: string; validFrom: string; validUntil: string; active: boolean; items: Array<{ materialId: string; serviceTypeId: string; price: number }> }>
  settings: { defaultValidityDays: number; discountApprovalPercent: number }
  emailConfigured: boolean
  canConfigure: boolean
}
type Line = { key: string; id?: string; lineType: "Produto" | "Serviço"; catalogId: string; description: string; unit: string; quantity: string; unitPrice: string; discountPercent: string; notes: string; catalogPrice: number; unitCost: number; configurationId?: string; configStatus?: string; configSummary?: string; configParams?: Record<string, number> }
type Detail = { quote: Row; items: Row[]; events: Row[]; attachments: Row[]; versions: Row[]; orders: Row[]; receivables: Row[] }
type Action = null | { kind: "approve" | "refuse" | "cancel" | "formalize" | "email" | "whatsapp"; acceptedBy?: string; acceptNotes?: string; reason?: string; warehouseId?: string; baseDate?: string; to?: string; message?: string; phone?: string }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const num = (value: string | number) => Number(String(value ?? "").replace(",", ".")) || 0
const key = () => Math.random().toString(36).slice(2)
const none = "nenhum"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyForm = (): Row => ({ id: "", title: "", clientId: "", salespersonId: "", opportunityId: "", issueDate: today(), validUntil: plusDays(15), quoteType: "Misto", paymentConditionId: "", deliveryText: "", warrantyDays: "0", discountAmount: "0", freightAmount: "0", expensesAmount: "0", taxPercent: "0", notes: "" })

function Opts({ label, value, onChange, items, placeholder = "Selecione", disabled }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string; disabled?: boolean }) {
  return <div className={disabled ? "pointer-events-none opacity-70" : ""}><SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} /></div>
}

export function QuotesPage() {
  const router = useRouter()
  const [configuring, setConfiguring] = useState<Line | null>(null)
  const { toast } = useCrudFeedback()
  const [quotes, setQuotes] = useState<Row[]>([])
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("abertos")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Row>(emptyForm())
  const [lines, setLines] = useState<Line[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [adding, setAdding] = useState<{ kind: "Produto" | "Serviço"; id: string }>({ kind: "Produto", id: "" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, opts] = await Promise.all([api<{ quotes: Row[] }>("/api/orcamentos"), api<Options>("/api/orcamentos/options")])
      setQuotes(list.quotes)
      setOptions(opts)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar orçamentos.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const status = detail?.quote ? (detail.quote.effectiveStatus as string) : "Rascunho"
  const readOnly = Boolean(detail) && status !== "Rascunho"

  function startNew(prefill: Row = {}) {
    setForm({ ...emptyForm(), validUntil: plusDays(options?.settings.defaultValidityDays || 15), ...prefill })
    setLines([])
    setDetail(null)
    setAction(null)
    setOpen(true)
  }

  // chegada pelo funil: /orcamento?opportunityId=...&clientId=...
  useEffect(() => {
    if (!options) return
    const params = new URLSearchParams(window.location.search)
    const opportunityId = params.get("opportunityId")
    if (!opportunityId) return
    const opportunity = options.opportunities.find((item) => item.id === opportunityId)
    window.history.replaceState(null, "", "/orcamento")
    startNew({ opportunityId, clientId: opportunity?.clientId || params.get("clientId") || "", salespersonId: opportunity?.salespersonId || "", title: opportunity ? `${opportunity.code} · ${opportunity.title}` : "", notes: opportunity ? `Interesse: ${opportunity.interest}` : "" })
  }, [options])

  async function openQuote(id: string) {
    try {
      const data = await api<Detail>(`/api/orcamentos/${id}`)
      hydrate(data)
      setAction(null)
      setOpen(true)
    } catch (reason) {
      toast({ title: "Não foi possível abrir", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  function hydrate(data: Detail) {
    const quote = data.quote
    setDetail(data)
    setForm({
      id: quote.id, title: quote.title, clientId: quote.clientId, salespersonId: quote.salespersonId, opportunityId: quote.opportunityId, issueDate: quote.issueDate, validUntil: quote.validUntil, quoteType: quote.quoteType,
      paymentConditionId: quote.paymentConditionId, deliveryText: quote.deliveryText, warrantyDays: String(quote.warrantyDays), discountAmount: String(quote.discountAmount), freightAmount: String(quote.freightAmount),
      expensesAmount: String(quote.expensesAmount), taxPercent: String(quote.taxPercent), notes: quote.notes,
    })
    setLines(data.items.map((item) => ({ key: item.id, id: item.id, lineType: item.lineType, catalogId: item.catalogId, description: item.description, unit: item.unit, quantity: String(item.quantity), unitPrice: String(item.unitPrice), discountPercent: String(item.discountPercent), notes: item.notes, catalogPrice: item.catalogPrice, unitCost: item.unitCost, configurationId: item.configurationId || undefined, configStatus: item.config?.status, configSummary: item.config?.summary })))
  }

  const catalogNow = (line: Line) => (line.lineType === "Produto" ? options?.products.find((item) => item.id === line.catalogId) : options?.services.find((item) => item.id === line.catalogId))
  const calcLines = lines.map((line) => ({ lineType: line.lineType, quantity: num(line.quantity), unitPrice: num(line.unitPrice), unitCost: line.unitCost, discountPercent: num(line.discountPercent) }))
  const totals = useMemo(() => quoteTotals(calcLines, { discountAmount: num(form.discountAmount), freightAmount: num(form.freightAmount), expensesAmount: num(form.expensesAmount), taxPercent: num(form.taxPercent) }), [lines, form.discountAmount, form.freightAmount, form.expensesAmount, form.taxPercent]) // eslint-disable-line react-hooks/exhaustive-deps
  const conditionRule = options?.paymentConditions.find((item) => item.id === form.paymentConditionId)

  function addLine() {
    if (!options || !adding.id) return
    const source = adding.kind === "Produto" ? options.products.find((item) => item.id === adding.id) : options.services.find((item) => item.id === adding.id)
    if (!source) return
    // tabela de preços vigente do cliente (ou geral) tem prioridade sobre o preço de catálogo
    const table = resolveTablePrice(options.priceTables, form.clientId, adding.kind, source.id)
    setLines((current) => [...current, { key: key(), lineType: adding.kind, catalogId: source.id, description: source.name, unit: source.unit, quantity: "1", unitPrice: String(table ? table.price : source.price), discountPercent: "0", notes: "", catalogPrice: source.price, unitCost: source.cost }])
    if (adding.kind === "Serviço" && "warrantyDays" in source && source.warrantyDays > num(form.warrantyDays)) setForm((current) => ({ ...current, warrantyDays: String(source.warrantyDays) }))
    setAdding({ ...adding, id: "" })
  }

  const patchLine = (lineKey: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)))

  const payload = () => ({
    ...form, lines: lines.map((line) => ({ id: line.id, lineType: line.lineType, catalogId: line.catalogId, description: line.description, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, discountPercent: line.discountPercent, notes: line.notes, configurationId: line.configurationId })),
  })

  async function save(closeAfter = false) {
    setSaving(true)
    try {
      const data = await api<Detail>("/api/orcamentos", { method: "POST", body: JSON.stringify({ quote: payload() }) })
      hydrate(data)
      toast({ title: "Orçamento salvo", description: `${data.quote.number} · ${brl(data.quote.totalAmount)}` })
      await load()
      if (closeAfter) setOpen(false)
      return data
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function convertToOrder() {
    if (!detail) return
    setSaving(true)
    try {
      const data = await api<Detail & { salesOrder: { id: string; number: string; duplicate: boolean } }>(`/api/orcamentos/${detail.quote.id}`, { method: "POST", body: JSON.stringify({ action: "to_order" }) })
      hydrate(data)
      let pdfNote = ""
      if (!data.salesOrder.duplicate) {
        try {
          const pdf = await emitSalesOrderPdf(data.salesOrder.id, { source: "conversao" })
          pdfNote = ` PDF do pedido (versão ${pdf.version}) emitido e guardado.${pdf.warnings.length ? ` Atenção: ${pdf.warnings.join(" ")}` : ""}`
        } catch (failure) {
          pdfNote = ` O PDF não foi emitido (${failure instanceof Error ? failure.message : "erro"}): emita em Vendas > Pedido em PDF.`
        }
      }
      toast({ title: data.salesOrder.duplicate ? "Este orçamento já tinha pedido" : "Pedido de venda criado", description: `${data.salesOrder.number}: abra em Vendas para confirmar.${pdfNote}` })
      await load()
      router.push(`/vendas/${data.salesOrder.id}`)
    } catch (reason) {
      toast({ title: "Conversão não concluída", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function run(body: Row, successTitle: string) {
    if (!detail) return null
    setSaving(true)
    try {
      const data = await api<Detail & { warnings?: string[] }>(`/api/orcamentos/${detail.quote.id}`, { method: "POST", body: JSON.stringify(body) })
      hydrate(data)
      setAction(null)
      toast({ title: successTitle, description: data.warnings?.length ? data.warnings.join(" ") : undefined })
      await load()
      return data
    } catch (reason) {
      toast({ title: "Ação não concluída", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function makePdf() {
    if (!detail || !options) return null
    const client = options.clients.find((item) => item.id === detail.quote.clientId)
    return buildQuotePdf({
      company: options.company,
      quote: detail.quote as any,
      client: { document: client?.document || "", phone: client?.phone || detail.quote.clientPhone || "", email: client?.email || detail.quote.clientEmail || "" },
      items: detail.items as any,
    })
  }

  async function downloadPdf() {
    try {
      const pdf = await makePdf()
      pdf?.doc.save(pdf.fileName)
    } catch (reason) {
      toast({ title: "PDF não gerado", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function sendEmail() {
    if (!detail || action?.kind !== "email") return
    try {
      setSaving(true)
      const pdf = await makePdf()
      if (!pdf) return
      const data = await api<Detail>(`/api/orcamentos/${detail.quote.id}`, { method: "POST", body: JSON.stringify({ action: "email", to: action.to, message: action.message, pdfBase64: pdf.base64 }) })
      hydrate(data)
      setAction(null)
      toast({ title: "Orçamento enviado por e-mail" })
      await load()
    } catch (reason) {
      toast({ title: "E-mail não enviado", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function sendWhatsapp() {
    if (!detail || action?.kind !== "whatsapp") return
    const phone = String(action.phone || "").replace(/\D/g, "")
    if (phone.length < 10) return toast({ title: "Informe o WhatsApp com DDD", variant: "destructive" })
    const pdf = await makePdf().catch(() => null)
    pdf?.doc.save(pdf.fileName)
    window.open(`https://wa.me/${phone.startsWith("55") ? phone : `55${phone}`}?text=${encodeURIComponent(action.message || "")}`, "_blank")
    await run({ action: "status", to: "Enviado", via: "WhatsApp", sentTo: action.phone }, "Registrado como enviado por WhatsApp")
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !detail) return
    try {
      const body = new FormData()
      body.set("file", file)
      body.set("folder", "anexos")
      const stored = await api<{ path: string; name: string }>("/api/orcamentos/file", { method: "POST", body })
      await run({ action: "attach", path: stored.path, name: file.name }, "Anexo adicionado")
    } catch (reason) {
      toast({ title: "Falha no envio", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
    event.target.value = ""
  }

  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const body = new FormData()
      body.set("file", file)
      body.set("folder", "logo")
      await api("/api/orcamentos/file", { method: "POST", body })
      toast({ title: "Logotipo atualizado" })
      await load()
    } catch (reason) {
      toast({ title: "Falha no envio", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
    event.target.value = ""
  }

  // ---------- listagem
  const text = query.trim().toLowerCase()
  const shown = quotes.filter((row) => {
    const current = row.effectiveStatus as string
    if (statusFilter === "abertos") { if (!["Rascunho", "Enviado", "Em negociação", "Aprovado"].includes(current)) return false }
    else if (statusFilter !== "todos" && current !== statusFilter) return false
    return !text || [row.number, row.clientName, row.salespersonName, row.title].some((value) => String(value || "").toLowerCase().includes(text))
  })
  const openQuotes = quotes.filter((row) => ["Rascunho", "Enviado", "Em negociação"].includes(row.effectiveStatus))
  const approved = quotes.filter((row) => row.effectiveStatus === "Aprovado")
  const expiring = openQuotes.filter((row) => row.validUntil <= plusDays(7))
  const monthWon = quotes.filter((row) => row.effectiveStatus === "Convertido" && String(row.convertedAt).slice(0, 7) === today().slice(0, 7)).reduce((sum, row) => sum + row.totalAmount, 0)

  const clientItems = (options?.clients || []).map((item) => ({ value: item.id, label: `${item.name}${item.status === "Prospect" ? " (lead)" : ""}${item.document ? ` · ${item.document}` : ""}` }))
  const client = options?.clients.find((item) => item.id === form.clientId)
  const catalogItems = adding.kind === "Produto"
    ? (options?.products || []).map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name} — ${brl(item.price)}${item.controlsStock ? ` · estoque ${item.stock - item.reserved}` : ""}${item.bomVersion ? ` · custo ${brl(item.cost)} (estrutura v${item.bomVersion}${item.marginPercent === null || item.marginPercent === undefined ? "" : `, margem ${Number(item.marginPercent).toLocaleString("pt-BR")}%`})` : ""}${item.leadTimeDays ? ` · prazo ${item.leadTimeDays} dias` : ""}` }))
    : (options?.services || []).map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name} — ${brl(item.price)}` }))
  const canEmail = Boolean(detail) && ["Rascunho", "Enviado", "Em negociação"].includes(status)
  const needsWarehouse = detail?.items.some((item) => item.lineType === "Produto" && options?.products.find((product) => product.id === item.catalogId)?.controlsStock)
  const parcels = detail && detail.quote.paymentConditionId && conditionRule ? buildInstallments(detail.quote.totalAmount, conditionRule, action?.kind === "formalize" && action.baseDate ? action.baseDate : today()) : []

  return (
    <PageShell
      title="Orçamentos"
      description="Monte, envie, aprove e transforme orçamentos em venda ou ordem de serviço, com preços negociados preservados."
      actions={<><Button onClick={() => startNew()} disabled={!options}><Plus className="h-4 w-4" />Novo orçamento</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Atualizar</Button></>}
    >
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="Em negociação" value={brl(openQuotes.reduce((sum, row) => sum + row.totalAmount, 0))} note={`${openQuotes.length} rascunho(s)/enviado(s)`} icon={FileText} />
        <MetricCard title="Aprovados a formalizar" value={approved.length} note={brl(approved.reduce((sum, row) => sum + row.totalAmount, 0))} icon={CheckCircle2} />
        <MetricCard title="Vencendo em 7 dias" value={expiring.length} note="Rascunhos e enviados" icon={AlertTriangle} />
        <MetricCard title="Formalizados no mês" value={brl(monthWon)} note="Viraram venda ou OS" icon={Wallet} />
      </div>

      <Tabs defaultValue="lista">
        <TabsList><TabsTrigger value="lista">Orçamentos</TabsTrigger>{options?.canConfigure && <TabsTrigger value="config">Empresa e logotipo</TabsTrigger>}</TabsList>
        <TabsContent value="lista">
          <SectionCard title="Orçamentos">
            <div className="mb-3 grid gap-3 md:grid-cols-3">
              <TextField label="Buscar" placeholder="Número, cliente, vendedor ou título" value={query} onChange={setQuery} />
              <SelectField label="Situação" value={statusFilter} onChange={setStatusFilter} options={[{ value: "abertos", label: "Em andamento (rascunho, enviado, aprovado)" }, { value: "todos", label: "Todos" }, ...["Rascunho", "Enviado", "Aprovado", "Recusado", "Expirado", "Convertido", "Cancelado", "Substituído"].map((value) => ({ value, label: value }))]} />
            </div>
            <DataTable headers={["Número", "Cliente", "Vendedor", "Tipo", "Emissão", "Validade", "Total", "Margem", "Situação", "Ações"]} empty={!shown.length}>
              {shown.map((row) => {
                const margin = row.totalAmount > 0 ? Math.round(((row.itemsSubtotal - row.discountAmount - row.estimatedCost) / Math.max(row.itemsSubtotal - row.discountAmount, 0.01)) * 1000) / 10 : null
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.number}{row.version > 1 ? ` v${row.version}` : ""}</TableCell><TableCell>{row.clientName}</TableCell><TableCell>{row.salespersonName}</TableCell><TableCell>{row.quoteType}</TableCell>
                    <TableCell>{day(row.issueDate)}</TableCell><TableCell>{day(row.validUntil)}</TableCell><TableCell>{brl(row.totalAmount)}</TableCell>
                    <TableCell className={margin != null && margin < 0 ? "text-destructive" : ""}>{margin == null ? "-" : `${margin.toLocaleString("pt-BR")}%`}</TableCell>
                    <TableCell><StatusBadge status={row.effectiveStatus} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => void openQuote(row.id)}>Abrir</Button></TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>
        {options?.canConfigure && (
          <TabsContent value="config">
            <SectionCard title="Empresa e logotipo do PDF" description="Os dados abaixo vêm do cadastro da empresa (Configurações > Empresas / CNPJs). O logotipo aparece no cabeçalho do PDF.">
              <div className="space-y-2 text-sm">
                <div><strong>{options.company.name}</strong> {options.company.cnpj ? `· CNPJ ${options.company.cnpj}` : ""}</div>
                <div className="text-muted-foreground">{[options.company.address, options.company.phone, options.company.email].filter(Boolean).join(" · ") || "Complete endereço, telefone e e-mail em Configurações > Empresas / CNPJs."}</div>
                {options.company.hasLogo && <img src="/api/orcamentos/logo" alt="Logotipo" className="max-h-20 rounded border bg-white p-2" />}
                <div className="space-y-1"><Label>Enviar logotipo (JPG ou PNG)</Label><input type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadLogo(event)} /></div>
                <div className="text-muted-foreground">{options.emailConfigured ? "Envio por e-mail ativo." : "Envio por e-mail desativado: defina RESEND_API_KEY (e, se quiser, QUOTE_FROM_EMAIL) no servidor."}</div>
              </div>
            </SectionCard>
          </TabsContent>
        )}
      </Tabs>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle>{detail ? `${detail.quote.number}${detail.quote.version > 1 ? ` · versão ${detail.quote.version}` : ""}` : "Novo orçamento"} {detail && <StatusBadge status={status} />}</SheetTitle>
            <SheetDescription>{detail ? `${detail.quote.clientName} · emitido em ${day(detail.quote.issueDate)}` : "Os itens vêm do catálogo; o preço negociado fica preservado no orçamento."}</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-6">
            {readOnly && <p className="rounded-md border bg-muted/40 p-2 text-sm">Orçamento {status.toLowerCase()}: somente consulta. Para alterar valores, crie uma nova versão.</p>}
            <div className="grid gap-3 md:grid-cols-3">
              <div className={`md:col-span-2 ${readOnly ? "pointer-events-none opacity-70" : ""}`}><SearchableSelectField label="Cliente *" value={form.clientId || none} onChange={(value) => setForm({ ...form, clientId: value === none ? "" : value })} options={[{ value: none, label: "Selecione" }, ...clientItems]} /></div>
              <Opts label="Vendedor / responsável *" value={form.salespersonId} onChange={(value) => setForm({ ...form, salespersonId: value })} items={(options?.salespeople || []).map((item) => ({ value: item.id, label: item.name }))} disabled={readOnly} />
              <TextField label="Título (opcional)" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
              <Opts label="Tipo *" value={form.quoteType} onChange={(value) => setForm({ ...form, quoteType: value || "Misto" })} items={quoteTypes.map((value) => ({ value, label: value }))} disabled={readOnly} />
              <Opts label="Oportunidade (funil)" value={form.opportunityId} onChange={(value) => setForm({ ...form, opportunityId: value })} items={(options?.opportunities || []).filter((item) => !form.clientId || item.clientId === form.clientId).map((item) => ({ value: item.id, label: `${item.code} · ${item.title}` }))} placeholder="Nenhuma" disabled={readOnly || Boolean(detail)} />
              <TextField label="Emissão" type="date" value={form.issueDate} onChange={() => undefined} />
              <TextField label="Validade *" type="date" value={form.validUntil} onChange={(value) => !readOnly && setForm({ ...form, validUntil: value })} />
              <Opts label="Condição de pagamento *" value={form.paymentConditionId} onChange={(value) => setForm({ ...form, paymentConditionId: value })} items={(options?.paymentConditions || []).map((item) => ({ value: item.id, label: item.name }))} disabled={readOnly} />
              <TextField label="Prazo de entrega / execução" value={form.deliveryText} onChange={(value) => !readOnly && setForm({ ...form, deliveryText: value })} />
              <TextField label="Garantia (dias)" type="number" value={form.warrantyDays} onChange={(value) => !readOnly && setForm({ ...form, warrantyDays: value })} />
            </div>
            {!detail && options && options.templates.length > 0 && (
              <div className="max-w-sm"><Opts label="Modelo de orçamento" value="" onChange={(value) => { const template = options.templates.find((item) => item.id === value); if (template) setForm((current) => ({ ...current, quoteType: template.quoteType || current.quoteType, validUntil: plusDays(template.validityDays), paymentConditionId: template.paymentConditionId || current.paymentConditionId, deliveryText: template.deliveryText || current.deliveryText, warrantyDays: String(template.warrantyDays), notes: template.notes || current.notes })) }} items={options.templates.map((item) => ({ value: item.id, label: item.name }))} placeholder="Aplicar um modelo..." /></div>
            )}
            {client && !client.document && <p className="text-xs text-amber-600">Este cliente é um lead sem CPF/CNPJ: complete o cadastro em Comercial antes de formalizar.</p>}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Itens</h3>
              {!readOnly && (
                <div className="grid items-end gap-2 md:grid-cols-[10rem_1fr_auto]">
                  <Opts label="Adicionar do catálogo" value={adding.kind} onChange={(value) => setAdding({ kind: (value || "Produto") as "Produto" | "Serviço", id: "" })} items={[{ value: "Produto", label: "Produto" }, { value: "Serviço", label: "Serviço" }]} />
                  <SearchableSelectField label="Item" value={adding.id || none} onChange={(value) => setAdding({ ...adding, id: value === none ? "" : value })} options={[{ value: none, label: "Pesquisar no catálogo" }, ...catalogItems]} />
                  <Button type="button" variant="outline" onClick={addLine} disabled={!adding.id}><Plus className="h-4 w-4" />Adicionar</Button>
                </div>
              )}
              <DataTable headers={["Item", "Qtd.", "Preço unit.", "Desc. %", "Total", "Custo / disponib.", ""]} empty={!lines.length}>
                {lines.map((line) => {
                  const now = catalogNow(line)
                  const priceDiffers = now && Math.abs(now.price - num(line.unitPrice)) > 0.005
                  const stockInfo = line.lineType === "Produto" && now && "controlsStock" in now && now.controlsStock ? now.stock - now.reserved : null
                  const lineTotal = Math.round(num(line.quantity) * num(line.unitPrice) * (1 - num(line.discountPercent) / 100) * 100) / 100
                  return (
                    <TableRow key={line.key}>
                      <TableCell className="min-w-[14rem]">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">{line.lineType === "Produto" && now && "photoUrl" in now && now.photoUrl ? <img src={now.photoUrl} alt="" className="h-9 w-12 rounded border object-cover" loading="lazy" /> : null}{line.lineType}</div>
                        <input className="w-full rounded border bg-background px-2 py-1 text-sm" value={line.description} readOnly={readOnly} onChange={(event) => patchLine(line.key, { description: event.target.value })} />
                        {line.lineType === "Produto" && (line.configurationId || (now && "hasEngineering" in now && now.hasEngineering)) ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            {line.configurationId ? <span className={`rounded px-1.5 py-0.5 font-medium ${configStatusTone(line.configStatus || "")}`}>{configStatusLabel(line.configStatus || "")}</span> : <span className="text-muted-foreground">Produto padrão</span>}
                            {!readOnly ? <button type="button" className="text-primary underline" onClick={() => setConfiguring(line)}>{line.configurationId ? "Editar personalização" : "Personalizar produto"}</button> : null}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell><input className="w-20 rounded border bg-background px-2 py-1 text-sm" type="number" value={line.quantity} readOnly={readOnly} onChange={(event) => patchLine(line.key, { quantity: event.target.value })} /><div className="text-xs text-muted-foreground">{line.unit}</div></TableCell>
                      <TableCell>
                        <input className="w-28 rounded border bg-background px-2 py-1 text-sm" type="number" value={line.unitPrice} readOnly={readOnly} onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })} />
                        {priceDiffers && <div className="text-xs text-amber-600">Catálogo hoje: {brl(now!.price)}{!readOnly && <button type="button" className="ml-1 underline" onClick={() => patchLine(line.key, { unitPrice: String(now!.price) })}>usar</button>}</div>}
                      </TableCell>
                      <TableCell><input className="w-16 rounded border bg-background px-2 py-1 text-sm" type="number" value={line.discountPercent} readOnly={readOnly} onChange={(event) => patchLine(line.key, { discountPercent: event.target.value })} /></TableCell>
                      <TableCell>{brl(lineTotal)}</TableCell>
                      <TableCell className="text-xs">
                        <div>Custo {brl(line.unitCost)}</div>
                        {stockInfo != null && <div className={num(line.quantity) > stockInfo ? "font-medium text-destructive" : "text-muted-foreground"}>Disponível {stockInfo.toLocaleString("pt-BR")}{num(line.quantity) > stockInfo ? ` (faltam ${(num(line.quantity) - stockInfo).toLocaleString("pt-BR")})` : ""}</div>}
                      </TableCell>
                      <TableCell>{!readOnly && <Button type="button" size="icon" variant="ghost" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                    </TableRow>
                  )
                })}
              </DataTable>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="Desconto global (R$)" type="number" value={form.discountAmount} onChange={(value) => !readOnly && setForm({ ...form, discountAmount: value })} />
                <TextField label="Frete (R$)" type="number" value={form.freightAmount} onChange={(value) => !readOnly && setForm({ ...form, freightAmount: value })} />
                <TextField label="Despesas adicionais (R$)" type="number" value={form.expensesAmount} onChange={(value) => !readOnly && setForm({ ...form, expensesAmount: value })} />
                <TextField label="Impostos a destacar (%)" type="number" value={form.taxPercent} onChange={(value) => !readOnly && setForm({ ...form, taxPercent: value })} />
              </div>
              <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between"><span>Subtotal dos itens</span><span>{brl(totals.subtotal)}</span></div>
                {totals.discount > 0 && <div className="flex justify-between"><span>Desconto global</span><span>- {brl(totals.discount)}</span></div>}
                {num(form.freightAmount) > 0 && <div className="flex justify-between"><span>Frete</span><span>{brl(num(form.freightAmount))}</span></div>}
                {num(form.expensesAmount) > 0 && <div className="flex justify-between"><span>Despesas</span><span>{brl(num(form.expensesAmount))}</span></div>}
                {totals.taxes > 0 && <div className="flex justify-between"><span>Impostos</span><span>{brl(totals.taxes)}</span></div>}
                <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{brl(totals.total)}</span></div>
                <div className={`flex justify-between border-t pt-1 ${totals.margin < 0 ? "text-destructive" : "text-muted-foreground"}`}><span>Custo estimado {brl(totals.cost)}</span><span>Margem {brl(totals.margin)}{totals.marginPercent != null ? ` (${totals.marginPercent.toLocaleString("pt-BR")}%)` : ""}</span></div>
                {totals.margin < 0 && <p className="text-xs text-destructive">Margem negativa: os preços estão abaixo do custo.</p>}
                {conditionRule && conditionRule.installments > 1 && totals.total > 0 && <p className="text-xs text-muted-foreground">{conditionRule.installments}x de {brl(buildInstallments(totals.total, conditionRule, today())[0].amount)}</p>}
              </div>
            </div>
            <TextAreaField label="Observações e condições comerciais" value={form.notes} onChange={(value) => !readOnly && setForm({ ...form, notes: value })} />

            <div className="flex flex-wrap gap-2 border-t pt-4">
              {!readOnly && <Button onClick={() => void save()} disabled={saving}>Salvar</Button>}
              {detail && status === "Rascunho" && <Button variant="outline" onClick={async () => { const saved = await save(); if (saved) setAction({ kind: "email", to: client?.email || "", message: shareMessage({ companyName: options!.company.name, clientName: saved.quote.clientName, quoteNumber: saved.quote.number, version: saved.quote.version, total: saved.quote.totalAmount, validUntil: saved.quote.validUntil }) }) }} disabled={saving}>Salvar e enviar</Button>}
              {detail && <Button variant="outline" onClick={() => void downloadPdf()}>Baixar PDF</Button>}
              {canEmail && options?.emailConfigured && <Button variant="outline" onClick={() => setAction({ kind: "email", to: client?.email || detail!.quote.clientEmail || "", message: shareMessage({ companyName: options.company.name, clientName: detail!.quote.clientName, quoteNumber: detail!.quote.number, version: detail!.quote.version, total: detail!.quote.totalAmount, validUntil: detail!.quote.validUntil }) })}>Enviar por e-mail</Button>}
              {canEmail && <Button variant="outline" onClick={() => setAction({ kind: "whatsapp", phone: client?.phone || detail!.quote.clientPhone || "", message: shareMessage({ companyName: options!.company.name, clientName: detail!.quote.clientName, quoteNumber: detail!.quote.number, version: detail!.quote.version, total: detail!.quote.totalAmount, validUntil: detail!.quote.validUntil }) })}>Enviar por WhatsApp</Button>}
              {detail && status === "Enviado" && <Button variant="outline" onClick={() => void run({ action: "status", to: "Em negociação" }, "Orçamento em negociação")} disabled={saving}>Em negociação</Button>}
              {detail && ["Enviado", "Em negociação"].includes(status) && <Button variant="outline" onClick={() => setAction({ kind: "approve", acceptedBy: "", acceptNotes: "" })}>Registrar aprovação</Button>}
              {detail && ["Enviado", "Em negociação"].includes(status) && <Button variant="outline" onClick={() => setAction({ kind: "refuse", reason: "" })}>Registrar recusa</Button>}
              {detail && status === "Aprovado" && <Button onClick={() => void convertToOrder()} disabled={saving}>Converter em pedido de venda</Button>}
              {detail && status === "Aprovado" && <Button variant="outline" onClick={() => setAction({ kind: "formalize", warehouseId: options?.warehouses.find((item) => item.isDefault)?.id || options?.warehouses[0]?.id || "", baseDate: today() })}>Venda direta (baixa imediata)</Button>}
              {detail && status === "Aprovado" && <Button asChild><Link href={`/ordens-servico/nova?quoteId=${detail.quote.id}`}>Abrir OS</Link></Button>}
              {detail && status === "Aprovado" && <Button variant="outline" asChild><Link href={`/contratos?quoteId=${detail.quote.id}`}>Gerar contrato</Link></Button>}
              {detail && ["Enviado", "Em negociação", "Aprovado", "Recusado", "Expirado"].includes(status) && <Button variant="outline" onClick={() => void run({ action: "version" }, "Nova versão criada")} disabled={saving}>Nova versão</Button>}
              {detail && <Button variant="outline" onClick={() => void run({ action: "duplicate" }, "Orçamento duplicado")} disabled={saving}>Duplicar</Button>}
              {detail && ["Rascunho", "Enviado", "Em negociação", "Aprovado", "Expirado"].includes(status) && <Button variant="outline" onClick={() => setAction({ kind: "cancel", reason: "" })}>Cancelar orçamento</Button>}
            </div>

            {action && detail && (
              <div className="space-y-3 rounded-md border p-3">
                {action.kind === "approve" && (<>
                  <h4 className="text-sm font-medium">Aprovação e aceite</h4>
                  <TextField label="Responsável pelo aceite *" value={action.acceptedBy || ""} onChange={(value) => setAction({ ...action, acceptedBy: value })} />
                  <TextAreaField label="Observações do aceite" rows={2} value={action.acceptNotes || ""} onChange={(value) => setAction({ ...action, acceptNotes: value })} />
                  <Button onClick={() => void run({ action: "status", to: "Aprovado", acceptedBy: action.acceptedBy, acceptNotes: action.acceptNotes }, "Orçamento aprovado")} disabled={saving}>Confirmar aprovação</Button>
                </>)}
                {(action.kind === "refuse" || action.kind === "cancel") && (<>
                  <h4 className="text-sm font-medium">{action.kind === "refuse" ? "Recusa do cliente" : "Cancelar orçamento"}</h4>
                  <TextAreaField label="Motivo *" rows={2} value={action.reason || ""} onChange={(value) => setAction({ ...action, reason: value })} />
                  <Button variant="destructive" onClick={() => void run({ action: "status", to: action.kind === "refuse" ? "Recusado" : "Cancelado", reason: action.reason }, action.kind === "refuse" ? "Recusa registrada" : "Orçamento cancelado")} disabled={saving}>Confirmar</Button>
                </>)}
                {action.kind === "formalize" && (<>
                  <h4 className="text-sm font-medium">Formalizar como venda</h4>
                  <p className="text-xs text-muted-foreground">Gera os títulos a receber pela condição acordada e dá baixa no estoque dos produtos. Para execução, use "Abrir OS": os títulos são gerados ao salvar a OS.</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <TextField label="Data base dos vencimentos" type="date" value={action.baseDate || ""} onChange={(value) => setAction({ ...action, baseDate: value })} />
                    {needsWarehouse && <Opts label="Depósito de saída dos produtos *" value={action.warehouseId || ""} onChange={(value) => setAction({ ...action, warehouseId: value })} items={(options?.warehouses || []).map((item) => ({ value: item.id, label: item.name }))} />}
                  </div>
                  {parcels.length > 0 && <div className="text-xs text-muted-foreground">{parcels.map((parcel) => `${parcel.number}/${parcels.length}: ${day(parcel.dueDate)} · ${brl(parcel.amount)}`).join("  |  ")}</div>}
                  <Button onClick={() => void run({ action: "formalize", target: "Venda", warehouseId: action.warehouseId, baseDate: action.baseDate }, "Venda formalizada")} disabled={saving}>Confirmar formalização</Button>
                </>)}
                {action.kind === "email" && (<>
                  <h4 className="text-sm font-medium">Enviar por e-mail (PDF em anexo)</h4>
                  <TextField label="Para *" value={action.to || ""} onChange={(value) => setAction({ ...action, to: value })} />
                  <TextAreaField label="Mensagem" rows={4} value={action.message || ""} onChange={(value) => setAction({ ...action, message: value })} />
                  <Button onClick={() => void sendEmail()} disabled={saving || !options?.emailConfigured}>Enviar</Button>
                  {!options?.emailConfigured && <p className="text-xs text-amber-600">E-mail não configurado no servidor (RESEND_API_KEY).</p>}
                </>)}
                {action.kind === "whatsapp" && (<>
                  <h4 className="text-sm font-medium">Enviar por WhatsApp</h4>
                  <p className="text-xs text-muted-foreground">O PDF é baixado para você anexar na conversa; o orçamento é marcado como enviado.</p>
                  <TextField label="WhatsApp do cliente *" value={action.phone || ""} onChange={(value) => setAction({ ...action, phone: value })} />
                  <TextAreaField label="Mensagem" rows={4} value={action.message || ""} onChange={(value) => setAction({ ...action, message: value })} />
                  <Button onClick={() => void sendWhatsapp()} disabled={saving}>Abrir WhatsApp e marcar como enviado</Button>
                </>)}
                <Button variant="ghost" size="sm" onClick={() => setAction(null)}>Fechar</Button>
              </div>
            )}

            {detail && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <h3 className="font-medium">Versões</h3>
                  {detail.versions.map((version) => (
                    <div key={version.id} className="flex items-center justify-between rounded border p-2">
                      <span>v{version.version} · {brl(version.total)} · {version.status}</span>
                      {version.id !== detail.quote.id && <Button size="sm" variant="outline" onClick={() => void openQuote(version.id)}>Abrir</Button>}
                    </div>
                  ))}
                  {detail.orders.length > 0 && <p>OS: {detail.orders.map((order) => <Link key={order.id} className="mr-2 text-primary underline" href={`/ordens-servico/${order.id}`}>{order.number} ({order.status})</Link>)}</p>}
                  {detail.receivables.length > 0 && (
                    <div><h3 className="font-medium">Títulos a receber</h3>{detail.receivables.map((item) => <div key={item.id}>{item.count ? `${item.number}/${item.count} · ` : ""}{day(item.dueDate)} · {brl(item.amount)} · {item.status}</div>)}</div>
                  )}
                  <h3 className="pt-2 font-medium">Anexos</h3>
                  {detail.attachments.map((file) => (
                    <div key={file.id} className="flex items-center justify-between rounded border p-2">
                      <a className="text-primary underline" href={`/api/orcamentos/file?path=${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer">{file.name}</a>
                      <Button size="icon" variant="ghost" onClick={() => void run({ action: "detach", attachmentId: file.id }, "Anexo removido")}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void upload(event)} />
                </div>
                <div className="space-y-2 text-sm">
                  <h3 className="font-medium">Histórico</h3>
                  {detail.events.map((item) => (
                    <div key={item.id} className="rounded border p-2">
                      <div className="text-xs text-muted-foreground">{stamp(item.at)} · {item.event} · {item.author}</div>
                      <div>{item.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {configuring ? (
        <ConfiguratorDialog open productId={configuring.catalogId} productName={options?.products.find((item) => item.id === configuring.catalogId)?.name || configuring.description} quoteItemId={configuring.id}
          initial={configuring.configurationId ? { configurationId: configuring.configurationId } : undefined}
          onClose={() => setConfiguring(null)}
          onApply={(result) => { patchLine(configuring.key, { configurationId: result.configuration_id, configStatus: result.status, configSummary: result.summary, unitPrice: String(result.price), unitCost: result.costs.total, description: result.summary || configuring.description }); setConfiguring(null) }} />
      ) : null}
    </PageShell>
  )
}
