"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Ban, FilePlus2, Loader2, Plus, RefreshCw, RotateCcw, Search, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, SectionCard } from "@/components/operations/shared"
import { TableCell, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { EMISSION_STATUS_LABEL, describeWithChassis, digits, itemTotal, parseDecimal, payloadTotal, validateCancelReason, validateEmission, type EmissionItem, type EmissionPayload, type EmissionRecipient, type EmissionStatus } from "@/lib/nfe-emission"

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const stamp = (value?: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-")
const selectClass = "mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"

async function call<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`)
  return payload as T
}

const CFOPS = [["5102", "5102 - Venda de mercadoria (adquirida de terceiros)"], ["5101", "5101 - Venda de produção do estabelecimento"], ["5405", "5405 - Venda de mercadoria com ST"], ["5401", "5401 - Venda de produção com ST"], ["6102", "6102 - Venda de mercadoria (outro estado)"], ["6101", "6101 - Venda de produção (outro estado)"], ["5949", "5949 - Outra saída não especificada"]] as const
const PAYMENT_FORMS = [["01", "01 - Dinheiro"], ["02", "02 - Cheque"], ["03", "03 - Cartão de crédito"], ["04", "04 - Cartão de débito"], ["15", "15 - Boleto bancário"], ["16", "16 - Depósito bancário"], ["17", "17 - PIX"], ["18", "18 - Transferência bancária"], ["90", "90 - Sem pagamento"], ["99", "99 - Outros"]] as const
const CSOSN = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]
const PIS_COFINS_CST = ["01", "02", "04", "05", "06", "07", "08", "09", "49", "99"]
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]

const emptyTax = () => ({ cst: "", aliquota: "", base: "", valor: "" })
const emptyRecipient = (): EmissionRecipient => ({ source: "manual", personType: "PJ", document: "", name: "", stateRegistration: "", ieIndicator: "1", zip: "", street: "", number: "", complement: "", district: "", state: "PR", city: "", email: "", phone: "", operationDestination: "1" })
const emptyItem = (cfop: string): EmissionItem => ({ code: "", description: "", ncm: "", quantity: "1", unitPrice: "", unit: "UN", gtin: "SEM GTIN", cfop, origin: "0", icms: { ...emptyTax(), cst: "102" }, pis: { ...emptyTax(), cst: "49" }, cofins: { ...emptyTax(), cst: "49" }, ipi: emptyTax() })

type Emission = { id: string; status: EmissionStatus; recipient_name: string | null; total_amount: number | null; nf_number: string | null; error: string | null; error_seen: boolean; events: Array<{ at: string; text: string }>; created_at: string; cancel_reason: string | null; created_by: string | null }

/** Campo de busca que consulta o ERP enquanto se digita e mostra uma lista para escolher. */
function RemotePicker<T extends { id: string }>({ label, placeholder, fetcher, render, onPick }: { label: string; placeholder: string; fetcher: (term: string) => Promise<T[]>; render: (row: T) => string; onPick: (row: T) => void }) {
  const [term, setTerm] = useState("")
  const [rows, setRows] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!open) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => { setBusy(true); try { setRows(await fetcher(term)) } catch { setRows([]) } finally { setBusy(false) } }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [term, open, fetcher])
  return (
    <div className="relative">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={term} onChange={(event) => { setTerm(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} placeholder={placeholder} className="pl-8" />
        {busy ? <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-md">
          {rows.length ? rows.map((row) => (
            <button key={row.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onPick(row); setOpen(false); setTerm("") }} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">{render(row)}</button>
          )) : <div className="px-3 py-2 text-sm text-muted-foreground">{busy ? "Buscando..." : "Nada encontrado."}</div>}
        </div>
      ) : null}
    </div>
  )
}

const field = (label: string, children: React.ReactNode, className = "") => <label className={`block text-xs text-muted-foreground ${className}`}>{label}{children}</label>

export function NfeEmissionPanel() {
  const { toast } = useToast()
  const [header, setHeader] = useState<EmissionPayload["header"]>({ cfop: "5102", nature: "Venda de mercadoria", purpose: "1", finalConsumer: "0", presence: "" })
  const [recipient, setRecipient] = useState<EmissionRecipient>(emptyRecipient())
  const [items, setItems] = useState<EmissionItem[]>([emptyItem("5102")])
  const [payment, setPayment] = useState({ indicator: "0" as "0" | "1", form: "17", value: "", description: "" })
  const [paymentTouched, setPaymentTouched] = useState(false)
  const [transport, setTransport] = useState("9")
  const [info, setInfo] = useState("")
  const [quote, setQuote] = useState<{ id: string; number: string; total: number } | null>(null)
  const [history, setHistory] = useState<Emission[]>([])
  const [unseen, setUnseen] = useState(0)
  const [canEmit, setCanEmit] = useState(true)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState("")
  const [cancelFor, setCancelFor] = useState<Emission | null>(null)
  const [reason, setReason] = useState("")
  const [detail, setDetail] = useState<Emission | null>(null)
  const lastUnseen = useRef(0)

  const total = useMemo(() => payloadTotal({ items }), [items])
  useEffect(() => { if (!paymentTouched) setPayment((current) => ({ ...current, value: total ? total.toFixed(2).replace(".", ",") : "" })) }, [total, paymentTouched])

  const payload: EmissionPayload = useMemo(() => ({ header, recipient, items, payment: { ...payment, value: payment.value || total.toFixed(2) }, transport: { mode: transport }, additionalInfo: info, quoteId: quote?.id }), [header, recipient, items, payment, total, transport, info, quote])
  const problems = useMemo(() => validateEmission(payload), [payload])

  const loadHistory = useCallback(async (markSeen = false) => {
    try {
      const data = await call<{ emissions: Emission[]; unseenErrors: number; canEmit: boolean }>(`/api/financeiro/nf/emissao${markSeen ? "?vistos=1" : ""}`)
      setHistory(data.emissions); setCanEmit(data.canEmit)
      if (!markSeen) {
        setUnseen(data.unseenErrors)
        if (data.unseenErrors > lastUnseen.current) toast({ title: "Erro na emissão de NF-e", description: "Veja o histórico logo abaixo para entender o que aconteceu.", variant: "destructive" })
        lastUnseen.current = data.unseenErrors
      }
    } catch { /* o histórico tenta de novo no próximo ciclo */ }
  }, [toast])
  useEffect(() => { void loadHistory() }, [loadHistory])
  const active = history.some((row) => ["pendente", "emitindo", "cancelando"].includes(row.status))
  useEffect(() => { const timer = setInterval(() => void loadHistory(), active ? 4000 : 20000); return () => clearInterval(timer) }, [active, loadHistory])

  const searchClients = useCallback(async (term: string) => (await call<{ clients: Array<{ id: string; name: string; document: string; place: string }> }>(`/api/financeiro/nf/emissao/opcoes?tipo=clientes&q=${encodeURIComponent(term)}`)).clients, [])
  const searchQuotes = useCallback(async (term: string) => (await call<{ quotes: Array<{ id: string; number: string; title: string; client: string; total: number; status: string }> }>(`/api/financeiro/nf/emissao/opcoes?tipo=orcamentos&q=${encodeURIComponent(term)}`)).quotes, [])
  const searchChassis = useCallback(async (term: string) => (await call<{ chassis: Array<{ id: string; vin: string; product: string; client: string; status: string }> }>(`/api/financeiro/nf/emissao/opcoes?tipo=chassis&q=${encodeURIComponent(term)}&clienteId=${encodeURIComponent(recipient.clientId || "")}`)).chassis, [recipient.clientId])

  const setRecipientField = <K extends keyof EmissionRecipient>(key: K, value: EmissionRecipient[K]) => setRecipient((current) => ({ ...current, [key]: value }))
  const updateItem = (index: number, patch: Partial<EmissionItem>) => setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  const updateTax = (index: number, key: "icms" | "pis" | "cofins" | "ipi", patch: Partial<EmissionItem["icms"]>) => setItems((list) => list.map((item, i) => (i === index ? { ...item, [key]: { ...item[key], ...patch } } : item)))

  async function pickClient(row: { id: string }) {
    try { const data = await call<{ recipient: EmissionRecipient }>(`/api/financeiro/nf/emissao/opcoes?tipo=cliente&id=${row.id}`); setRecipient(data.recipient) } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível carregar o cliente.") }
  }
  async function pickQuote(row: { id: string }) {
    try {
      const data = await call<{ quote: { id: string; number: string; total: number }; items: Array<{ quoteItemId: string; code: string; description: string; ncm: string; unit: string; quantity: number; unitPrice: number; origin: string }>; recipient: EmissionRecipient | null }>(`/api/financeiro/nf/emissao/opcoes?tipo=orcamento&id=${row.id}`)
      setQuote({ id: data.quote.id, number: data.quote.number, total: data.quote.total })
      if (data.recipient && !recipient.document) setRecipient(data.recipient)
      if (data.items.length) setItems(data.items.map((item) => ({ ...emptyItem(header.cfop), quoteItemId: item.quoteItemId, code: item.code, description: item.description, ncm: item.ncm, unit: item.unit, quantity: String(item.quantity).replace(".", ","), unitPrice: item.unitPrice.toFixed(2).replace(".", ","), origin: item.origin || "0" })))
      setPaymentTouched(false)
      setMessage(`Orçamento ${data.quote.number} carregado: confira os itens e informe os impostos.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível carregar o orçamento.") }
  }
  function pickChassi(index: number, row: { id: string; vin: string }) {
    const item = items[index]
    updateItem(index, { vin: row.vin, vehicleDocId: row.id, description: describeWithChassis(item.description.replace(/\s*COD\s*\(\s*\d*\s*\)\s*[A-Z0-9]{8,20}\s*$/i, ""), row.vin, item.code) })
  }

  async function emit() {
    if (problems.length) { setMessage(problems[0]); return }
    if (!window.confirm(`Emitir a NF-e de ${brl(total)} para ${recipient.name}?\n\nA nota será assinada e transmitida à SEFAZ de verdade, sem passar pelo NFeMail.`)) return
    setSending(true); setMessage("")
    try {
      await call("/api/financeiro/nf/emissao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) })
      setMessage("Pedido enviado: acompanhe o andamento no histórico abaixo.")
      await loadHistory()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível pedir a emissão.") } finally { setSending(false) }
  }

  async function act(id: string, body: Record<string, string>) {
    try { await call(`/api/financeiro/nf/emissao/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await loadHistory() } catch (error) { toast({ title: "Não foi possível concluir", description: error instanceof Error ? error.message : "Erro", variant: "destructive" }) }
  }
  async function confirmCancel() {
    if (!cancelFor) return
    const invalid = validateCancelReason(reason)
    if (invalid) { toast({ title: invalid, variant: "destructive" }); return }
    await act(cancelFor.id, { acao: "cancelar", motivo: reason.trim() })
    setCancelFor(null); setReason("")
  }

  const statusTone: Record<EmissionStatus, string> = { pendente: "bg-amber-100 text-amber-900", emitindo: "bg-blue-100 text-blue-900", emitida: "bg-green-100 text-green-900", erro: "bg-red-100 text-red-900", cancelando: "bg-amber-100 text-amber-900", cancelada: "bg-zinc-200 text-zinc-800" }

  return (
    <div className="space-y-4">
      {unseen > 0 ? (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1"><strong>{unseen === 1 ? "Uma emissão deu erro." : `${unseen} emissões deram erro.`}</strong> Veja o motivo no histórico abaixo (linhas em vermelho).</div>
          <Button size="sm" variant="outline" onClick={() => { void loadHistory(true).then(() => { setUnseen(0); lastUnseen.current = 0 }) }}>Marcar como visto</Button>
        </div>
      ) : null}
      {!canEmit ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">A emissão roda no servidor próprio do sistema. Acesse pelo endereço do servidor para emitir; aqui você só consulta o histórico.</div> : null}

      <SectionCard title="Emitir NF-e de venda (NFeMail)" description="Os mesmos campos do NFeMail. Escolha o cliente e o orçamento para vir tudo preenchido, ou digite à mão. Ao emitir, a nota é transmitida na hora, lançada no Contas a receber (aberta) e na Contabilidade (saída).">
        <div className="grid gap-3 md:grid-cols-2">
          <RemotePicker label="Cliente cadastrado (preenche CNPJ e dados do destinatário)" placeholder="Buscar por nome ou CNPJ/CPF..." fetcher={searchClients} render={(row) => `${row.name} · ${row.document}${row.place ? ` · ${row.place}` : ""}`} onPick={pickClient} />
          <RemotePicker label="Orçamento (traz itens e valores; você informa só os impostos)" placeholder="Buscar por número ou título..." fetcher={searchQuotes} render={(row) => `${row.number} · ${row.title || row.client} · ${brl(row.total)} · ${row.status}`} onPick={pickQuote} />
        </div>
        {quote ? <p className="mt-2 text-xs text-muted-foreground">Orçamento {quote.number} (total do orçamento {brl(quote.total)}). <button type="button" className="underline" onClick={() => setQuote(null)}>desvincular</button></p> : null}

        <h4 className="mb-2 mt-5 text-sm font-semibold">Cabeçalho da nota</h4>
        <div className="grid gap-3 md:grid-cols-4">
          {field("CFOP padrão", <select className={selectClass} value={header.cfop} onChange={(event) => { setHeader({ ...header, cfop: event.target.value }); setItems((list) => list.map((item) => ({ ...item, cfop: event.target.value }))) }}>{CFOPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>, "md:col-span-2")}
          {field("Natureza da operação", <Input className="mt-1" value={header.nature} onChange={(event) => setHeader({ ...header, nature: event.target.value })} />, "md:col-span-2")}
          {field("Finalidade de emissão", <select className={selectClass} value={header.purpose} onChange={(event) => setHeader({ ...header, purpose: event.target.value as "1" })}><option value="1">1 - Normal</option><option value="2">2 - Complementar</option><option value="3">3 - Ajuste</option><option value="4">4 - Devolução/Retorno</option></select>)}
          {field("Consumidor final", <select className={selectClass} value={header.finalConsumer} onChange={(event) => setHeader({ ...header, finalConsumer: event.target.value as "0" })}><option value="0">0 - Não</option><option value="1">1 - Sim</option></select>)}
          {field("Presença do comprador", <select className={selectClass} value={header.presence} onChange={(event) => setHeader({ ...header, presence: event.target.value })}><option value="">Padrão do NFeMail</option><option value="0">0 - Não se aplica</option><option value="1">1 - Presencial</option><option value="2">2 - Não presencial, internet</option><option value="9">9 - Não presencial, outros</option></select>)}
          {field("Modalidade do frete", <select className={selectClass} value={transport} onChange={(event) => setTransport(event.target.value)}><option value="9">9 - Sem frete</option><option value="0">0 - Por conta do remetente (CIF)</option><option value="1">1 - Por conta do destinatário (FOB)</option><option value="2">2 - Por conta de terceiros</option><option value="3">3 - Transporte próprio, remetente</option><option value="4">4 - Transporte próprio, destinatário</option></select>)}
        </div>

        <h4 className="mb-2 mt-5 text-sm font-semibold">Destinatário</h4>
        <div className="grid gap-3 md:grid-cols-4">
          {field("Tipo", <select className={selectClass} value={recipient.personType} onChange={(event) => setRecipientField("personType", event.target.value as "PJ")}><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select>)}
          {field(recipient.personType === "PJ" ? "CNPJ" : "CPF", <Input className="mt-1" value={recipient.document} onChange={(event) => setRecipientField("document", digits(event.target.value))} inputMode="numeric" />)}
          {field(recipient.personType === "PJ" ? "Razão social" : "Nome", <Input className="mt-1" value={recipient.name} onChange={(event) => setRecipientField("name", event.target.value)} />, "md:col-span-2")}
          {field("Indicador da IE", <select className={selectClass} value={recipient.ieIndicator} onChange={(event) => setRecipientField("ieIndicator", event.target.value as "1")}><option value="1">1 - Contribuinte ICMS</option><option value="2">2 - Contribuinte isento</option><option value="9">9 - Não contribuinte</option></select>)}
          {field("Inscrição estadual", <Input className="mt-1" value={recipient.stateRegistration} onChange={(event) => setRecipientField("stateRegistration", event.target.value)} />)}
          {field("E-mail (envio da NF-e)", <Input className="mt-1" value={recipient.email} onChange={(event) => setRecipientField("email", event.target.value)} />)}
          {field("Telefone", <Input className="mt-1" value={recipient.phone} onChange={(event) => setRecipientField("phone", event.target.value)} />)}
          {field("CEP", <Input className="mt-1" value={recipient.zip} onChange={(event) => setRecipientField("zip", digits(event.target.value))} inputMode="numeric" />)}
          {field("Logradouro", <Input className="mt-1" value={recipient.street} onChange={(event) => setRecipientField("street", event.target.value)} />, "md:col-span-2")}
          {field("Número", <Input className="mt-1" value={recipient.number} onChange={(event) => setRecipientField("number", event.target.value)} />)}
          {field("Complemento", <Input className="mt-1" value={recipient.complement} onChange={(event) => setRecipientField("complement", event.target.value)} />)}
          {field("Bairro", <Input className="mt-1" value={recipient.district} onChange={(event) => setRecipientField("district", event.target.value)} />)}
          {field("Cidade", <Input className="mt-1" value={recipient.city} onChange={(event) => setRecipientField("city", event.target.value)} />)}
          {field("UF", <select className={selectClass} value={recipient.state} onChange={(event) => { setRecipientField("state", event.target.value); setRecipientField("operationDestination", event.target.value === "PR" ? "1" : "2") }}>{UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}</select>)}
          {field("Destino da operação", <select className={selectClass} value={recipient.operationDestination} onChange={(event) => setRecipientField("operationDestination", event.target.value as "1")}><option value="1">1 - Interna</option><option value="2">2 - Interestadual</option><option value="3">3 - Exterior</option></select>)}
        </div>

        <div className="mb-2 mt-5 flex items-center justify-between"><h4 className="text-sm font-semibold">Itens e impostos</h4><Button size="sm" variant="outline" onClick={() => setItems((list) => [...list, emptyItem(header.cfop)])}><Plus className="h-4 w-4" />Item</Button></div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-md border p-3">
              <div className="grid gap-3 md:grid-cols-6">
                {field("Código", <Input className="mt-1" value={item.code} onChange={(event) => updateItem(index, { code: event.target.value })} />)}
                {field("Descrição do item", <Input className="mt-1" value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} />, "md:col-span-3")}
                {field("NCM", <Input className="mt-1" value={item.ncm} onChange={(event) => updateItem(index, { ncm: digits(event.target.value) })} inputMode="numeric" />)}
                {field("Unidade", <Input className="mt-1" value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value.toUpperCase() })} />)}
                {field("Quantidade", <Input className="mt-1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} />)}
                {field("Valor unitário", <Input className="mt-1" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} placeholder="0,00" />)}
                {field("Total do item", <Input className="mt-1" value={itemTotal(item).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} readOnly />)}
                {field("GTIN (EAN)", <Input className="mt-1" value={item.gtin} onChange={(event) => updateItem(index, { gtin: event.target.value })} />)}
                {field("CFOP do item", <select className={selectClass} value={item.cfop} onChange={(event) => updateItem(index, { cfop: event.target.value })}>{CFOPS.map(([value]) => <option key={value} value={value}>{value}</option>)}</select>)}
                {field("Origem da mercadoria", <select className={selectClass} value={item.origin} onChange={(event) => updateItem(index, { origin: event.target.value })}>{["0", "1", "2", "3", "4", "5", "6", "7", "8"].map((origin) => <option key={origin} value={origin}>{origin}</option>)}</select>)}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <RemotePicker label="Chassi da Documentação Veicular (vai na descrição e entra em Chassis)" placeholder={item.vin ? `Chassi: ${item.vin}` : "Buscar chassi, modelo..."} fetcher={searchChassis} render={(row) => `${row.vin} · ${row.product}${row.client ? ` · ${row.client}` : ""}`} onPick={(row) => pickChassi(index, row)} />
                {field("ICMS: CSOSN (Simples) / CST", <select className={selectClass} value={item.icms.cst} onChange={(event) => updateTax(index, "icms", { cst: event.target.value })}><option value="">Escolha</option>{CSOSN.map((code) => <option key={code} value={code}>{code}</option>)}</select>)}
                {field("ICMS: alíquota %", <Input className="mt-1" value={item.icms.aliquota} onChange={(event) => updateTax(index, "icms", { aliquota: event.target.value })} placeholder="só se tributado" />)}
                {field("ICMS: valor R$", <Input className="mt-1" value={item.icms.valor} onChange={(event) => updateTax(index, "icms", { valor: event.target.value })} placeholder="calcula sozinho" />)}
                {field("PIS: situação (CST)", <select className={selectClass} value={item.pis.cst} onChange={(event) => updateTax(index, "pis", { cst: event.target.value })}><option value="">Escolha</option>{PIS_COFINS_CST.map((code) => <option key={code} value={code}>{code}</option>)}</select>)}
                {field("PIS: alíquota %", <Input className="mt-1" value={item.pis.aliquota} onChange={(event) => updateTax(index, "pis", { aliquota: event.target.value })} />)}
                {field("COFINS: situação (CST)", <select className={selectClass} value={item.cofins.cst} onChange={(event) => updateTax(index, "cofins", { cst: event.target.value })}><option value="">Escolha</option>{PIS_COFINS_CST.map((code) => <option key={code} value={code}>{code}</option>)}</select>)}
                {field("COFINS: alíquota %", <Input className="mt-1" value={item.cofins.aliquota} onChange={(event) => updateTax(index, "cofins", { aliquota: event.target.value })} />)}
                {field("IPI: situação (CST, opcional)", <Input className="mt-1" value={item.ipi.cst} onChange={(event) => updateTax(index, "ipi", { cst: event.target.value })} placeholder="ex.: 50" />)}
                {field("IPI: alíquota %", <Input className="mt-1" value={item.ipi.aliquota} onChange={(event) => updateTax(index, "ipi", { aliquota: event.target.value })} />)}
                <div className="flex items-end md:col-span-2">{items.length > 1 ? <Button variant="ghost" size="sm" onClick={() => setItems((list) => list.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" />Remover item</Button> : null}</div>
              </div>
            </div>
          ))}
        </div>

        <h4 className="mb-2 mt-5 text-sm font-semibold">Pagamento e informações</h4>
        <div className="grid gap-3 md:grid-cols-4">
          {field("Indicador de pagamento", <select className={selectClass} value={payment.indicator} onChange={(event) => setPayment({ ...payment, indicator: event.target.value as "0" })}><option value="0">0 - À vista</option><option value="1">1 - A prazo</option></select>)}
          {field("Forma de pagamento", <select className={selectClass} value={payment.form} onChange={(event) => setPayment({ ...payment, form: event.target.value })}>{PAYMENT_FORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          {field("Valor do pagamento", <Input className="mt-1" value={payment.value} onChange={(event) => { setPaymentTouched(true); setPayment({ ...payment, value: event.target.value }) }} />)}
          <div className="flex items-end text-sm font-semibold">Total da NF-e: {brl(total)}</div>
          {field("Informações complementares (aparecem na nota)", <Textarea className="mt-1" value={info} onChange={(event) => setInfo(event.target.value)} rows={2} />, "md:col-span-4")}
        </div>

        {problems.length ? <ul className="mt-4 list-disc space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-sm text-amber-900">{problems.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        {message ? <p className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">{message}</p> : null}
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void emit()} disabled={sending || !canEmit || problems.length > 0}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Emitir NF-e agora</Button>
          <span className="text-xs text-muted-foreground">A nota é transmitida de verdade, direto pelo sistema.</span>
        </div>
      </SectionCard>

      <SectionCard title="Histórico de emissões" description="Andamento de cada nota, erros (em vermelho) e cancelamento. Atualiza sozinho.">
        <div className="mb-2"><Button variant="outline" size="sm" onClick={() => void loadHistory()}><RefreshCw className="h-4 w-4" />Atualizar</Button></div>
        <DataTable headers={["Quando", "Destinatário", "Valor", "NF-e", "Situação", "Andamento / erro", "Ações"]} empty={!history.length}>
          {history.map((row) => (
            <TableRow key={row.id} className={row.error ? "bg-red-50/60" : undefined}>
              <TableCell className="whitespace-nowrap">{stamp(row.created_at)}</TableCell>
              <TableCell>{row.recipient_name || "-"}<div className="text-xs text-muted-foreground">{row.created_by}</div></TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(Number(row.total_amount || 0))}</TableCell>
              <TableCell className="whitespace-nowrap">{row.nf_number || "-"}</TableCell>
              <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${statusTone[row.status]}`}>{["emitindo", "cancelando", "pendente"].includes(row.status) ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}{EMISSION_STATUS_LABEL[row.status]}</span></TableCell>
              <TableCell className="min-w-[260px] max-w-[420px] whitespace-normal break-words text-xs">{row.error ? <span className="font-medium text-red-700">{row.error}</span> : row.events[row.events.length - 1]?.text || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">
                <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>Detalhes</Button>
                {row.status === "erro" && !row.nf_number ? <Button variant="ghost" size="sm" onClick={() => void act(row.id, { acao: "tentar-novamente" })}><RotateCcw className="h-4 w-4" />Tentar de novo</Button> : null}
                {row.status === "emitida" ? <Button variant="ghost" size="sm" className="text-red-700" onClick={() => { setCancelFor(row); setReason("") }}><Ban className="h-4 w-4" />Cancelar nota</Button> : null}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <Dialog open={Boolean(cancelFor)} onOpenChange={(open) => { if (!open) setCancelFor(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancelar NF-e {cancelFor?.nf_number}</DialogTitle><DialogDescription>O cancelamento é enviado à SEFAZ. O Contas a receber da nota é cancelado e a nota sai da Contabilidade. Só dá para cancelar dentro do prazo da SEFAZ e se não houver recebimento lançado.</DialogDescription></DialogHeader>
          <Label>Motivo (de 15 a 255 caracteres)</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Ex.: Nota emitida com valor incorreto" />
          <DialogFooter><Button variant="outline" onClick={() => setCancelFor(null)}>Voltar</Button><Button variant="destructive" onClick={() => void confirmCancel()}><Ban className="h-4 w-4" />Cancelar a nota</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle><FilePlus2 className="mr-2 inline h-4 w-4" />Emissão para {detail?.recipient_name}</DialogTitle><DialogDescription>{detail ? `${EMISSION_STATUS_LABEL[detail.status]} · ${brl(Number(detail.total_amount || 0))}${detail.nf_number ? ` · NF-e ${detail.nf_number}` : ""}` : ""}</DialogDescription></DialogHeader>
          {detail?.error ? <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{detail.error}</p> : null}
          <ol className="max-h-72 space-y-1 overflow-auto text-sm">{(detail?.events || []).map((event, index) => <li key={index}><span className="text-xs text-muted-foreground">{stamp(event.at)}</span> {event.text}</li>)}</ol>
        </DialogContent>
      </Dialog>
    </div>
  )
}
