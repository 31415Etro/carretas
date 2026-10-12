"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CalendarClock, FileSignature, Plus, RefreshCw, Repeat } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { adjustmentIndexes, amendmentKinds, billingPeriodicities, contractStatuses, contractTypes, documentKinds, isRecurring, osPeriodicities, type ContractAlert } from "@/lib/contracts"

type Row = Record<string, any>
type Detail = { contract: Row; billings: Row[]; amendments: Row[]; documents: Row[]; obligations: Row[]; plans: Row[]; events: Row[]; orders: Row[] }
type Options = {
  company: { id: string; name: string; cnpj: string }
  clients: Array<{ id: string; name: string; document: string; status: string }>
  suppliers: Array<{ id: string; name: string; document: string }>
  users: Array<{ id: string; name: string; email: string }>
  services: Array<{ id: string; name: string; code: string }>
  technicians: Array<{ id: string; name: string }>
  assets: Array<{ id: string; clientId: string; name: string }>
  quotes: Array<{ id: string; number: string; version: number; clientId: string; clientName: string; total: number; paymentConditionName: string; salespersonName: string }>
  paymentMethods: string[]
}
type Panel = null | { kind: "status"; to: string; reason: string; signedDate: string } | { kind: "amend"; values: Row } | { kind: "document"; values: Row; file?: File } | { kind: "obligation"; values: Row } | { kind: "plan"; values: Row }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
const today = () => new Date().toISOString().slice(0, 10)
const none = "nenhum"
const orderKinds = ["Manutenção preventiva", "Manutenção corretiva", "Inspeção / vistoria", "Reparo", "Garantia"]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyForm = (): Row => ({
  id: "", contractType: "Prestação de serviços", direction: "Receita", title: "", clientId: "", supplierId: "", quoteId: "", signedDate: "", startDate: today(), endDate: "", indefinite: false, totalValue: "", recurringValue: "",
  billingPeriodicity: "Mensal", dueDay: "10", billingStartDate: "", billingAdvanceDays: "10", paymentMethod: "Boleto", adjustmentIndex: "Nenhum", adjustmentPercent: "", nextAdjustmentDate: "", noticeDays: "0", autoRenew: false,
  renewalMonths: "", penaltyTerms: "", scope: "", sla: "", responsibleUserId: "", responsibleName: "", status: "Rascunho",
})

function Opts({ label, value, onChange, items, placeholder = "Selecione", disabled }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string; disabled?: boolean }) {
  return <div className={disabled ? "pointer-events-none opacity-70" : ""}><SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} /></div>
}

