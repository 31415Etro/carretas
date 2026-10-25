"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, CheckCircle2, ChevronRight, CircleDashed, Loader2, Lock, RefreshCw, TriangleAlert, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable, PageShell, SearchableSelectField, SectionCard, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { TableCell, TableRow } from "@/components/ui/table"
import { Opts } from "@/components/settings/common"
import { OpportunityItemsEditor, itemsTotal, type CatalogProduct, type OppItem } from "@/components/commercial/opportunity-items-editor"
import { IdDocumentCapture } from "@/components/registry/id-capture"
import { QuotesPage } from "@/components/quotes/quotes-page"
import { SalesDetailPage } from "@/components/sales/sales-detail-page"
import { EmbeddedPageContext } from "@/lib/embedded-page"
import { idDocumentNotes, type ParsedIdDocument } from "@/lib/id-document"
import { cleanDocument, interactionKinds, isValidDocument, leadOrigins } from "@/lib/commercial"
import { closingChecks, defaultStep, isJourneyStep, journeyLabels, journeySteps, orderConfirmed, stepAvailability, type JourneyStep } from "@/lib/journey"

type Row = Record<string, any>
type Journey = { opportunity: Row; quotes: Row[]; quote: Row | null; order: Row | null; production: Row[]; documentation: Row[]; deliveries: Row[] }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const none = "nenhum"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyParty = (): Row => ({
  id: "", partyId: "", clientId: "", supplierId: "", kind: "cliente", personType: "PJ", name: "", tradeName: "", document: "", stateRegistration: "", municipalRegistration: "", icmsIndicator: "9",
  phone: "", email: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", contactName: "", contactRole: "", salespersonId: "", creditLimit: 0,
  paymentConditionId: "", commercialNotes: "", status: "Prospect",
})
const titleCase = (value: string) => value.toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, (_, space, letter) => space + letter.toUpperCase()).replace(/(?<![a-zà-ÿ])(Da|De|Do|Das|Dos|E)(?![a-zà-ÿ])/g, (word) => word.toLowerCase())

