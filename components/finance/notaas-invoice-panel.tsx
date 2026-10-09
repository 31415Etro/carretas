"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, FileCheck2, Loader2, PlugZap, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { SectionCard, StatusBadge } from "@/components/operations/shared"
import { money } from "@/lib/financial-storage"
import type { OperationalState } from "@/lib/operational-storage"

type FiscalKind = "service" | "material"
type ApiResult = Record<string, any>

const today = () => new Date().toISOString().slice(0, 10)

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Falha na operacao (HTTP ${response.status}).`)
  return payload as ApiResult
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>
}

const initialForm = {
  kind: "service" as FiscalKind,
  clientId: "",
  serviceOrderId: "",
  materialId: "",
  itemCode: "",
  itemName: "",
  value: "",
  quantity: "1",
  unit: "UN",
  effectiveDate: today(),
  description: "",
  observations: "",
  nationalServiceCode: "",
  municipalServiceCode: "",
  issRate: "0",
  issWithheld: false,
  ncm: "",
  cfop: "",
  cityCode: "",
  operationNature: "Venda de mercadoria",
  paymentType: "99",
  paymentDescription: "Outros",
}

export function NotaAsInvoicePanel({ state }: { state: OperationalState }) {
  const [form, setForm] = useState(initialForm)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documents, setDocuments] = useState<Array<Record<string, any>>>([])
  const [configuration, setConfiguration] = useState({ services: false, materials: false })
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const clients = state.clients.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.name}${item.document ? ` - ${item.document}` : ""}` }))
  const orders = state.serviceOrders.filter((item) => !form.clientId || item.clientId === form.clientId).map((item) => ({ value: item.id, label: `${item.orderNumber} - ${item.description || item.orderType}` }))
  const materials = state.materials.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.internalCode || "Sem codigo"} - ${item.name}` }))
  const clientName = (id: string) => state.clients.find((item) => item.id === id)?.name || "-"

  async function loadDocuments() {
    setDocumentsLoading(true)
    try {
      const payload = await requestJson("/api/integrations/notaas/status", { cache: "no-store" })
      setDocuments(payload.fiscalDocuments || [])
      setConfiguration(payload.configuration || { services: false, materials: false })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao consultar notas fiscais.")
    } finally {
      setDocumentsLoading(false)
    }
  }

  useEffect(() => { void loadDocuments() }, [])

  const canSubmit = useMemo(() => {
    if (!confirmed || !form.clientId || !form.value || !form.effectiveDate || !form.description) return false
    if (form.kind === "service") return form.issRate !== ""
    return Boolean(form.itemName && form.ncm.replace(/\D/g, "").length === 8 && form.cfop.replace(/\D/g, "").length === 4 && form.cityCode.replace(/\D/g, "").length === 7 && form.operationNature && form.paymentType && (form.paymentType !== "99" || form.paymentDescription))
  }, [confirmed, form])

  async function submit() {
    setLoading(true)
    setError("")
    setMessage("")
    try {
      const payload = await requestJson("/api/integrations/notaas/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, value: Number(form.value), quantity: Number(form.quantity), issRate: Number(form.issRate), serviceOrderId: form.serviceOrderId || undefined }),
      })
      setMessage(payload.message || "Nota enviada ao NotaAS.")
      setConfirmed(false)
      await loadDocuments()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao emitir nota fiscal.")
    } finally {
      setLoading(false)
    }
  }

  async function testConnection() {
    setLoading(true)
    setError("")
    setMessage("")
    try {
      const payload = await requestJson("/api/integrations/notaas/test-connection", { cache: "no-store" })
      setMessage((payload.results || []).map((item: any) => `${item.kind === "service" ? "NFS-e" : "NF-e"}: ${item.message}`).join(" "))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao testar o NotaAS.")
    } finally {
      setLoading(false)
    }
  }

  return <div className="space-y-4">
    <SectionCard title="Emitir nota fiscal" description="NFS-e de servicos pela empresa Maicon e NF-e de produtos pela empresa M&M, processadas pelo NotaAS.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1"><span>NFS-e: <strong>{configuration.services ? "configurada" : "sem chave"}</strong></span><span>NF-e: <strong>{configuration.materials ? "configurada" : "sem chave"}</strong></span></div>
        <Button type="button" size="sm" variant="outline" onClick={testConnection} disabled={loading}><PlugZap className="h-4 w-4" />Testar conexao</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tipo de nota"><Select value={form.kind} onValueChange={(kind) => { setForm({ ...initialForm, kind: kind as FiscalKind, clientId: form.clientId }); setConfirmed(false); setError(""); setMessage("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="service">NFS-e de servicos - Maicon</SelectItem><SelectItem value="material">NF-e de produtos - M&M</SelectItem></SelectContent></Select></Field>
        <Field label="Cliente"><SearchableSelect value={form.clientId} onValueChange={(clientId) => setForm({ ...form, clientId, serviceOrderId: "" })} options={clients} placeholder="Selecione o cliente" /></Field>
        <Field label="OS vinculada (opcional)"><SearchableSelect value={form.serviceOrderId} onValueChange={(serviceOrderId) => { const order = state.serviceOrders.find((item) => item.id === serviceOrderId); setForm({ ...form, serviceOrderId, clientId: order?.clientId || form.clientId, value: order?.totalAmount ? String(order.totalAmount) : form.value, description: order?.description || form.description }) }} options={orders} placeholder="Nota avulsa" /></Field>
        <Field label="Data de emissao"><Input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} /></Field>

        {form.kind === "service" ? <>
          <Field label="Codigo nacional do servico (opcional)"><Input inputMode="numeric" value={form.nationalServiceCode} onChange={(event) => setForm({ ...form, nationalServiceCode: event.target.value })} placeholder="6 digitos ou padrao do projeto" /></Field>
          <Field label="Codigo municipal do servico (opcional)"><Input value={form.municipalServiceCode} onChange={(event) => setForm({ ...form, municipalServiceCode: event.target.value })} /></Field>
          <Field label="Aliquota de ISS (%)"><Input type="number" min="0" max="100" step="0.01" value={form.issRate} onChange={(event) => setForm({ ...form, issRate: event.target.value })} /></Field>
          <label className="flex items-center gap-3 self-end rounded-md border p-3 text-sm"><Checkbox checked={form.issWithheld} onCheckedChange={(value) => setForm({ ...form, issWithheld: value === true })} />ISS retido pelo tomador</label>
        </> : <>
          <Field label="Produto cadastrado"><SearchableSelect value={form.materialId} onValueChange={(materialId) => { const material = state.materials.find((item) => item.id === materialId); setForm({ ...form, materialId, itemCode: material?.internalCode || "", itemName: material?.name || "", ncm: material?.ncm || "", unit: material?.unit || "UN", description: form.description || material?.name || "" }) }} options={materials} placeholder="Selecione o produto" /></Field>
          <Field label="Codigo interno"><Input value={form.itemCode} onChange={(event) => setForm({ ...form, itemCode: event.target.value })} /></Field>
          <Field label="Nome do produto"><Input value={form.itemName} onChange={(event) => setForm({ ...form, itemName: event.target.value })} /></Field>
          <Field label="NCM"><Input inputMode="numeric" maxLength={10} value={form.ncm} onChange={(event) => setForm({ ...form, ncm: event.target.value })} placeholder="8 digitos" /></Field>
          <Field label="CFOP"><Input inputMode="numeric" maxLength={5} value={form.cfop} onChange={(event) => setForm({ ...form, cfop: event.target.value })} placeholder="4 digitos" /></Field>
          <Field label="Codigo IBGE do municipio do cliente"><Input inputMode="numeric" maxLength={7} value={form.cityCode} onChange={(event) => setForm({ ...form, cityCode: event.target.value })} placeholder="7 digitos" /></Field>
          <Field label="Natureza da operacao"><Input value={form.operationNature} onChange={(event) => setForm({ ...form, operationNature: event.target.value })} /></Field>
          <Field label="Quantidade"><Input type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
          <Field label="Unidade"><Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="UN" /></Field>
          <Field label="Forma de pagamento"><Select value={form.paymentType} onValueChange={(paymentType) => setForm({ ...form, paymentType, paymentDescription: paymentType === "99" ? form.paymentDescription || "Outros" : "" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="01">Dinheiro</SelectItem><SelectItem value="03">Cartao de credito</SelectItem><SelectItem value="04">Cartao de debito</SelectItem><SelectItem value="17">PIX</SelectItem><SelectItem value="99">Outros</SelectItem></SelectContent></Select></Field>
          {form.paymentType === "99" ? <Field label="Descricao do pagamento"><Input value={form.paymentDescription} onChange={(event) => setForm({ ...form, paymentDescription: event.target.value })} /></Field> : null}
        </>}

        <Field label="Valor total"><Input type="number" min="0.01" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field>
        <div className="md:col-span-2"><Field label="Descricao da nota"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div>
        <div className="md:col-span-2"><Field label="Observacoes"><Textarea value={form.observations} onChange={(event) => setForm({ ...form, observations: event.target.value })} /></Field></div>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><span>Conferi cliente, valores e dados fiscais. Autorizo o envio desta nota para emissao fiscal.</span></label>
      {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
      <div className="mt-4 flex justify-end"><Button onClick={submit} disabled={loading || !canSubmit}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Emitir pelo NotaAS</Button></div>
    </SectionCard>

    <SectionCard title="Notas fiscais recentes" description="Status consultado diretamente no NotaAS. Atualize para acompanhar o processamento.">
      <div className="mb-3 flex justify-end"><Button type="button" size="sm" variant="outline" onClick={loadDocuments} disabled={documentsLoading}><RefreshCw className={documentsLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Atualizar</Button></div>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Item</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead>Documentos</TableHead></TableRow></TableHeader><TableBody>{documents.length ? documents.map((document) => <TableRow key={document.id}><TableCell>{document.effective_date ? new Date(`${document.effective_date}T12:00:00`).toLocaleDateString("pt-BR") : "-"}</TableCell><TableCell>{clientName(document.client_id)}</TableCell><TableCell>{document.document_kind === "service" ? "NFS-e" : "NF-e"}</TableCell><TableCell>{[document.item_code, document.item_name].filter(Boolean).join(" - ") || "-"}</TableCell><TableCell>{money(Number(document.value || 0))}</TableCell><TableCell><StatusBadge status={document.status_label || document.status || "Na fila"} />{document.error_message ? <p className="mt-1 max-w-xs text-xs text-red-600">{document.error_message}</p> : null}</TableCell><TableCell><div className="flex gap-2">{document.pdf_url ? <Button size="sm" variant="outline" asChild><a href={document.pdf_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />PDF</a></Button> : null}{document.xml_url ? <Button size="sm" variant="outline" asChild><a href={document.xml_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />XML</a></Button> : null}{!document.pdf_url && !document.xml_url ? <span className="text-xs text-muted-foreground">Aguardando autorizacao</span> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma nota emitida pelo NotaAS.</TableCell></TableRow>}</TableBody></Table></div>
    </SectionCard>
  </div>
}