export function ContractsPage() {
  const { toast } = useCrudFeedback()
  const [contracts, setContracts] = useState<Row[]>([])
  const [alerts, setAlerts] = useState<ContractAlert[]>([])
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState("ativos")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Row>(emptyForm())
  const [detail, setDetail] = useState<Detail | null>(null)
  const [panel, setPanel] = useState<Panel>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, alertList, opts] = await Promise.all([api<{ contracts: Row[] }>("/api/contratos"), api<{ alerts: ContractAlert[] }>("/api/contratos/alertas"), api<Options>("/api/contratos/options")])
      setContracts(list.contracts)
      setAlerts(alertList.alerts)
      setOptions(opts)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar contratos.")
    } finally {
      setLoading(false)
    }
  }, [])

  const runAutomation = useCallback(async (silent: boolean) => {
    try {
      const result = await api<{ billings: number; orders: number; notified: number; problems: string[] }>("/api/contratos/automacao", { method: "POST" })
      if (result.billings || result.orders || result.problems.length || !silent) {
        toast({ title: "Automação de contratos", description: `${result.billings} lançamento(s) financeiro(s) e ${result.orders} OS gerados.${result.notified ? ` ${result.notified} alerta(s) enviados por e-mail.` : ""}${result.problems.length ? ` Atenção: ${result.problems.join(" | ")}` : ""}`, variant: result.problems.length ? "destructive" : undefined })
      }
    } catch (reason) {
      if (!silent) toast({ title: "Automação não executada", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
    await load()
  }, [load, toast])

  useEffect(() => { void runAutomation(true) }, [runAutomation])

  function hydrate(data: Detail) {
    const c = data.contract
    setDetail(data)
    setForm({
      id: c.id, contractType: c.contractType, direction: c.direction, title: c.title, clientId: c.clientId, supplierId: c.supplierId, quoteId: c.quoteId, signedDate: c.signedDate, startDate: c.startDate, endDate: c.endDate, indefinite: c.indefinite,
      totalValue: String(c.totalValue), recurringValue: c.recurringValue ? String(c.recurringValue) : "", billingPeriodicity: c.billingPeriodicity || "Mensal", dueDay: c.dueDay ? String(c.dueDay) : "10", billingStartDate: c.billingStartDate,
      billingAdvanceDays: String(c.billingAdvanceDays), paymentMethod: c.paymentMethod, adjustmentIndex: c.adjustmentIndex, adjustmentPercent: c.adjustmentPercent ? String(c.adjustmentPercent) : "", nextAdjustmentDate: c.nextAdjustmentDate,
      noticeDays: String(c.noticeDays), autoRenew: c.autoRenew, renewalMonths: c.renewalMonths ? String(c.renewalMonths) : "", penaltyTerms: c.penaltyTerms, scope: c.scope, sla: c.sla, responsibleUserId: c.responsibleUserId,
      responsibleName: c.responsibleName, status: c.status,
    })
  }

  function startNew(prefill: Row = {}) {
    setForm({ ...emptyForm(), ...prefill })
    setDetail(null)
    setPanel(null)
    setOpen(true)
  }

  async function openContract(id: string) {
    try {
      hydrate(await api<Detail>(`/api/contratos/${id}`))
      setPanel(null)
      setOpen(true)
    } catch (reason) {
      toast({ title: "Não foi possível abrir", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  // chegada pelo orçamento aprovado: /contratos?quoteId=...
  useEffect(() => {
    if (!options) return
    const quoteId = new URLSearchParams(window.location.search).get("quoteId")
    if (!quoteId) return
    window.history.replaceState(null, "", "/contratos")
    api<{ quote: Row; items: Row[] }>(`/api/orcamentos/${quoteId}`).then(({ quote, items }) => {
      startNew({
        quoteId, clientId: quote.clientId, title: `Contrato referente ao orçamento ${quote.number}`, totalValue: String(quote.totalAmount), contractType: quote.quoteType === "Produto" ? "Comercial / venda" : "Prestação de serviços",
        scope: items.map((item) => `${item.quantity} ${item.unit} — ${item.description}`).join("\n"), paymentMethod: "Boleto",
      })
    }).catch((reason) => toast({ title: "Orçamento não carregado", description: reason instanceof Error ? reason.message : "", variant: "destructive" }))
  }, [options]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = detail?.contract.status as string | undefined
  const termsEditable = !detail || ["Rascunho", "Aguardando assinatura"].includes(status || "")
  const recurring = isRecurring({ contractType: form.contractType, recurringValue: Number(form.recurringValue) || 0 })
  const isFinal = ["Encerrado", "Rescindido", "Cancelado"].includes(status || "")

  async function save() {
    setSaving(true)
    try {
      const data = await api<Detail>("/api/contratos", { method: "POST", body: JSON.stringify({ contract: form }) })
      hydrate(data)
      toast({ title: "Contrato salvo", description: data.contract.number })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function act(body: Row, successTitle: string) {
    if (!detail) return null
    setSaving(true)
    try {
      const raw = await api<Detail & { detail?: Detail; amendmentId?: string }>(`/api/contratos/${detail.contract.id}`, { method: "POST", body: JSON.stringify(body) })
      const data = raw.detail || raw
      hydrate(data)
      setPanel(null)
      toast({ title: successTitle })
      await load()
      return raw
    } catch (reason) {
      toast({ title: "Ação não concluída", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function uploadAndAttach(values: Row, file: File | undefined, amendmentId?: string) {
    if (!detail) return
    if (!file) return toast({ title: "Selecione o arquivo", variant: "destructive" })
    try {
      const body = new FormData()
      body.set("file", file)
      const stored = await api<{ path: string; name: string }>("/api/contratos/file", { method: "POST", body })
      await act({ action: "document", kind: values.kind, title: values.title, signedAt: values.signedAt, path: stored.path, name: file.name, amendmentId }, "Documento anexado (nova versão)")
    } catch (reason) {
      toast({ title: "Falha no envio", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function submitAmendment() {
    if (panel?.kind !== "amend") return
    const raw = await act({ action: "amend", ...panel.values }, "Aditivo registrado")
    if (raw && (panel.values as Row).file) await uploadAndAttach({ kind: "Aditivo", title: `Aditivo ${panel.values.kind}`, signedAt: panel.values.effectiveDate }, (panel.values as Row).file, raw.amendmentId)
  }

  const text = query.trim().toLowerCase()
  const shown = contracts.filter((row) => {
    if (statusFilter === "ativos" && !["Rascunho", "Aguardando assinatura", "Vigente", "Suspenso"].includes(row.status)) return false
    if (!["ativos", "todos"].includes(statusFilter) && row.status !== statusFilter) return false
    return !text || [row.number, row.title, row.counterpartyName, row.responsibleName].some((value) => String(value || "").toLowerCase().includes(text))
  })
  const vigentes = contracts.filter((row) => row.status === "Vigente")
  const monthlyIncome = vigentes.filter((row) => row.direction === "Receita").reduce((sum, row) => sum + (row.billingPeriodicity ? row.recurringValue / billingPeriodicities[row.billingPeriodicity as keyof typeof billingPeriodicities] : 0), 0)
  const clientItems = (options?.clients || []).map((item) => ({ value: item.id, label: `${item.name}${item.status === "Prospect" ? " (lead)" : ""}${item.document ? ` · ${item.document}` : ""}` }))
  const supplierItems = (options?.suppliers || []).map((item) => ({ value: item.id, label: `${item.name}${item.document ? ` · ${item.document}` : ""}` }))
  const set = (patch: Row) => setForm((current) => ({ ...current, ...patch }))
  const clientAssets = (options?.assets || []).filter((item) => item.clientId === form.clientId)

  const transitions: Record<string, string[]> = { Rascunho: ["Aguardando assinatura", "Vigente", "Cancelado"], "Aguardando assinatura": ["Vigente", "Rascunho", "Cancelado"], Vigente: ["Suspenso", "Encerrado", "Rescindido"], Suspenso: ["Vigente", "Encerrado", "Rescindido"] }
  const transitionLabel = (from: string, to: string) => (to === "Vigente" ? (from === "Suspenso" ? "Retomar contrato" : "Tornar vigente") : to === "Aguardando assinatura" ? "Enviar para assinatura" : to === "Rascunho" ? "Voltar para rascunho" : to === "Suspenso" ? "Suspender" : to === "Encerrado" ? "Encerrar" : to === "Rescindido" ? "Rescindir" : "Cancelar")

  return (
    <PageShell
      title="Contratos"
      description="Contratos de serviço, fornecimento e manutenção recorrente: cobrança automática, OS periódicas, aditivos e vencimentos."
      actions={<><Button onClick={() => startNew()} disabled={!options}><Plus className="h-4 w-4" />Novo contrato</Button><Button variant="outline" onClick={() => void runAutomation(false)} disabled={loading}><Repeat className="h-4 w-4" />Rodar automação</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Atualizar</Button></>}
    >
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="Contratos vigentes" value={vigentes.length} note={`${contracts.filter((row) => row.status === "Aguardando assinatura").length} aguardando assinatura`} icon={FileSignature} />
        <MetricCard title="Receita recorrente / mês" value={brl(monthlyIncome)} note="Contratos de receita vigentes" icon={Repeat} />
        <MetricCard title="Alertas" value={alerts.length} note={`${alerts.filter((item) => item.overdue).length} vencido(s)`} icon={AlertTriangle} />
        <MetricCard title="Encerram em 30 dias" value={vigentes.filter((row) => row.endDate && row.endDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length} note="Renovar, aditivar ou encerrar" icon={CalendarClock} />
      </div>

      <Tabs defaultValue="lista">
        <TabsList><TabsTrigger value="lista">Contratos</TabsTrigger><TabsTrigger value="alertas">Alertas{alerts.length ? ` (${alerts.length})` : ""}</TabsTrigger></TabsList>
        <TabsContent value="lista">
          <SectionCard title="Contratos">
            <div className="mb-3 grid gap-3 md:grid-cols-3">
              <TextField label="Buscar" placeholder="Número, título, parte ou responsável" value={query} onChange={setQuery} />
              <SelectField label="Situação" value={statusFilter} onChange={setStatusFilter} options={[{ value: "ativos", label: "Em andamento" }, { value: "todos", label: "Todos" }, ...contractStatuses.map((value) => ({ value, label: value }))]} />
            </div>
            <DataTable headers={["Número", "Tipo", "Título", "Parte", "Vigência", "Valor total", "Recorrente", "Faturado", "Responsável", "Situação", "Ações"]} empty={!shown.length}>
              {shown.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.number}</TableCell><TableCell>{row.contractType}<div className="text-xs text-muted-foreground">{row.direction}</div></TableCell><TableCell className="max-w-[14rem] truncate" title={row.title}>{row.title}</TableCell>
                  <TableCell>{row.counterpartyName}</TableCell><TableCell>{day(row.startDate)} a {row.indefinite ? "indeterminado" : day(row.endDate)}</TableCell><TableCell>{brl(row.totalValue)}</TableCell>
                  <TableCell>{row.recurringValue ? `${brl(row.recurringValue)} / ${String(row.billingPeriodicity).toLowerCase()}` : "-"}</TableCell><TableCell>{brl(row.billedTotal)}</TableCell><TableCell>{row.responsibleName}</TableCell>
                  <TableCell><StatusBadge status={row.status} />{row.status === "Vigente" && !row.hasSignature && <div className="text-xs text-destructive">sem assinatura</div>}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => void openContract(row.id)}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="alertas">
          <SectionCard title="Vencimentos e pendências" description="Reajuste (60 dias), aviso prévio/renovação e encerramento (30 dias), obrigações e documentos pendentes (15 dias). Os responsáveis são avisados por e-mail uma vez por alerta, quando o envio está configurado.">
            <DataTable headers={["Contrato", "Tipo", "Alerta", "Prazo", "Responsável", "Situação"]} empty={!alerts.length}>
              {alerts.map((alert) => (
                <TableRow key={`${alert.contractId}-${alert.key}`}>
                  <TableCell><button className="text-primary underline" onClick={() => void openContract(alert.contractId)}>{alert.contractNumber}</button><div className="text-xs text-muted-foreground">{alert.title}</div></TableCell>
                  <TableCell>{alert.kind}</TableCell><TableCell>{alert.message}</TableCell><TableCell>{day(alert.dueDate)}</TableCell><TableCell>{alert.responsibleName}</TableCell>
                  <TableCell><StatusBadge status={alert.overdue ? "Vencido" : "A vencer"} /></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle>{detail ? `${detail.contract.number}${detail.contract.version > 1 ? ` · versão ${detail.contract.version}` : ""}` : "Novo contrato"} {status && <StatusBadge status={status} />}</SheetTitle>
            <SheetDescription>{detail ? detail.contract.title : `Empresa responsável: ${options?.company.name || "-"}${options?.company.cnpj ? ` · CNPJ ${options.company.cnpj}` : ""}`}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <Tabs defaultValue="dados">
              <TabsList className="flex flex-wrap">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                {detail && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
                {detail && form.direction === "Receita" && <TabsTrigger value="manutencao">Manutenção (OS)</TabsTrigger>}
                {detail && <TabsTrigger value="obrigacoes">Obrigações</TabsTrigger>}
                {detail && <TabsTrigger value="documentos">Documentos e aditivos</TabsTrigger>}
                {detail && <TabsTrigger value="historico">Histórico</TabsTrigger>}
              </TabsList>

              <TabsContent value="dados" className="space-y-4 pt-3">
                {!termsEditable && <p className="rounded-md border bg-muted/40 p-2 text-sm">Contrato {String(status).toLowerCase()}: os termos só mudam por aditivo (aba Documentos e aditivos). Abaixo, só os dados operacionais podem ser ajustados.</p>}
                <div className="grid gap-3 md:grid-cols-3">
                  <Opts label="Tipo de contrato *" value={form.contractType} onChange={(value) => set({ contractType: value })} items={contractTypes.map((value) => ({ value, label: value }))} disabled={!termsEditable} />
                  <Opts label="Natureza *" value={form.direction} onChange={(value) => set({ direction: value || "Receita", clientId: "", supplierId: "" })} items={[{ value: "Receita", label: "Receita (cliente)" }, { value: "Despesa", label: "Despesa (fornecedor)" }]} disabled={!termsEditable || Boolean(detail)} />
                  <TextField label="Título / objeto *" value={form.title} onChange={(value) => termsEditable && set({ title: value })} />
                  {form.direction === "Receita"
                    ? <div className={!termsEditable ? "pointer-events-none opacity-70" : ""}><SearchableSelectField label="Contratante (cliente) *" value={form.clientId || none} onChange={(value) => set({ clientId: value === none ? "" : value })} options={[{ value: none, label: "Selecione" }, ...clientItems]} /></div>
                    : <div className={!termsEditable ? "pointer-events-none opacity-70" : ""}><SearchableSelectField label="Contratada (fornecedor) *" value={form.supplierId || none} onChange={(value) => set({ supplierId: value === none ? "" : value })} options={[{ value: none, label: "Selecione" }, ...supplierItems]} /></div>}
                  <TextField label="Empresa responsável" value={options?.company.name || ""} onChange={() => undefined} />
                  <Opts label="Orçamento de origem" value={form.quoteId} onChange={(value) => set({ quoteId: value })} items={(options?.quotes || []).filter((item) => !form.clientId || item.clientId === form.clientId).map((item) => ({ value: item.id, label: `${item.number}${item.version > 1 ? ` v${item.version}` : ""} · ${item.clientName} · ${brl(item.total)}` }))} placeholder="Nenhum" disabled={!termsEditable || Boolean(detail)} />
                  <TextField label="Data de assinatura" type="date" value={form.signedDate} onChange={(value) => termsEditable && set({ signedDate: value })} />
                  <TextField label="Início da vigência *" type="date" value={form.startDate} onChange={(value) => termsEditable && set({ startDate: value })} />
                  <TextField label={`Término${form.indefinite ? "" : " *"}`} type="date" value={form.endDate} onChange={(value) => termsEditable && set({ endDate: value })} />
                  <div className="flex items-end gap-2 pb-2"><Checkbox id="indef" checked={Boolean(form.indefinite)} onCheckedChange={(value) => termsEditable && set({ indefinite: value === true })} /><Label htmlFor="indef">Prazo indeterminado</Label></div>
                  <TextField label="Valor total (R$) *" type="number" value={form.totalValue} onChange={(value) => termsEditable && set({ totalValue: value })} />
                  <TextField label={`Valor mensal/recorrente (R$)${form.contractType === "Manutenção recorrente" ? " *" : ""}`} type="number" value={form.recurringValue} onChange={(value) => termsEditable && set({ recurringValue: value })} />
                  <Opts label={`Periodicidade de cobrança${recurring ? " *" : ""}`} value={form.billingPeriodicity} onChange={(value) => set({ billingPeriodicity: value })} items={Object.keys(billingPeriodicities).map((value) => ({ value, label: value }))} disabled={!termsEditable} />
                  <TextField label={`Dia de vencimento${recurring ? " *" : ""}`} type="number" value={form.dueDay} onChange={(value) => termsEditable && set({ dueDay: value })} />
                  <Opts label="Forma de pagamento *" value={form.paymentMethod} onChange={(value) => set({ paymentMethod: value })} items={(options?.paymentMethods || []).map((value) => ({ value, label: value }))} disabled={!termsEditable} />
                  <Opts label="Índice de reajuste" value={form.adjustmentIndex} onChange={(value) => set({ adjustmentIndex: value || "Nenhum" })} items={adjustmentIndexes.map((value) => ({ value, label: value }))} disabled={!termsEditable} />
                  {form.adjustmentIndex === "Percentual fixo" && <TextField label="Percentual fixo (%)" type="number" value={form.adjustmentPercent} onChange={(value) => termsEditable && set({ adjustmentPercent: value })} />}
                  {form.adjustmentIndex !== "Nenhum" && <TextField label="Próximo reajuste" type="date" value={form.nextAdjustmentDate} onChange={(value) => termsEditable && set({ nextAdjustmentDate: value })} />}
                  <TextField label="Prazo de aviso prévio (dias)" type="number" value={form.noticeDays} onChange={(value) => set({ noticeDays: value })} />
                  <div className="flex items-end gap-2 pb-2"><Checkbox id="renew" checked={Boolean(form.autoRenew)} onCheckedChange={(value) => set({ autoRenew: value === true })} /><Label htmlFor="renew">Renovação automática</Label></div>
                  {form.autoRenew && <TextField label="Renovação (meses)" type="number" value={form.renewalMonths} onChange={(value) => set({ renewalMonths: value })} />}
                  <Opts label="Responsável interno *" value={form.responsibleUserId} onChange={(value) => set({ responsibleUserId: value, responsibleName: options?.users.find((item) => item.id === value)?.name || "" })} items={(options?.users || []).map((item) => ({ value: item.id, label: item.name }))} />
                  <TextField label="Dias de antecedência da cobrança" type="number" value={form.billingAdvanceDays} onChange={(value) => set({ billingAdvanceDays: value })} />
                  <TextField label="Cobrar a partir de (opcional)" type="date" value={form.billingStartDate} onChange={(value) => set({ billingStartDate: value })} />
                </div>
                <TextAreaField label="Escopo contratado *" value={form.scope} onChange={(value) => termsEditable && set({ scope: value })} />
                <TextAreaField label={`SLA / nível de serviço${form.contractType === "Manutenção recorrente" ? " *" : ""}`} rows={2} value={form.sla} onChange={(value) => set({ sla: value })} />
                <TextAreaField label="Multas e rescisão" rows={2} value={form.penaltyTerms} onChange={(value) => set({ penaltyTerms: value })} />
                <div className="flex flex-wrap gap-2">
                  {termsEditable && <Button onClick={() => void save()} disabled={saving}>Salvar contrato</Button>}
                  {!termsEditable && !isFinal && <Button onClick={() => void act({ action: "operational", ...form }, "Dados operacionais atualizados")} disabled={saving}>Salvar dados operacionais</Button>}
                </div>
                {detail && !isFinal && (
                  <div className="space-y-2 border-t pt-3">
                    <h3 className="text-sm font-medium">Situação do contrato</h3>
                    <div className="flex flex-wrap gap-2">
                      {(transitions[status || ""] || []).map((to) => <Button key={to} variant={to === "Vigente" ? "default" : "outline"} onClick={() => setPanel({ kind: "status", to, reason: "", signedDate: detail.contract.signedDate || "" })}>{transitionLabel(status || "", to)}</Button>)}
                    </div>
                    {panel?.kind === "status" && (
                      <div className="space-y-3 rounded-md border p-3">
                        <h4 className="text-sm font-medium">{transitionLabel(status || "", panel.to)}</h4>
                        {panel.to === "Vigente" && <><TextField label="Data de assinatura *" type="date" value={panel.signedDate} onChange={(value) => setPanel({ ...panel, signedDate: value })} /><p className="text-xs text-muted-foreground">É preciso ter anexado o contrato assinado ou a evidência de aceite (aba Documentos e aditivos).</p></>}
                        {["Suspenso", "Rescindido", "Cancelado", "Encerrado"].includes(panel.to) && <TextAreaField label={`Motivo${panel.to === "Encerrado" ? "" : " *"}`} rows={2} value={panel.reason} onChange={(value) => setPanel({ ...panel, reason: value })} />}
                        <Button onClick={() => void act({ action: "status", to: panel.to, reason: panel.reason, signedDate: panel.signedDate }, "Situação alterada")} disabled={saving}>Confirmar</Button>
                        <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Fechar</Button>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {detail && (
                <TabsContent value="financeiro" className="space-y-3 pt-3">
                  <p className="text-sm text-muted-foreground">Os lançamentos {detail.contract.direction === "Receita" ? "a receber" : "a pagar"} de cada competência são gerados automaticamente (uma vez por competência) enquanto o contrato está vigente. Faturado: <strong>{brl(detail.contract.billedTotal)}</strong> de {brl(detail.contract.totalValue)}.</p>
                  <DataTable headers={["Competência", "Período", "Vencimento", "Valor", "Título"]} empty={!detail.billings.length}>
                    {detail.billings.map((item) => <TableRow key={item.id}><TableCell>{day(item.competence)}</TableCell><TableCell>{day(item.competence)} a {day(item.periodEnd)}</TableCell><TableCell>{day(item.dueDate)}</TableCell><TableCell>{brl(item.amount)}</TableCell><TableCell>{item.titleStatus ? <StatusBadge status={item.titleStatus} /> : "-"}</TableCell></TableRow>)}
                  </DataTable>
                  <p className="text-xs text-muted-foreground">Acompanhe e baixe os títulos no módulo Financeiro (origem "Contrato").</p>
                </TabsContent>
              )}

              {detail && form.direction === "Receita" && (
                <TabsContent value="manutencao" className="space-y-3 pt-3">
                  <p className="text-sm text-muted-foreground">Cada plano abre uma OS na periodicidade escolhida, com a antecedência informada. As OS geradas pelo contrato não geram cobrança própria (a cobrança é a recorrência), salvo valores extras lançados nelas.</p>
                  {!isFinal && <Button variant="outline" onClick={() => setPanel({ kind: "plan", values: { title: "", periodicity: "Mensal", orderKind: "Manutenção preventiva", serviceTypeId: "", technicianId: "", customerAssetId: "", priority: "Media", description: "", leadDays: "3", nextRunDate: today(), active: true } })}><Plus className="h-4 w-4" />Novo plano de OS</Button>}
                  {panel?.kind === "plan" && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="Título *" value={panel.values.title} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, title: value } })} />
                        <Opts label="Periodicidade *" value={panel.values.periodicity} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, periodicity: value } })} items={osPeriodicities.map((value) => ({ value, label: value }))} />
                        <Opts label="Tipo de OS" value={panel.values.orderKind} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, orderKind: value } })} items={orderKinds.map((value) => ({ value, label: value }))} />
                        <Opts label="Serviço *" value={panel.values.serviceTypeId} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, serviceTypeId: value } })} items={(options?.services || []).map((item) => ({ value: item.id, label: item.name }))} />
                        <Opts label="Responsável técnico *" value={panel.values.technicianId} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, technicianId: value } })} items={(options?.technicians || []).map((item) => ({ value: item.id, label: item.name }))} />
                        <Opts label="Carreta / veículo do cliente" value={panel.values.customerAssetId} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, customerAssetId: value } })} items={clientAssets.map((item) => ({ value: item.id, label: item.name }))} />
                        <TextField label="Próxima execução *" type="date" value={panel.values.nextRunDate} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, nextRunDate: value } })} />
                        <TextField label="Abrir a OS com antecedência (dias)" type="number" value={panel.values.leadDays} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, leadDays: value } })} />
                        <Opts label="Prioridade" value={panel.values.priority} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, priority: value } })} items={["Baixa", "Media", "Alta", "Urgente"].map((value) => ({ value, label: value }))} />
                      </div>
                      <TextAreaField label="Descrição / roteiro" rows={2} value={panel.values.description} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, description: value } })} />
                      <div className="flex items-center gap-2"><Checkbox id="planactive" checked={panel.values.active !== false} onCheckedChange={(value) => setPanel({ ...panel, values: { ...panel.values, active: value === true } })} /><Label htmlFor="planactive">Plano ativo</Label></div>
                      <Button onClick={() => void act({ action: "plan", plan: panel.values }, "Plano salvo")} disabled={saving}>Salvar plano</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Fechar</Button>
                    </div>
                  )}
                  <DataTable headers={["Plano", "Periodicidade", "Carreta", "Próxima", "Última", "Ativo", "Ações"]} empty={!detail.plans.length}>
                    {detail.plans.map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell>{plan.title}</TableCell><TableCell>{plan.periodicity}</TableCell><TableCell>{options?.assets.find((item) => item.id === plan.customerAssetId)?.name || "-"}</TableCell>
                        <TableCell>{day(plan.nextRunDate)}</TableCell><TableCell>{day(plan.lastRunDate)}</TableCell><TableCell>{plan.active ? "Sim" : "Não"}</TableCell>
                        <TableCell>{!isFinal && <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "plan", values: { ...plan, leadDays: String(plan.leadDays) } })}>Editar</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                  {detail.orders.length > 0 && <p className="text-sm">OS geradas: {detail.orders.map((order) => <Link key={order.id} className="mr-2 text-primary underline" href={`/ordens-servico/${order.id}`}>{order.number} ({order.status})</Link>)}</p>}
                </TabsContent>
              )}

              {detail && (
                <TabsContent value="obrigacoes" className="space-y-3 pt-3">
                  {!isFinal && <Button variant="outline" onClick={() => setPanel({ kind: "obligation", values: { kind: "Obrigação", title: "", description: "", party: "Contratada", responsibleName: "", dueDate: "", status: "Pendente", notes: "" } })}><Plus className="h-4 w-4" />Nova obrigação / documento</Button>}
                  {panel?.kind === "obligation" && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <Opts label="Tipo" value={panel.values.kind} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, kind: value || "Obrigação" } })} items={["Obrigação", "Documento"].map((value) => ({ value, label: value === "Documento" ? "Documento pendente" : value }))} />
                        <TextField label="Título *" value={panel.values.title} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, title: value } })} />
                        <Opts label="Parte responsável" value={panel.values.party} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, party: value || "Contratada" } })} items={["Contratante", "Contratada"].map((value) => ({ value, label: value }))} />
                        <TextField label="Responsável" value={panel.values.responsibleName} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, responsibleName: value } })} />
                        <TextField label="Prazo" type="date" value={panel.values.dueDate} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, dueDate: value } })} />
                        <Opts label="Situação" value={panel.values.status} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, status: value || "Pendente" } })} items={["Pendente", "Cumprida", "Cancelada"].map((value) => ({ value, label: value }))} />
                      </div>
                      <TextAreaField label="Descrição" rows={2} value={panel.values.description} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, description: value } })} />
                      <Button onClick={() => void act({ action: "obligation", obligation: panel.values }, "Registro salvo")} disabled={saving}>Salvar</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Fechar</Button>
                    </div>
                  )}
                  <DataTable headers={["Tipo", "Título", "Parte", "Responsável", "Prazo", "Situação", "Ações"]} empty={!detail.obligations.length}>
                    {detail.obligations.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.kind}</TableCell><TableCell>{item.title}</TableCell><TableCell>{item.party}</TableCell><TableCell>{item.responsibleName || "-"}</TableCell>
                        <TableCell className={item.status === "Pendente" && item.dueDate && item.dueDate < today() ? "font-medium text-destructive" : ""}>{day(item.dueDate)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell>
                        <TableCell><div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "obligation", values: { ...item } })}>Editar</Button>
                          {item.status === "Pendente" && <Button size="sm" variant="outline" onClick={() => void act({ action: "obligation", obligation: { ...item, status: "Cumprida" } }, "Marcada como cumprida")}>Cumprida</Button>}
                        </div></TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                </TabsContent>
              )}

              {detail && (
                <TabsContent value="documentos" className="space-y-4 pt-3">
                  <p className="text-sm text-muted-foreground">Os documentos nunca são sobrescritos nem apagados: cada envio é uma nova versão. O primeiro contrato assinado fica marcado como original.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setPanel({ kind: "document", values: { kind: "Contrato assinado", title: "", signedAt: "" } })}><Plus className="h-4 w-4" />Anexar documento</Button>
                    {["Vigente", "Suspenso"].includes(status || "") && <Button variant="outline" onClick={() => setPanel({ kind: "amend", values: { kind: "Reajuste", description: "", effectiveDate: today(), percent: detail.contract.adjustmentPercent ? String(detail.contract.adjustmentPercent) : "", months: detail.contract.renewalMonths ? String(detail.contract.renewalMonths) : "", endDate: "", totalValue: "", recurringValue: "", scope: "" } })}><Plus className="h-4 w-4" />Novo aditivo / reajuste / renovação</Button>}
                  </div>
                  {panel?.kind === "document" && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <Opts label="Tipo *" value={panel.values.kind} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, kind: value || "Outro" } })} items={documentKinds.map((value) => ({ value, label: value }))} />
                        <TextField label="Título" value={panel.values.title} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, title: value } })} />
                        <TextField label="Data de assinatura" type="date" value={panel.values.signedAt} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, signedAt: value } })} />
                      </div>
                      <div className="space-y-1"><Label>Arquivo (PDF, JPG, PNG, DOC ou DOCX)</Label><input type="file" accept="application/pdf,image/jpeg,image/png,.doc,.docx" onChange={(event) => setPanel({ ...panel, file: event.target.files?.[0] })} /></div>
                      <Button onClick={() => void uploadAndAttach(panel.values, panel.file)} disabled={saving}>Enviar</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Fechar</Button>
                    </div>
                  )}
                  {panel?.kind === "amend" && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <Opts label="Tipo de aditivo *" value={panel.values.kind} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, kind: value || "Outro" } })} items={amendmentKinds.map((value) => ({ value, label: value }))} />
                        <TextField label="Vigência do aditivo *" type="date" value={panel.values.effectiveDate} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, effectiveDate: value } })} />
                        {panel.values.kind === "Reajuste" && <TextField label={`Percentual (%) — atual ${brl(detail.contract.recurringValue)}`} type="number" value={panel.values.percent} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, percent: value } })} />}
                        {panel.values.kind === "Renovação" && <TextField label="Renovar por (meses)" type="number" value={panel.values.months} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, months: value } })} />}
                        {panel.values.kind === "Aditivo de prazo" && <TextField label="Novo término" type="date" value={panel.values.endDate} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, endDate: value } })} />}
                        {panel.values.kind === "Aditivo de valor" && <><TextField label="Novo valor total" type="number" value={panel.values.totalValue} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, totalValue: value } })} /><TextField label="Novo valor recorrente" type="number" value={panel.values.recurringValue} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, recurringValue: value } })} /></>}
                      </div>
                      {panel.values.kind === "Alteração de escopo" && <TextAreaField label="Novo escopo *" value={panel.values.scope} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, scope: value } })} />}
                      <TextAreaField label="Descrição do aditivo *" rows={2} value={panel.values.description} onChange={(value) => setPanel({ ...panel, values: { ...panel.values, description: value } })} />
                      <div className="space-y-1"><Label>Documento do aditivo (opcional)</Label><input type="file" accept="application/pdf,image/jpeg,image/png,.doc,.docx" onChange={(event) => setPanel({ ...panel, values: { ...panel.values, file: event.target.files?.[0] } })} /></div>
                      <p className="text-xs text-muted-foreground">O valor recorrente novo vale para as competências a partir da vigência do aditivo; o histórico do contrato original é preservado.</p>
                      <Button onClick={() => void submitAmendment()} disabled={saving}>Registrar aditivo</Button>
                      <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>Fechar</Button>
                    </div>
                  )}
                  <h3 className="text-sm font-medium">Documentos</h3>
                  <DataTable headers={["Tipo", "Título", "Versão", "Assinatura", "Enviado em", "Arquivo"]} empty={!detail.documents.length}>
                    {detail.documents.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.kind}{item.isOriginal ? <span className="ml-1 rounded bg-muted px-1 text-xs">original</span> : null}</TableCell><TableCell>{item.title}</TableCell><TableCell>v{item.version}</TableCell>
                        <TableCell>{day(item.signedAt)}</TableCell><TableCell>{stamp(item.at)} · {item.createdBy}</TableCell>
                        <TableCell><a className="text-primary underline" href={`/api/contratos/file?path=${encodeURIComponent(item.path)}`} target="_blank" rel="noreferrer">{item.name}</a></TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                  <h3 className="text-sm font-medium">Aditivos e histórico de versões</h3>
                  <DataTable headers={["Nº", "Tipo", "Vigência", "Descrição", "Antes", "Depois"]} empty={!detail.amendments.length}>
                    {detail.amendments.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.number}</TableCell><TableCell>{item.kind}</TableCell><TableCell>{day(item.effectiveDate)}</TableCell><TableCell>{item.description}</TableCell>
                        <TableCell className="text-xs">{brl(item.before.totalValue)} · rec. {brl(item.before.recurringValue)} · até {day(item.before.endDate)}</TableCell>
                        <TableCell className="text-xs">{brl(item.after.totalValue)} · rec. {brl(item.after.recurringValue)} · até {day(item.after.endDate)}</TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                </TabsContent>
              )}

              {detail && (
                <TabsContent value="historico" className="space-y-2 pt-3 text-sm">
                  {detail.events.map((item) => <div key={item.id} className="rounded border p-2"><div className="text-xs text-muted-foreground">{stamp(item.at)} · {item.event} · {item.author}</div><div>{item.description}</div></div>)}
                </TabsContent>
              )}
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  )
}
