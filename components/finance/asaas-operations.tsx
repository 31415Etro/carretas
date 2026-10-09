"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, FileCheck2, Loader2, RefreshCw, TrendingDown, TrendingUp, WalletCards } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { MetricCard, SectionCard, StatusBadge } from "@/components/operations/shared"
import type { OperationalState } from "@/lib/operational-storage"
import { money } from "@/lib/financial-storage"

type AccountCode = "services" | "materials"
type ApiResult = Record<string, any>

const today = () => new Date().toISOString().slice(0, 10)
const futureDate = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
const newKey = () => crypto.randomUUID()

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Falha na operacao (HTTP ${response.status}).`)
  return payload as ApiResult
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>
}

function AccountSelect({ value, onChange }: { value: AccountCode; onChange: (value: AccountCode) => void }) {
  return <Select value={value} onValueChange={(next) => onChange(next as AccountCode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="services">Conta de servicos</SelectItem><SelectItem value="materials">Conta de materiais</SelectItem></SelectContent></Select>
}

function ResultBox({ result }: { result: ApiResult | null }) {
  if (!result) return null
  const payment = result.payment || result.asaas || result.document || result.transfer || result.bill || result.billPayment || {}
  const pix = payment.pixQrCode || payment.pix_payload || payment.payload?.pixQrCode
  const pixPayload = pix?.payload || pix?.copyPaste || pix?.copy_paste
  const encodedImage = pix?.encodedImage || pix?.encoded_image
  const pixImage = encodedImage ? (String(encodedImage).startsWith("data:") ? String(encodedImage) : `data:image/png;base64,${encodedImage}`) : ""
  const boleto = payment.identificationField || payment.payload?.identificationField || {}
  const boletoCode = boleto.identificationField || boleto.barCode || boleto.bar_code
  const links = [
    ["Abrir cobranca", payment.invoiceUrl || payment.invoice_url],
    ["Baixar boleto", payment.bankSlipUrl || payment.bank_slip_url],
    ["Baixar PDF", payment.pdfUrl || payment.pdf_url || result.document?.pdf_url],
    ["Baixar XML", payment.xmlUrl || payment.xml_url || result.document?.xml_url],
    ["Comprovante", payment.transactionReceiptUrl || payment.receipt_url],
  ].filter((item) => item[1])
  return <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
    <strong>{result.message || "Operacao registrada com sucesso."}</strong>
    {payment.id || payment.asaas_payment_id ? <p>Identificador: {payment.id || payment.asaas_payment_id}</p> : null}
    {links.length ? <div className="flex flex-wrap gap-2">{links.map(([label, href]) => <Button key={label} size="sm" variant="outline" asChild><a href={String(href)} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />{label}</a></Button>)}</div> : null}
    {pixImage ? <div className="flex flex-wrap items-center gap-3"><img src={pixImage} alt="QR Code Pix" className="h-36 w-36 rounded border bg-white p-2" /><Button size="sm" variant="outline" asChild><a href={pixImage} download={`pix-${payment.id || payment.asaas_payment_id || "cobranca"}.png`}><Download className="h-4 w-4" />Baixar QR Code Pix</a></Button></div> : null}
    {pixPayload ? <div><Label>Pix copia e cola</Label><div className="mt-1 flex gap-2"><Input readOnly value={pixPayload} /><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(String(pixPayload))}>Copiar</Button></div></div> : null}
    {boletoCode ? <div><Label>Linha digitavel do boleto</Label><div className="mt-1 flex gap-2"><Input readOnly value={boletoCode} /><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(String(boletoCode))}>Copiar</Button></div></div> : null}
  </div>
}

type ReceivableChargeInput = {
  clientId: string
  serviceOrderId: string
  value: string | number
  dueDate: string
  description: string
}

export function AsaasReceivableChargePanel({ input, onCreated }: { input: ReceivableChargeInput; onCreated?: () => void | Promise<void> }) {
  const [mode, setMode] = useState<"internal" | "PIX" | "BOLETO">("internal")
  const [account, setAccount] = useState<AccountCode>("services")
  const [installmentCount, setInstallmentCount] = useState("1")
  const [idempotencyKey, setIdempotencyKey] = useState(newKey())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ApiResult | null>(null)

  async function submit() {
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const payload = await requestJson("/api/integrations/asaas/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account,
          clientId: input.clientId && input.clientId !== "nenhum" ? input.clientId : undefined,
          serviceOrderId: input.serviceOrderId && input.serviceOrderId !== "nenhuma" ? input.serviceOrderId : undefined,
          billingType: mode,
          value: Number(input.value),
          dueDate: input.dueDate,
          description: input.description,
          installmentCount: Number(installmentCount),
          idempotencyKey,
        }),
      })
      setResult(payload)
      setIdempotencyKey(newKey())
      await onCreated?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao gerar cobranca.")
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = mode !== "internal" && input.clientId && input.clientId !== "nenhum" && Number(input.value) > 0 && Boolean(input.dueDate) && Boolean(input.description)
  return <div className="space-y-4 rounded-md border bg-muted/20 p-4">
    <div><p className="font-semibold">Destino da conta a receber</p><p className="text-sm text-muted-foreground">Salve somente no financeiro ou emita uma cobranca que tambem ficara registrada no Contas a Receber.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Tipo de registro"><Select value={mode} onValueChange={(value) => { setMode(value as typeof mode); setError(""); setResult(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal">Somente registro interno</SelectItem><SelectItem value="PIX">Gerar PIX pelo Asaas</SelectItem><SelectItem value="BOLETO">Gerar boleto pelo Asaas</SelectItem></SelectContent></Select></Field>
      {mode !== "internal" ? <Field label="Conta Asaas"><AccountSelect value={account} onChange={setAccount} /></Field> : null}
      {mode !== "internal" ? <Field label="Parcelas"><Input type="number" min="1" max="60" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} /></Field> : null}
    </div>
    {mode === "internal" ? <p className="text-sm text-muted-foreground">Use o botao Salvar somente no financeiro abaixo. Nenhuma cobranca externa sera criada.</p> : <Button type="button" onClick={submit} disabled={loading || !canSubmit}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}Gerar {mode === "PIX" ? "PIX" : "boleto"} e salvar</Button>}
    {error ? <p className="text-sm text-red-600">{error}</p> : null}
    <ResultBox result={result} />
  </div>
}

export function AsaasSavedChargeButton({ accountsReceivableId }: { accountsReceivableId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ApiResult | null>(null)

  async function load() {
    setLoading(true)
    setError("")
    try {
      setResult(await requestJson(`/api/integrations/asaas/payments?accountsReceivableId=${encodeURIComponent(accountsReceivableId)}`, { cache: "no-store" }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar cobranca.")
    } finally {
      setLoading(false)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void load() }}><DialogTrigger asChild><Button size="sm" variant="outline">Ver cobranca</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Cobranca Asaas</DialogTitle><DialogDescription>Consulte novamente o PIX ou boleto vinculado a esta conta a receber.</DialogDescription></DialogHeader>{loading ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Carregando cobranca...</p> : null}{error ? <p className="text-sm text-red-600">{error}</p> : null}<ResultBox result={result} /><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button></DialogFooter></DialogContent></Dialog>
}

export function AsaasBalanceCards() {
  const [data, setData] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  async function load() {
    setLoading(true); setError("")
    try { setData(await requestJson("/api/integrations/asaas/balances", { cache: "no-store" })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao consultar saldos.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const serviceBalance = Number(data?.accounts?.find((item: any) => item.code === "services")?.balance || 0)
  const materialBalance = Number(data?.accounts?.find((item: any) => item.code === "materials")?.balance || 0)
  return <SectionCard title="Saldos das contas Asaas" description="Posicao atual das contas de servicos e materiais, consultada diretamente no Asaas.">
    <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Atualizar</Button></div>
    {error ? <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <div className="grid gap-3 md:grid-cols-3"><MetricCard title="Conta de servicos" value={loading ? "..." : money(serviceBalance)} note="Disponivel no Asaas" icon={TrendingUp} /><MetricCard title="Conta de materiais" value={loading ? "..." : money(materialBalance)} note="Disponivel no Asaas" icon={TrendingDown} /><MetricCard title="Saldo consolidado" value={loading ? "..." : money(Number(data?.consolidatedBalance ?? serviceBalance + materialBalance))} note="Soma das duas contas" icon={WalletCards} /></div>
  </SectionCard>
}

export function AsaasChargeButton({ state }: { state: OperationalState }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ApiResult | null>(null)
  const [form, setForm] = useState({ account: "services" as AccountCode, clientId: "", serviceOrderId: "", billingType: "UNDEFINED", value: "", dueDate: futureDate(7), description: "", installmentCount: "1", idempotencyKey: newKey() })
  const clients = state.clients.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))
  const orders = state.serviceOrders.filter((item) => !form.clientId || item.clientId === form.clientId).map((item) => ({ value: item.id, label: `${item.orderNumber} - ${item.description || item.orderType}` }))
  async function submit() {
    setLoading(true); setError(""); setResult(null)
    try {
      const payload = await requestJson("/api/integrations/asaas/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, serviceOrderId: form.serviceOrderId || undefined, value: Number(form.value), installmentCount: Number(form.installmentCount) }) })
      setResult(payload); setForm((current) => ({ ...current, idempotencyKey: newKey() }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar cobranca.") }
    finally { setLoading(false) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><TrendingUp className="h-4 w-4" />Gerar cobranca Asaas</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Gerar cobranca para cliente</DialogTitle><DialogDescription>A cobranca sera criada na conta escolhida e vinculada automaticamente ao Contas a Receber e ao DRE.</DialogDescription></DialogHeader>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Conta Asaas"><AccountSelect value={form.account} onChange={(account) => setForm({ ...form, account })} /></Field><Field label="Cliente"><SearchableSelect value={form.clientId} onValueChange={(clientId) => setForm({ ...form, clientId, serviceOrderId: "" })} options={clients} placeholder="Selecione o cliente" /></Field><Field label="OS vinculada (opcional)"><SearchableSelect value={form.serviceOrderId} onValueChange={(serviceOrderId) => { const order = state.serviceOrders.find((item) => item.id === serviceOrderId); setForm({ ...form, serviceOrderId, value: order?.totalAmount ? String(order.totalAmount) : form.value, description: order ? `${order.orderNumber} - ${order.description}` : form.description }) }} options={orders} placeholder="Cobranca avulsa" /></Field><Field label="Forma de cobranca"><Select value={form.billingType} onValueChange={(billingType) => setForm({ ...form, billingType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNDEFINED">Cliente escolhe</SelectItem><SelectItem value="PIX">Pix</SelectItem><SelectItem value="BOLETO">Boleto</SelectItem><SelectItem value="CREDIT_CARD">Cartao de credito</SelectItem></SelectContent></Select></Field><Field label="Valor total"><Input type="number" min="0.01" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field><Field label="Vencimento"><Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></Field><Field label="Parcelas"><Input type="number" min="1" max="60" value={form.installmentCount} onChange={(event) => setForm({ ...form, installmentCount: event.target.value })} /></Field><div className="sm:col-span-2"><Field label="Descricao"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div></div>
    {error ? <p className="text-sm text-red-600">{error}</p> : null}<ResultBox result={result} /><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button><Button onClick={submit} disabled={loading || !form.clientId || !form.value || !form.dueDate}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Gerar cobranca</Button></DialogFooter>
  </DialogContent></Dialog>
}

export function AsaasSupplierPaymentButton({ state }: { state: OperationalState }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ApiResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [form, setForm] = useState({ account: "materials" as AccountCode, supplierId: "", method: "pix", value: "", description: "", scheduleDate: today(), pixKey: "", pixKeyType: "EVP", bank: "", agency: "", accountNumber: "", accountDigit: "", accountType: "CHECKING_ACCOUNT", cpfCnpj: "", name: "", identificationField: "", idempotencyKey: newKey() })
  const suppliers = state.suppliers.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.name}${item.document ? ` - ${item.document}` : ""}` }))
  const selectedSupplier = state.suppliers.find((item) => item.id === form.supplierId)
  async function submit() {
    setLoading(true); setError(""); setResult(null)
    try {
      const url = form.method === "boleto" ? "/api/integrations/asaas/bill-payments" : "/api/integrations/asaas/transfers"
      const body = form.method === "boleto" ? { account: form.account, supplierId: form.supplierId, identificationField: form.identificationField, description: form.description, scheduleDate: form.scheduleDate, idempotencyKey: form.idempotencyKey } : { account: form.account, supplierId: form.supplierId, value: Number(form.value), description: form.description, scheduleDate: form.scheduleDate, idempotencyKey: form.idempotencyKey, destinationType: form.method, pixAddressKey: form.pixKey, pixAddressKeyType: form.pixKeyType, bankCode: form.bank, agency: form.agency, bankAccount: form.accountNumber, accountDigit: form.accountDigit, bankAccountType: form.accountType, ownerDocument: form.cpfCnpj, ownerName: form.name || selectedSupplier?.name }
      setResult(await requestJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); setForm((current) => ({ ...current, idempotencyKey: newKey() })); setConfirmed(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao realizar pagamento.") }
    finally { setLoading(false) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><TrendingDown className="h-4 w-4" />Realizar pagamento Asaas</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Pagar fornecedor</DialogTitle><DialogDescription>Escolha a conta de origem e confira os dados do favorecido. O lancamento sera conciliado no Contas a Pagar.</DialogDescription></DialogHeader>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Conta de origem"><AccountSelect value={form.account} onChange={(account) => setForm({ ...form, account })} /></Field><Field label="Fornecedor"><SearchableSelect value={form.supplierId} onValueChange={(supplierId) => { const supplier = state.suppliers.find((item) => item.id === supplierId); setForm({ ...form, supplierId, cpfCnpj: supplier?.document || "", name: supplier?.name || "" }) }} options={suppliers} placeholder="Selecione o fornecedor" /></Field><Field label="Modalidade"><Select value={form.method} onValueChange={(method) => setForm({ ...form, method })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="bank">Transferencia bancaria</SelectItem><SelectItem value="boleto">Pagar boleto/conta</SelectItem></SelectContent></Select></Field><Field label="Agendamento"><Input type="date" min={today()} value={form.scheduleDate} onChange={(event) => setForm({ ...form, scheduleDate: event.target.value })} /></Field>
    {form.method !== "boleto" ? <Field label="Valor"><Input type="number" min="0.01" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field> : <div className="sm:col-span-2"><Field label="Linha digitavel ou codigo de barras"><Input value={form.identificationField} onChange={(event) => setForm({ ...form, identificationField: event.target.value })} /></Field></div>}
    {form.method === "pix" ? <><Field label="Chave Pix"><Input value={form.pixKey} onChange={(event) => setForm({ ...form, pixKey: event.target.value })} /></Field><Field label="Tipo da chave"><Select value={form.pixKeyType} onValueChange={(pixKeyType) => setForm({ ...form, pixKeyType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CPF">CPF</SelectItem><SelectItem value="CNPJ">CNPJ</SelectItem><SelectItem value="EMAIL">E-mail</SelectItem><SelectItem value="PHONE">Telefone</SelectItem><SelectItem value="EVP">Aleatoria</SelectItem></SelectContent></Select></Field></> : null}
    {form.method === "bank" ? <><Field label="Codigo do banco"><Input value={form.bank} onChange={(event) => setForm({ ...form, bank: event.target.value })} /></Field><Field label="Agencia"><Input value={form.agency} onChange={(event) => setForm({ ...form, agency: event.target.value })} /></Field><Field label="Conta"><Input value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} /></Field><Field label="Digito"><Input value={form.accountDigit} onChange={(event) => setForm({ ...form, accountDigit: event.target.value })} /></Field></> : null}
    <div className="sm:col-span-2"><Field label="Descricao"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div></div>
    <label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><span>Conferi conta, favorecido, valor e dados de pagamento. Autorizo o envio desta operacao ao Asaas.</span></label>{error ? <p className="text-sm text-red-600">{error}</p> : null}<ResultBox result={result} /><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button><Button onClick={submit} disabled={loading || !confirmed || !form.supplierId || (form.method === "boleto" ? !form.identificationField : !form.value) || (form.method === "pix" && !form.pixKey)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar pagamento</Button></DialogFooter>
  </DialogContent></Dialog>
}

export function AsaasInvoicePanel({ state }: { state: OperationalState }) {
  const [loading, setLoading] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogMode, setCatalogMode] = useState<"catalog" | "manual">("catalog")
  const [catalogMessage, setCatalogMessage] = useState("")
  const [catalogError, setCatalogError] = useState("")
  const [catalogReload, setCatalogReload] = useState(0)
  const [catalogQuery, setCatalogQuery] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState<ApiResult | null>(null)
  const [catalog, setCatalog] = useState<Array<{ value: string; label: string; code: string; name: string }>>([])
  const [documents, setDocuments] = useState<Array<Record<string, any>>>([])
  const [form, setForm] = useState({ kind: "service", clientId: "", serviceOrderId: "", catalogId: "", itemCode: "", itemName: "", value: "", quantity: "1", effectiveDate: today(), description: "", observations: "", authorizeNow: true })
  const clients = state.clients.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))
  const orders = state.serviceOrders.filter((item) => !form.clientId || item.clientId === form.clientId).map((item) => ({ value: item.id, label: `${item.orderNumber} - ${item.description || item.orderType}` }))
  const clientName = (id: string) => state.clients.find((item) => item.id === id)?.name || "-"
  async function loadDocuments() {
    try { const payload = await requestJson("/api/integrations/asaas/status", { cache: "no-store" }); setDocuments(payload.fiscalDocuments || []) } catch { setDocuments([]) }
  }
  useEffect(() => { void loadDocuments() }, [])
  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => {
      setCatalogLoading(true)
      setCatalogError("")
      if (!catalogQuery) setCatalogMessage("")
      const params = new URLSearchParams({ kind: form.kind })
      if (catalogQuery.trim()) params.set("query", catalogQuery.trim())
      requestJson(`/api/integrations/asaas/fiscal-services?${params}`).then((payload) => {
        if (!active) return
        const items = (payload.items || []).map((item: any) => ({ value: String(item.id || item.code), label: `${item.code || item.id} - ${item.name || item.description}`, code: String(item.code || item.id), name: String(item.name || item.description || "") }))
        setCatalog(items)
        const requiresManualEntry = form.kind === "service" && (payload.selectionMode === "manual" || (!catalogQuery && !items.length))
        setCatalogMode(requiresManualEntry ? "manual" : "catalog")
        setCatalogMessage(String(payload.message || ""))
      }).catch((cause) => {
        if (!active) return
        setCatalog([])
        setCatalogMode(form.kind === "service" ? "manual" : "catalog")
        setCatalogError(cause instanceof Error ? cause.message : "Falha ao consultar o catalogo fiscal.")
      }).finally(() => { if (active) setCatalogLoading(false) })
    }, catalogQuery ? 350 : 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [form.kind, catalogQuery, catalogReload])
  const catalogOptions = useMemo(() => catalog.map(({ value, label }) => ({ value, label })), [catalog])
  async function submit() {
    setLoading(true); setError(""); setResult(null)
    try { setResult(await requestJson("/api/integrations/asaas/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, municipalServiceId: form.kind === "service" ? form.catalogId : undefined, serviceOrderId: form.serviceOrderId || undefined, value: Number(form.value), quantity: Number(form.quantity) }) })); await loadDocuments() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao emitir nota fiscal.") }
    finally { setLoading(false) }
  }
  return <div className="space-y-4"><SectionCard title="Emitir nota fiscal" description="Emita NFS-e de servicos pela conta Asaas de servicos ou NF-e de materiais pelo conector fiscal configurado.">
    <div className="grid gap-4 md:grid-cols-2"><Field label="Tipo de nota"><Select value={form.kind} onValueChange={(kind) => { setCatalogQuery(""); setForm({ ...form, kind, catalogId: "", itemCode: "", itemName: "" }) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="service">NFS-e de servicos</SelectItem><SelectItem value="material">NF-e de materiais</SelectItem></SelectContent></Select></Field><Field label="Cliente"><SearchableSelect value={form.clientId} onValueChange={(clientId) => setForm({ ...form, clientId, serviceOrderId: "" })} options={clients} placeholder="Selecione o cliente" /></Field><Field label="OS vinculada (opcional)"><SearchableSelect value={form.serviceOrderId} onValueChange={(serviceOrderId) => { const order = state.serviceOrders.find((item) => item.id === serviceOrderId); setForm({ ...form, serviceOrderId, value: order?.totalAmount ? String(order.totalAmount) : form.value, description: order?.description || form.description }) }} options={orders} placeholder="Nota avulsa" /></Field>{form.kind === "material" ? <Field label="Material cadastrado"><SearchableSelect loading={catalogLoading} value={form.catalogId} onValueChange={(catalogId) => { const item = catalog.find((row) => row.value === catalogId); setForm({ ...form, catalogId, itemCode: item?.code || "", itemName: item?.name || "" }) }} onSearchChange={setCatalogQuery} options={catalogOptions} placeholder="Pesquisar codigo ou descricao" searchPlaceholder="Digite o codigo ou a descricao" /></Field> : catalogLoading && !catalog.length && !catalogQuery ? <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando servicos municipais no Asaas...</div> : catalogMode === "catalog" ? <div className="space-y-2"><Field label="Servico municipal"><SearchableSelect loading={catalogLoading} value={form.catalogId} onValueChange={(catalogId) => { const item = catalog.find((row) => row.value === catalogId); setForm({ ...form, catalogId, itemCode: item?.code || "", itemName: item?.name || "" }) }} onSearchChange={setCatalogQuery} options={catalogOptions} placeholder="Pesquisar codigo ou descricao" searchPlaceholder="Digite o codigo ou a descricao" emptyLabel="Nenhum servico encontrado." /></Field><Button type="button" size="sm" variant="outline" onClick={() => setCatalogMode("manual")}>Informar codigo manualmente</Button></div> : <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Informe o servico municipal manualmente</strong><p className="mt-1">{catalogMessage || "A lista nao foi disponibilizada pelo Asaas. Use o codigo informado pela prefeitura ou contabilidade nos campos abaixo."}</p>{catalog.length ? <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setCatalogMode("catalog")}>Voltar para pesquisa</Button> : null}</div>}<Field label={form.kind === "service" ? "Codigo municipal do servico" : "Codigo do material"}><Input value={form.itemCode} onChange={(event) => setForm({ ...form, catalogId: "", itemCode: event.target.value })} placeholder={form.kind === "service" ? "Ex.: codigo informado pela prefeitura" : undefined} /></Field><Field label={form.kind === "service" ? "Descricao municipal do servico" : "Nome do material"}><Input value={form.itemName} onChange={(event) => setForm({ ...form, catalogId: "", itemName: event.target.value })} placeholder={form.kind === "service" ? "Descricao correspondente ao codigo municipal" : undefined} /></Field>{catalogError ? <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>Nao foi possivel consultar os servicos municipais: {catalogError}. O preenchimento manual permanece disponivel.</span><Button type="button" size="sm" variant="outline" onClick={() => setCatalogReload((value) => value + 1)}><RefreshCw className="h-4 w-4" />Tentar novamente</Button></div> : null}<Field label="Valor total"><Input type="number" min="0.01" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field><Field label="Data de emissao"><Input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} /></Field>{form.kind === "material" ? <Field label="Quantidade"><Input type="number" min="1" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field> : null}<div className="md:col-span-2"><Field label="Descricao do documento"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div><div className="md:col-span-2"><Field label="Observacoes"><Textarea value={form.observations} onChange={(event) => setForm({ ...form, observations: event.target.value })} /></Field></div>{form.kind === "service" ? <label className="flex items-center gap-3 text-sm"><Checkbox checked={form.authorizeNow} onCheckedChange={(value) => setForm({ ...form, authorizeNow: value === true })} />Autorizar a emissao no Asaas agora</label> : null}</div>
    {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}<div className="mt-4"><ResultBox result={result} /></div><div className="mt-4 flex justify-end"><Button onClick={submit} disabled={loading || !form.clientId || !form.itemCode || !form.value || !form.effectiveDate}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Emitir nota fiscal</Button></div>
  </SectionCard>
  <SectionCard title="Notas fiscais recentes" description="Documentos emitidos ou em processamento nas duas contas.">
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Codigo / item</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead>Downloads</TableHead></TableRow></TableHeader><TableBody>{documents.length ? documents.map((document) => <TableRow key={document.id}><TableCell>{document.effective_date ? new Date(`${document.effective_date}T12:00:00`).toLocaleDateString("pt-BR") : "-"}</TableCell><TableCell>{clientName(document.client_id)}</TableCell><TableCell>{document.document_kind === "service" ? "NFS-e" : "NF-e"}</TableCell><TableCell>{[document.item_code, document.item_name].filter(Boolean).join(" - ") || "-"}</TableCell><TableCell>{money(Number(document.value || 0))}</TableCell><TableCell><StatusBadge status={document.status || "Pendente"} /></TableCell><TableCell><div className="flex gap-2">{document.pdf_url ? <Button size="sm" variant="outline" asChild><a href={document.pdf_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />PDF</a></Button> : null}{document.xml_url ? <Button size="sm" variant="outline" asChild><a href={document.xml_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />XML</a></Button> : null}{!document.pdf_url && !document.xml_url ? <span className="text-xs text-muted-foreground">Aguardando autorizacao</span> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma nota fiscal registrada.</TableCell></TableRow>}</TableBody></Table></div>
  </SectionCard></div>
}