/** Cadastro rápido de cliente (entra como lead): CNPJ preenche a empresa e, para pessoa física, a foto do RG/CNH preenche nome e CPF. */
function QuickClientDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (clientId: string) => void }) {
  const { toast } = useCrudFeedback()
  const [party, setParty] = useState<Row>(emptyParty())
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState("")
  const last = useRef("")
  useEffect(() => { if (open) { setParty(emptyParty()); setLookup(""); last.current = "" } }, [open])
  useEffect(() => {
    if (!open || party.personType !== "PJ") return
    const document = cleanDocument(party.document)
    if (document.length !== 14 || document === last.current || !isValidDocument("PJ", party.document)) return
    last.current = document
    setLookup("Consultando o CNPJ...")
    api<{ company: Row }>(`/api/cnpj/${encodeURIComponent(document)}`).then(({ company }) => {
      setParty((current) => ({ ...current, name: company.legalName || current.name, tradeName: company.tradeName || current.tradeName, phone: company.phone || current.phone, email: company.email || current.email, zipCode: company.zipCode || current.zipCode, street: company.street || current.street, number: company.number || current.number, complement: company.complement || current.complement, district: company.district || current.district, city: company.city || current.city, state: company.state || current.state }))
      setLookup("Dados preenchidos pelo CNPJ. Confira antes de salvar.")
    }).catch((reason) => setLookup(reason instanceof Error ? `${reason.message} Preencha à mão.` : "Não foi possível consultar o CNPJ."))
  }, [open, party.document, party.personType]) // eslint-disable-line react-hooks/exhaustive-deps

  function fromId(parsed: ParsedIdDocument) {
    setParty((current) => ({ ...current, personType: "PF", name: parsed.name ? titleCase(parsed.name) : current.name, document: parsed.cpf || current.document, commercialNotes: [String(current.commercialNotes || "").trim(), idDocumentNotes(parsed)].filter(Boolean).join("\n") }))
  }
  async function save() {
    setSaving(true)
    try {
      const { party: saved } = await api<{ party: Row }>("/api/comercial/parties", { method: "POST", body: JSON.stringify({ party }) })
      toast({ title: "Cliente cadastrado", description: "Entrou como lead e vira cliente quando a venda for fechada." })
      onSaved(saved.clientId)
    } catch (reason) {
      toast({ title: "Não foi possível cadastrar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Cadastrar cliente rapidamente</DialogTitle><DialogDescription>Só o essencial: o cadastro completo pode ser feito depois em Clientes &amp; Fornecedores.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Opts label="Pessoa" value={party.personType} onChange={(value) => setParty({ ...party, personType: value || "PJ" })} items={[{ value: "PJ", label: "Jurídica (CNPJ)" }, { value: "PF", label: "Física (CPF)" }]} />
          {party.personType === "PF" ? <IdDocumentCapture onRead={fromId} /> : null}
          <TextField label={party.personType === "PF" ? "CPF" : "CNPJ"} value={party.document} onChange={(value) => setParty({ ...party, document: value })} />
          {lookup ? <p className="text-xs text-muted-foreground">{lookup}</p> : null}
          <TextField label={party.personType === "PF" ? "Nome completo *" : "Razão social *"} value={party.name} onChange={(value) => setParty({ ...party, name: value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Telefone / WhatsApp *" value={party.phone} onChange={(value) => setParty({ ...party, phone: value })} />
            <TextField label="E-mail" value={party.email} onChange={(value) => setParty({ ...party, email: value })} />
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} disabled={saving || !party.name.trim() || !party.phone.trim()}>{saving ? "Salvando..." : "Cadastrar"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function JourneyPage({ opportunityId: initialId }: { opportunityId: string }) {
  const { toast } = useCrudFeedback()
  const params = useSearchParams()
  const [id, setId] = useState(initialId === "novo" ? "" : initialId)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [lookups, setLookups] = useState<{ parties: Row[]; salespeople: Row[]; products: CatalogProduct[] } | null>(null)
  const [step, setStep] = useState<JourneyStep>("oportunidade")
  const [loading, setLoading] = useState(Boolean(initialId !== "novo"))
  const [error, setError] = useState("")
  const picked = useRef(false)

  const loadLookups = useCallback(async () => {
    const [parties, people, options] = await Promise.all([api<{ parties: Row[] }>("/api/comercial/parties"), api<{ salespeople: Row[] }>("/api/comercial/salespeople"), api<{ products: CatalogProduct[] }>("/api/comercial/options")])
    setLookups({ parties: parties.parties, salespeople: people.salespeople, products: options.products })
  }, [])
  const refresh = useCallback(async (currentId = id) => {
    if (!currentId) return null
    try {
      const data = await api<Journey>(`/api/comercial/jornada/${currentId}`)
      setJourney(data); setError("")
      return data
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a jornada."); return null } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void loadLookups().catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar listas.")) }, [loadLookups])
  useEffect(() => { void refresh() }, [refresh])

  const state = useMemo(() => ({ opportunity: journey ? { id: journey.opportunity.id as string, stage: journey.opportunity.stage as string } : null, quote: journey?.quote ? { id: journey.quote.id as string, status: journey.quote.status as string } : null, order: journey?.order ? { id: journey.order.id as string, status: journey.order.status as string } : null }), [journey])
  const available = stepAvailability(state)

  // etapa inicial: a da URL (?etapa=) se estiver disponível; senão a mais avançada. Atualizar a página não perde o progresso: tudo vem do banco.
  useEffect(() => {
    if (!journey || picked.current) return
    picked.current = true
    const wanted = params.get("etapa")
    setStep(isJourneyStep(wanted) && stepAvailability(state)[wanted] ? wanted : defaultStep(state))
  }, [journey, params, state])
  function goTo(next: JourneyStep) {
    setStep(next)
    const url = new URL(window.location.href)
    url.searchParams.set("etapa", next)
    window.history.replaceState(null, "", url.toString())
  }
  function saved(opportunity: Row, next?: JourneyStep) {
    // nova oportunidade: o endereço passa a ser o da jornada dela, sem recarregar a página
    if (!id) {
      setId(opportunity.id)
      window.history.replaceState(null, "", `/comercial/jornada/${opportunity.id}${next ? `?etapa=${next}` : ""}`)
    }
    picked.current = true
    void refresh(opportunity.id).then(() => { if (next) setStep(next) })
  }

  const opp = journey?.opportunity
  const order = journey?.order
  const value = order ? Number(order.totalAmount) : opp ? Number(opp.estimatedValue) : 0
  const statusText = order ? `Pedido ${order.status}` : journey?.quote ? `Proposta ${journey.quote.status}` : opp?.stage || "Nova"

  return (
    <PageShell title="Jornada da venda" description="Da oportunidade ao acompanhamento da entrega, tudo nesta página."
      actions={<><Button variant="outline" asChild><Link href="/comercial"><ArrowLeft className="h-4 w-4" />Voltar ao CRM</Link></Button><Button variant="outline" onClick={() => void refresh()} disabled={!id || loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button></>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Fact label="Cliente" value={opp?.clientName || "A definir"} />
        <Fact label="Oportunidade" value={opp?.code || "Nova"} />
        <Fact label="Vendedor" value={opp?.salespersonName && opp.salespersonName !== "-" ? opp.salespersonName : "A definir"} />
        <Fact label="Produto negociado" value={opp?.interest || "A definir"} />
        <Fact label="Valor da venda" value={brl(value)} />
        <div><div className="text-xs text-muted-foreground">Status</div><div className="mt-0.5"><StatusBadge status={statusText} /></div></div>
      </div>

      <nav aria-label="Etapas da venda" className="flex flex-wrap items-center gap-2">
        {journeySteps.map((item, index) => {
          const open = available[item]
          const done = (item === "oportunidade" && Boolean(opp)) || (item === "proposta" && Boolean(journey?.quote)) || (item === "fechamento" && (opp?.stage === "Ganho" || Boolean(order))) || (item === "pedido" && Boolean(order && orderConfirmed(order.status))) || (item === "acompanhamento" && Boolean(order && ["Atendido", "Entregue"].includes(order.status)))
          return (
            <div key={item} className="flex items-center gap-2">
              <button type="button" disabled={!open} onClick={() => goTo(item)} aria-current={step === item ? "step" : undefined} title={open ? "" : "Disponível quando a etapa anterior for concluída"}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${step === item ? "border-primary bg-primary text-primary-foreground" : open ? "bg-card hover:bg-muted" : "cursor-not-allowed bg-muted/40 text-muted-foreground opacity-70"}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : open ? <CircleDashed className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}{index + 1}. {journeyLabels[item]}
              </button>
              {index < journeySteps.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
            </div>
          )
        })}
      </nav>

      {loading && !journey && id ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando a jornada...</p> : null}

      {step === "oportunidade" && lookups ? <OpportunityStep key={id || "novo"} journey={journey} lookups={lookups} reloadLookups={loadLookups} onSaved={saved} onCreateProposal={() => goTo("proposta")} /> : null}
      {step === "proposta" && id ? (
        <EmbeddedPageContext.Provider value>
          <QuotesPage opportunityId={id} onChanged={() => void refresh()} onOrderCreated={() => { void refresh().then(() => goTo("pedido")) }} />
        </EmbeddedPageContext.Provider>
      ) : null}
      {step === "fechamento" && journey ? <ClosingStep journey={journey} onClosed={() => { void refresh().then(() => goTo("pedido")) }} toast={toast} /> : null}
      {step === "pedido" && order ? (
        <EmbeddedPageContext.Provider value>
          <SalesDetailPage id={order.id} embedded onChanged={() => void refresh()} />
        </EmbeddedPageContext.Provider>
      ) : null}
      {step === "acompanhamento" && journey ? <TrackingStep journey={journey} /> : null}
    </PageShell>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="truncate font-medium" title={value}>{value}</div></div>
}

// ---------------------------------------------------------------- 1. Oportunidade

function OpportunityStep({ journey, lookups, reloadLookups, onSaved, onCreateProposal }: { journey: Journey | null; lookups: { parties: Row[]; salespeople: Row[]; products: CatalogProduct[] }; reloadLookups: () => Promise<void>; onSaved: (opportunity: Row, next?: JourneyStep) => void; onCreateProposal: () => void }) {
  const { toast } = useCrudFeedback()
  const existing = journey?.opportunity || null
  const locked = Boolean(existing && ["Ganho"].includes(existing.stage))
  const [form, setForm] = useState<Row>(() => existing ? { ...existing, items: (existing.items || []).map((line: Row) => ({ productId: line.productId, description: line.description, unit: line.unit, quantity: String(line.quantity), unitPrice: String(line.unitPrice) })) } : { title: "", clientId: "", salespersonId: "", origin: "", interest: "", estimatedValue: "", stage: "Novo lead", probability: "10", items: [], expectedCloseDate: "", nextContactDate: "" })
  const [saving, setSaving] = useState(false)
  const [quickClient, setQuickClient] = useState(false)
  const [history, setHistory] = useState<Row[]>([])
  const [note, setNote] = useState({ kind: "Observação", description: "" })

  const clientItems = lookups.parties.filter((row) => row.clientId && row.status !== "Inativo").map((row) => ({ value: row.clientId as string, label: `${row.name}${row.status === "Prospect" ? " (lead)" : ""}${row.document ? ` · ${row.document}` : ""}` }))
  const salesItems = lookups.salespeople.filter((row) => row.status === "Ativo").map((row) => ({ value: row.id as string, label: row.name as string }))
  const items: OppItem[] = form.items || []
  const total = itemsTotal(items)

  useEffect(() => {
    if (!existing?.id) return
    api<{ interactions: Row[] }>(`/api/comercial/opportunities/${existing.id}`).then((data) => setHistory(data.interactions)).catch(() => undefined)
  }, [existing?.id])

  async function save() {
    setSaving(true)
    try {
      const { opportunity } = await api<{ opportunity: Row }>("/api/comercial/opportunities", { method: "POST", body: JSON.stringify({ opportunity: {
        ...form, id: existing?.id || undefined, estimatedValue: items.length ? total : Number(form.estimatedValue) || 0,
        items: items.map((line) => ({ productId: line.productId, description: line.description, unit: line.unit, quantity: Number(String(line.quantity).replace(",", ".")), unitPrice: Number(String(line.unitPrice).replace(",", ".")) })),
      } }) })
      toast({ title: "Oportunidade salva" })
      onSaved(opportunity)
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally { setSaving(false) }
  }
  async function addNote() {
    if (!existing?.id || !note.description.trim()) return
    try {
      const data = await api<{ interactions: Row[] }>(`/api/comercial/opportunities/${existing.id}`, { method: "POST", body: JSON.stringify({ interaction: note }) })
      setHistory(data.interactions); setNote({ ...note, description: "" })
    } catch (reason) { toast({ title: "Não foi possível registrar", description: reason instanceof Error ? reason.message : "", variant: "destructive" }) }
  }

  return (
    <SectionCard title="1. Oportunidade" description={locked ? "Venda fechada: a oportunidade fica só para consulta." : "Cliente, vendedor, produtos e observações da negociação."}>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Título da negociação *" value={form.title} onChange={(value) => !locked && setForm({ ...form, title: value })} />
        <div>
          <SearchableSelectField label="Cliente / lead *" value={form.clientId || none} onChange={(value) => !locked && setForm({ ...form, clientId: value === none ? "" : value })} options={[{ value: none, label: "Selecione" }, ...clientItems]} />
          {locked ? null : <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline" onClick={() => setQuickClient(true)}><UserPlus className="h-3 w-3" />Cadastrar cliente rapidamente</button>}
        </div>
        <Opts label="Vendedor responsável *" value={form.salespersonId} onChange={(value) => !locked && setForm({ ...form, salespersonId: value })} items={salesItems} />
        <Opts label="Origem" value={form.origin} onChange={(value) => !locked && setForm({ ...form, origin: value })} items={leadOrigins.map((value) => ({ value, label: value }))} />
        <div className="md:col-span-2">
          <OpportunityItemsEditor items={items} products={lookups.products} disabled={locked} onChange={(next) => setForm({ ...form, items: next, estimatedValue: String(itemsTotal(next)) })} />
        </div>
        {items.length ? null : <>
          <TextField label="Produto / serviço de interesse *" value={form.interest} onChange={(value) => !locked && setForm({ ...form, interest: value })} />
          <TextField label="Valor estimado" type="number" value={form.estimatedValue} onChange={(value) => !locked && setForm({ ...form, estimatedValue: value })} />
        </>}
        <TextField label="Previsão de fechamento" type="date" value={form.expectedCloseDate} onChange={(value) => !locked && setForm({ ...form, expectedCloseDate: value })} />
        <TextField label="Próximo contato" type="date" value={form.nextContactDate} onChange={(value) => !locked && setForm({ ...form, nextContactDate: value })} />
      </div>
      {locked ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving || !form.title?.trim() || !form.clientId || !form.salespersonId}>{saving ? "Salvando..." : "Salvar oportunidade"}</Button>
          {existing?.id ? <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700" onClick={onCreateProposal}>CRIAR PROPOSTA</Button> : <span className="text-xs text-muted-foreground">Depois de salvar aparece o botão CRIAR PROPOSTA.</span>}
        </div>
      )}
      {existing?.id ? (
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold">Observações e acompanhamento da negociação</h3>
          {locked ? null : (
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
              <Opts label="Tipo" value={note.kind} onChange={(value) => setNote({ ...note, kind: value || "Observação" })} items={interactionKinds.map((value) => ({ value, label: value }))} />
              <TextAreaField label="O que aconteceu" value={note.description} onChange={(value) => setNote({ ...note, description: value })} />
              <Button variant="outline" onClick={() => void addNote()} disabled={!note.description.trim()}>Registrar</Button>
            </div>
          )}
          <ul className="space-y-2 text-sm">
            {history.length ? history.map((item) => <li key={item.id} className="rounded-md border p-2"><span className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString("pt-BR")} · {item.kind}{item.author ? ` · ${item.author}` : ""}</span><div>{item.description}</div></li>) : <li className="text-muted-foreground">Nenhum registro ainda.</li>}
          </ul>
        </div>
      ) : null}
      <QuickClientDialog open={quickClient} onClose={() => setQuickClient(false)} onSaved={(clientId) => { setQuickClient(false); void reloadLookups().then(() => setForm((current: Row) => ({ ...current, clientId }))) }} />
    </SectionCard>
  )
}

// ---------------------------------------------------------------- 3. Fechamento

function ClosingStep({ journey, onClosed, toast }: { journey: Journey; onClosed: () => void; toast: (input: { title: string; description?: string; variant?: "destructive" }) => void }) {
  const quote = journey.quote
  const won = journey.opportunity.stage === "Ganho"
  const [detail, setDetail] = useState<Row | null>(null)
  const [engineering, setEngineering] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")

  useEffect(() => {
    if (!quote) return
    api<Row>(`/api/orcamentos/${quote.id}`).then(setDetail).catch((reason) => setFailure(reason instanceof Error ? reason.message : "Erro ao ler a proposta."))
    api<{ products: Array<{ id: string; hasEngineering?: boolean }> }>("/api/orcamentos/options").then((options) => setEngineering(new Set(options.products.filter((product) => product.hasEngineering).map((product) => product.id)))).catch(() => undefined)
  }, [quote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const checks = useMemo(() => {
    if (!detail) return []
    const items: Row[] = detail.items || []
    return closingChecks({
      clientId: detail.quote?.clientId || "", totalAmount: Number(detail.quote?.totalAmount || 0), paymentConditionId: detail.quote?.paymentConditionId || "", deliveryTerm: detail.quote?.deliveryText || "",
      items: items.map((item) => ({ lineType: item.lineType, catalogId: item.catalogId, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), configurationId: item.configurationId || "", requiresConfiguration: engineering.has(item.catalogId), configurationStatus: item.configuration?.status || "" })),
    })
  }, [detail, engineering])
  const ready = checks.length > 0 && checks.every((check) => check.ok)

  async function close() {
    if (!quote) return
    setBusy(true); setFailure("")
    try {
      const { opportunity } = await api<{ opportunity: Row }>("/api/comercial/opportunities", { method: "POST", body: JSON.stringify({ opportunity: { ...journey.opportunity, stage: "Ganho", quoteId: quote.id, quoteNumber: quote.number, items: (journey.opportunity.items || []).map((line: Row) => ({ productId: line.productId, description: line.description, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice })) } }) })
      toast({ title: "Venda fechada", description: opportunity.salesOrder ? `Pedido ${opportunity.salesOrder.number} gerado${opportunity.salesOrder.confirmed ? " e já enviado para a produção (esteira e chassi)" : ""}.` : "Oportunidade marcada como ganha." })
      onClosed()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "Não foi possível fechar a venda.")
    } finally { setBusy(false) }
  }

  if (!quote) return <SectionCard title="3. Fechamento"><p className="text-sm text-muted-foreground">Monte a proposta primeiro.</p></SectionCard>
  return (
    <SectionCard title="3. Fechamento" description={won ? "Venda fechada: proposta aceita e oportunidade ganha." : "Quando o cliente aceitar a proposta, confira os pontos abaixo e feche a venda."}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><span>Proposta <b>{quote.number}</b> v{quote.version}</span><StatusBadge status={quote.status} /><span>Total <b>{brl(quote.totalAmount)}</b></span></div>
      <ul className="mb-4 grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <li key={check.key} className={`flex items-start gap-2 rounded-md border p-3 text-sm ${check.ok ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            {check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}<span><b>{check.label}.</b> {check.detail}</span>
          </li>
        ))}
        {!checks.length && !failure ? <li className="text-sm text-muted-foreground">Conferindo a proposta...</li> : null}
      </ul>
      {failure ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{failure}</p> : null}
      {won ? <p className="rounded-md border bg-muted/40 p-3 text-sm">Venda fechada. Siga para o Pedido.</p> : (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!ready || busy} onClick={() => void close()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}FECHAR VENDA</Button>
          <span className="text-xs text-muted-foreground">Registra o aceite (com a aprovação e o limite de desconto de sempre), marca a oportunidade como GANHA e prepara o pedido de venda.</span>
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------- 5. Acompanhamento

function TrackingStep({ journey }: { journey: Journey }) {
  const order = journey.order
  if (!order) return <SectionCard title="5. Acompanhamento"><p className="text-sm text-muted-foreground">Disponível depois do pedido de venda.</p></SectionCard>
  return (
    <div className="space-y-4">
      <SectionCard title="Produção" description={`Pedido ${order.number}: acompanhamento da fábrica (só consulta; a operação continua na Produção).`}>
        {journey.production.length ? journey.production.map((po) => (
          <div key={po.id} className="mb-4 last:mb-0">
            <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><b>{po.code}</b><span>{po.product}</span><StatusBadge status={po.status} /><span className="text-muted-foreground">{po.produced}/{po.quantity} produzida(s) · previsão {day(po.plannedEnd)}{po.responsible ? ` · ${po.responsible}` : ""}</span></div>
            <DataTable headers={["Unidade", "Chassi", "Etapa atual", "Situação da etapa", "Responsável", "Progresso", "Previsão da etapa"]} empty={!po.units.length}>
              {po.units.map((unit: Row) => (
                <TableRow key={unit.unit}>
                  <TableCell>{unit.unit}</TableCell><TableCell className="font-mono text-xs">{unit.vin || "a informar"}</TableCell><TableCell>{unit.step}</TableCell><TableCell><StatusBadge status={unit.stepStatus} /></TableCell>
                  <TableCell>{unit.responsible || "-"}</TableCell><TableCell>{unit.progress}%</TableCell><TableCell>{day(unit.plannedEnd)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        )) : <p className="text-sm text-muted-foreground">Nenhuma ordem de produção vinculada ainda.</p>}
      </SectionCard>

      <SectionCard title="Documentação veicular" description="Processo documental de cada unidade (consulta).">
        <DataTable headers={["Unidade", "Chassi/VIN", "Protocolo", "Situação", "Etapa final", "Pendências", "Responsável"]} empty={!journey.documentation.length}>
          {journey.documentation.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell>{doc.unit}</TableCell><TableCell className="font-mono text-xs">{doc.vin || "a informar"}</TableCell><TableCell>{doc.protocol || "-"}</TableCell><TableCell><StatusBadge status={doc.status} /></TableCell>
              <TableCell>{doc.finalStage}</TableCell><TableCell className="max-w-xs text-xs">{(doc.pendencies as unknown[]).length ? (doc.pendencies as Array<Row | string>).map((item) => (typeof item === "string" ? item : item.message || item.label || JSON.stringify(item))).join("; ") : "-"}</TableCell><TableCell>{doc.responsible || "-"}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        {journey.documentation.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">A documentação das unidades é iniciada no pedido (etapa Pedido).</p> : null}
      </SectionCard>

      <SectionCard title="Entrega" description={order.deliveryDate ? `Previsão de entrega do pedido: ${day(order.deliveryDate)}.` : "Sem previsão de entrega informada no pedido."}>
        <DataTable headers={["Quando", "Itens", "Por"]} empty={!journey.deliveries.length}>
          {journey.deliveries.map((delivery) => (
            <TableRow key={delivery.id}><TableCell>{new Date(delivery.at).toLocaleString("pt-BR")}</TableCell><TableCell>{(delivery.items as Row[]).map((line) => `${line.quantity} × ${line.description}`).join("; ")}</TableCell><TableCell>{delivery.by || "-"}</TableCell></TableRow>
          ))}
        </DataTable>
        {journey.deliveries.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nenhuma entrega registrada ainda. Situação do pedido: {order.status}.</p> : null}
      </SectionCard>
    </div>
  )
}

