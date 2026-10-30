"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, FileUp, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, FormSheet, SectionCard } from "@/components/operations/shared"
import { NfImportPage } from "@/components/finance/nf-import-page"
import { ChassisPanel } from "@/components/finance/chassis-panel"
import { RemessasPanel } from "@/components/finance/remessas-panel"
import type { AccountingInvoice } from "@/lib/accounting-invoice"
import type { AccountingAnalysis } from "@/lib/accounting-analysis"

type Operation = "Entrada" | "Saída"
type Row = {
  id: string; operation: Operation; kind: string; access_key: string | null; number: string | null; series: string | null; issued_at: string | null; nature: string | null
  issuer_document: string | null; issuer_name: string | null; recipient_document: string | null; recipient_name: string | null
  total_products: number; total_invoice: number; total_icms_base: number; total_icms: number; total_icms_st: number; total_ipi: number; total_pis: number; total_cofins: number
  total_iss: number; total_freight: number; total_discount: number; total_taxes: number; file_name: string | null
}
type Detail = Row & { data: Omit<AccountingInvoice, "fields">; fields: Array<[string, string]>; xml: string | null }

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })
const pct = (value: number) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR") : "-")
const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "-")

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

function downloadCsv(name: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const body = [header, ...rows].map((line) => line.map(cell).join(";")).join("\r\n")
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function Info({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="break-words text-sm">{value === undefined || value === null || value === "" ? "-" : value}</div></div>
}

function PartyInfo({ title, party }: { title: string; party: Record<string, string> }) {
  const address = [[party.street, party.number, party.complement].filter(Boolean).join(", "), party.district, [party.city, party.state].filter(Boolean).join("/"), party.zipCode].filter(Boolean).join(" · ")
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Info label="Nome / razão social" value={party.name} /><Info label="CNPJ / CPF" value={party.document} />
        <Info label="Nome fantasia" value={party.tradeName} /><Info label="Inscrição estadual" value={party.stateRegistration} />
        <Info label="Inscrição municipal" value={party.municipalRegistration} /><Info label="Regime tributário (CRT)" value={party.taxRegime} />
        <Info label="E-mail" value={party.email} /><Info label="Telefone" value={party.phone} />
      </div>
      <div className="mt-2"><Info label="Endereço" value={address} /></div>
    </div>
  )
}

function InvoiceDetail({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("")
  useEffect(() => {
    let alive = true
    send<{ invoice: Detail | null }>(`/api/contabilidade/notas?id=${id}`).then((result) => alive && setInvoice(result.invoice)).catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Erro ao abrir a nota."))
    return () => { alive = false }
  }, [id])
  if (error) return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
  if (!invoice) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</p>
  const data = invoice.data
  const totals = data.totals
  const fields = invoice.fields.filter(([path, value]) => !filter || `${path} ${value}`.toLowerCase().includes(filter.toLowerCase()))
  function downloadXml() {
    if (!invoice?.xml) return
    const url = URL.createObjectURL(new Blob([invoice.xml], { type: "application/xml" }))
    const link = document.createElement("a")
    link.href = url; link.download = invoice.file_name || `nota-${invoice.number || invoice.id}.xml`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return (
    <div className="space-y-4 pb-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Info label="Tipo" value={`${invoice.kind}${data.model ? ` (modelo ${data.model})` : ""}`} /><Info label="Número / série" value={`${invoice.number || "-"} / ${invoice.series || "-"}`} /><Info label="Operação (no sistema)" value={invoice.operation} />
        <Info label="Emissão" value={dateTime(invoice.issued_at)} /><Info label="Saída/entrada" value={data.exitAt ? dateTime(data.exitAt) : ""} /><Info label="Natureza da operação" value={invoice.nature} />
        <Info label="Tipo de operação (tpNF)" value={data.operationType === "0" ? "0 - Entrada" : data.operationType === "1" ? "1 - Saída" : data.operationType} /><Info label="Finalidade" value={data.purpose} /><Info label="Destino da operação" value={data.destination} />
        <Info label="Ambiente" value={data.environment === "1" ? "Produção" : data.environment === "2" ? "Homologação" : data.environment} /><Info label="Presença do comprador" value={data.presence} /><Info label="Consumidor final" value={data.finalConsumer} />
        <Info label="Protocolo de autorização" value={data.protocol} /><Info label="Data da autorização" value={data.protocolDate ? dateTime(data.protocolDate) : ""} /><Info label="Situação na SEFAZ" value={[data.protocolStatus, data.protocolStatusText].filter(Boolean).join(" - ")} />
      </div>
      <Info label="Chave de acesso" value={invoice.access_key} />
      {data.warnings.length ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">{data.warnings.join(" ")}</p> : null}

      <PartyInfo title="Emitente" party={data.issuer} />
      <PartyInfo title="Destinatário" party={data.recipient} />

      <div className="rounded-md border p-3">
        <div className="mb-2 text-sm font-semibold">Totais e impostos da nota</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Info label="Produtos/serviços" value={brl(totals.products)} /><Info label="Frete" value={brl(totals.freight)} /><Info label="Seguro" value={brl(totals.insurance)} /><Info label="Desconto" value={brl(totals.discount)} />
          <Info label="Outras despesas" value={brl(totals.other)} /><Info label="Base ICMS" value={brl(totals.icmsBase)} /><Info label="ICMS" value={brl(totals.icms)} /><Info label="ICMS desonerado" value={brl(totals.icmsExempt)} />
          <Info label="FCP" value={brl(totals.fcp)} /><Info label="Base ICMS ST" value={brl(totals.icmsStBase)} /><Info label="ICMS ST" value={brl(totals.icmsSt)} /><Info label="FCP ST" value={brl(totals.fcpSt)} />
          <Info label="Imposto de importação" value={brl(totals.importTax)} /><Info label="IPI" value={brl(totals.ipi)} /><Info label="PIS" value={brl(totals.pis)} /><Info label="COFINS" value={brl(totals.cofins)} />
          {totals.iss || totals.issRetained ? <><Info label="ISS" value={brl(totals.iss)} /><Info label="ISS retido" value={brl(totals.issRetained)} /></> : null}
          <Info label="Tributos aprox. (Lei da Transparência)" value={brl(totals.totalTaxes)} /><Info label="Valor total da nota" value={brl(totals.invoice)} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Itens e impostos por item ({data.items.length})</div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1500px] text-xs">
            <thead className="bg-muted/50 text-left"><tr>{["#", "Código", "Descrição", "NCM", "CFOP", "Un.", "Qtd.", "Vl. unit.", "Total", "ICMS (CST · base · alíq. · valor)", "ICMS ST", "IPI (CST · base · alíq. · valor)", "PIS (CST · base · alíq. · valor)", "COFINS (CST · base · alíq. · valor)", "Frete", "Desc.", "Trib. aprox."].map((head) => <th key={head} className="whitespace-nowrap px-2 py-2 font-medium">{head}</th>)}</tr></thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.number} className="border-t align-top">
                  <td className="px-2 py-2">{item.number}</td><td className="px-2 py-2">{item.code}{item.ean ? <div className="text-muted-foreground">EAN {item.ean}</div> : null}</td>
                  <td className="min-w-[220px] px-2 py-2">{item.description}{item.info ? <div className="text-muted-foreground">{item.info}</div> : null}</td>
                  <td className="px-2 py-2">{item.ncm}{item.cest ? <div className="text-muted-foreground">CEST {item.cest}</div> : null}</td><td className="px-2 py-2">{item.cfop}</td><td className="px-2 py-2">{item.unit}</td>
                  <td className="px-2 py-2 text-right">{qty(item.quantity)}</td><td className="px-2 py-2 text-right">{brl(item.unitPrice)}</td><td className="px-2 py-2 text-right font-medium">{brl(item.total)}</td>
                  <td className="px-2 py-2">{item.icms.cst || "-"} · orig {item.icms.origin || "-"} · {brl(item.icms.baseAmount)} · {pct(item.icms.rate)} · <strong>{brl(item.icms.amount)}</strong></td>
                  <td className="px-2 py-2">{brl(item.icmsSt.baseAmount)} · {pct(item.icmsSt.rate)} · <strong>{brl(item.icmsSt.amount)}</strong></td>
                  <td className="px-2 py-2">{item.ipi.cst || "-"} · {brl(item.ipi.baseAmount)} · {pct(item.ipi.rate)} · <strong>{brl(item.ipi.amount)}</strong></td>
                  <td className="px-2 py-2">{item.pis.cst || "-"} · {brl(item.pis.baseAmount)} · {pct(item.pis.rate)} · <strong>{brl(item.pis.amount)}</strong></td>
                  <td className="px-2 py-2">{item.cofins.cst || "-"} · {brl(item.cofins.baseAmount)} · {pct(item.cofins.rate)} · <strong>{brl(item.cofins.amount)}</strong></td>
                  <td className="px-2 py-2 text-right">{brl(item.freight)}</td><td className="px-2 py-2 text-right">{brl(item.discount)}</td><td className="px-2 py-2 text-right">{brl(item.totalTaxes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Transporte</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Info label="Modalidade do frete" value={data.transport.mode} /><Info label="Transportadora" value={data.transport.carrierName} /><Info label="CNPJ/CPF" value={data.transport.carrierDocument} /><Info label="Placa" value={data.transport.plate} />
            <Info label="Volumes" value={data.transport.volumes} /><Info label="Peso bruto" value={data.transport.grossWeight} /><Info label="Peso líquido" value={data.transport.netWeight} />
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Pagamento e cobrança</div>
          {data.payments.length ? data.payments.map((pay, index) => <div key={index} className="text-sm">Forma {pay.method || "-"}: {brl(pay.amount)}</div>) : <div className="text-sm text-muted-foreground">Sem forma de pagamento informada.</div>}
          {data.installments.length ? <div className="mt-2 space-y-0.5 text-sm">{data.installments.map((dup, index) => <div key={index}>Duplicata {dup.number || index + 1}: vence {dup.dueDate ? dup.dueDate.split("-").reverse().join("/") : "-"} · {brl(dup.amount)}</div>)}</div> : null}
        </div>
      </div>

      {data.additionalInfo || data.fiscalInfo ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-1 font-semibold">Informações adicionais</div>
          {data.additionalInfo ? <p className="whitespace-pre-wrap">{data.additionalInfo}</p> : null}
          {data.fiscalInfo ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">Fisco: {data.fiscalInfo}</p> : null}
        </div>
      ) : null}

      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Todos os campos do XML ({invoice.fields.length})</div>
          <div className="flex gap-2">
            <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar campo ou valor" className="h-8 w-56" />
            <Button type="button" variant="outline" size="sm" onClick={downloadXml} disabled={!invoice.xml}><Download className="h-4 w-4" />XML</Button>
          </div>
        </div>
        <div className="max-h-96 overflow-auto rounded border text-xs">
          <table className="w-full"><tbody>{fields.slice(0, 1500).map(([path, value], index) => <tr key={index} className="border-t first:border-t-0"><td className="w-1/2 break-all px-2 py-1 text-muted-foreground">{path}</td><td className="break-all px-2 py-1">{value}</td></tr>)}</tbody></table>
        </div>
        {fields.length > 1500 ? <p className="mt-1 text-xs text-muted-foreground">Mostrando 1.500 de {fields.length}; use o filtro ou baixe o XML.</p> : null}
      </div>
    </div>
  )
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "good" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "warn" ? "border-amber-500/50 bg-amber-500/5" : tone === "good" ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

type Bucket = AccountingAnalysis["suppliers"][number]
function BarTable({ title, rows, labelHead }: { title: string; rows: Bucket[]; labelHead: string }) {
  const max = Math.max(1, ...rows.map((row) => row.total))
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-2 font-medium">{labelHead}</th><th className="px-2 font-medium">Notas</th><th className="px-2 text-right font-medium">Total</th><th className="px-2 text-right font-medium">Impostos</th><th className="px-2 text-right font-medium">ICMS</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t align-top">
                <td className="max-w-[260px] py-1.5 pr-2"><div className="truncate" title={row.label}>{row.label}</div><div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(2, (row.total / max) * 100)}%` }} /></div></td>
                <td className="px-2 py-1.5">{row.notes}</td><td className="px-2 py-1.5 text-right">{brl(row.total)}</td><td className="px-2 py-1.5 text-right">{brl(row.taxes)}</td><td className="px-2 py-1.5 text-right">{brl(row.icms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const monthLabel = (key: string) => (/^\d{4}-\d{2}$/.test(key) ? `${key.slice(5)}/${key.slice(0, 4)}` : "Sem data")

function AnalysisPanel({ analysis }: { analysis: AccountingAnalysis }) {
  const t = analysis.totals
  const taxRows = [["ICMS", t.icms], ["ICMS ST", t.icmsSt], ["IPI", t.ipi], ["PIS", t.pis], ["COFINS", t.cofins], ["ISS", t.iss], ["Imposto de importação", t.importTax]] as Array<[string, number]>
  const maxTax = Math.max(1, ...taxRows.map(([, value]) => value))
  const maxMonth = Math.max(1, ...analysis.months.map((month) => month.total))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Total em impostos destacados" value={brl(analysis.taxesTotal)} hint={`${pct(analysis.taxBurden)} do valor das notas`} tone="warn" />
        <Card label="Total das notas" value={brl(t.total)} hint={`${t.notes.toLocaleString("pt-BR")} nota(s) · ticket médio ${brl(analysis.averageTicket)}`} />
        <Card label="Produtos / serviços" value={brl(t.products)} hint={`Frete ${brl(t.freight)} · desconto ${brl(t.discount)}`} />
        <Card label="Impostos com potencial de crédito" value={brl(analysis.potentialCredit)} hint="ICMS + IPI + PIS + COFINS destacados; a contabilidade confirma o que é aproveitável pelo regime" tone="good" />
        <Card label="ICMS" value={brl(t.icms)} hint={`ST: ${brl(t.icmsSt)} em ${analysis.substitution.notes} nota(s)`} />
        <Card label="IPI" value={brl(t.ipi)} />
        <Card label="PIS + COFINS" value={brl(t.pis + t.cofins)} hint={`PIS ${brl(t.pis)} · COFINS ${brl(t.cofins)}`} />
        <Card label="Tributos aprox. (Lei da Transparência)" value={brl(t.approxTaxes)} hint="Valor informado pelo emitente, só referência" />
        <Card label="Notas sem imposto destacado" value={`${analysis.withoutTax.notes}`} hint={`${brl(analysis.withoutTax.total)} (ex.: Simples, isentas ou remessas)`} tone={analysis.withoutTax.notes ? "warn" : undefined} />
        <Card label="Compras de fornecedores do Simples" value={pct(analysis.simples.share)} hint={`${analysis.simples.notes} nota(s) · ${brl(analysis.simples.total)} (crédito de ICMS limitado)`} />
        <Card label="Maior nota" value={brl(analysis.biggest?.total || 0)} hint={analysis.biggest ? `NF ${analysis.biggest.number} · ${analysis.biggest.supplier}` : ""} />
        <Card label="Produtos distintos comprados" value={`${analysis.materials.length}`} hint="Veja em Materiais comprados" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Impostos por tipo</div>
          <div className="space-y-2">
            {taxRows.map(([label, value]) => (
              <div key={label}><div className="flex justify-between text-xs"><span>{label}</span><span>{brl(value)} · {pct(analysis.taxesTotal ? (value / analysis.taxesTotal) * 100 : 0)}</span></div><div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(value ? 2 : 0, (value / maxTax) * 100)}%` }} /></div></div>
            ))}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-2 text-sm font-semibold">Evolução por mês de emissão</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-2 font-medium">Mês</th><th className="px-2 font-medium">Notas</th><th className="px-2 text-right font-medium">Total</th><th className="px-2 text-right font-medium">Impostos</th><th className="px-2 text-right font-medium">ICMS</th></tr></thead>
              <tbody>
                {analysis.months.map((month) => (
                  <tr key={month.key} className="border-t"><td className="py-1.5 pr-2"><div>{monthLabel(month.key)}</div><div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(2, (month.total / maxMonth) * 100)}%` }} /></div></td><td className="px-2">{month.notes}</td><td className="px-2 text-right">{brl(month.total)}</td><td className="px-2 text-right">{brl(month.taxes)}</td><td className="px-2 text-right">{brl(month.icms)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BarTable title="Maiores fornecedores (por valor)" rows={analysis.suppliers} labelHead="Fornecedor" />
        <BarTable title="Fornecedores que mais destacam imposto" rows={analysis.suppliersByTaxes} labelHead="Fornecedor" />
        <BarTable title="Por CFOP (itens)" rows={analysis.cfops} labelHead="CFOP" />
        <BarTable title="Por NCM (itens)" rows={analysis.ncms} labelHead="NCM" />
        <BarTable title="Por estado do fornecedor" rows={analysis.states} labelHead="UF" />
        <BarTable title="Por regime tributário do fornecedor" rows={analysis.regimes} labelHead="Regime" />
      </div>
    </div>
  )
}

type Consolidated = { companies: Array<{ id: string; name: string; cnpj: string; analysis: AccountingAnalysis }>; total: AccountingAnalysis }

/** Soma das notas de todas as empresas: o conjunto no topo e a comparação lado a lado, empresa por empresa. */
function ConsolidatedPanel({ data }: { data: Consolidated }) {
  const head = ["Empresa", "Notas", "Total das notas", "Impostos destacados", "% de imposto", "ICMS", "IPI", "PIS", "COFINS", "ISS", "Crédito potencial"]
  const line = (name: string, a: AccountingAnalysis) => [name, a.totals.notes.toLocaleString("pt-BR"), brl(a.totals.total), brl(a.taxesTotal), pct(a.taxBurden), brl(a.totals.icms), brl(a.totals.ipi), brl(a.totals.pis), brl(a.totals.cofins), brl(a.totals.iss), brl(a.potentialCredit)]
  const rows = [...data.companies.map((company) => line(company.name, company.analysis)), line("TOTAL DAS EMPRESAS", data.total)]
  const months = [...new Set([...data.companies.flatMap((company) => company.analysis.months.map((month) => month.key)), ...data.total.months.map((month) => month.key)])].sort()
  const monthOf = (a: AccountingAnalysis, key: string) => a.months.find((month) => month.key === key)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Soma das notas de {data.companies.length} empresa(s), com os mesmos filtros de operação e período acima. Cada nota continua pertencendo à empresa que a recebeu ou emitiu.</p>
      <AnalysisPanel analysis={data.total} />
      <div className="overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs"><tr>{head.map((label, index) => <th key={label} className={`px-3 py-2 font-medium ${index ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row[0]} className={`border-t ${index === rows.length - 1 ? "bg-muted/30 font-semibold" : ""}`}>{row.map((cell, column) => <td key={column} className={`px-3 py-2 ${column ? "whitespace-nowrap text-right" : ""}`}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs"><tr><th className="px-3 py-2 font-medium">Mês</th>{data.companies.map((company) => <th key={company.id} className="px-3 py-2 text-right font-medium">{company.name}</th>)}<th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
          <tbody>{months.map((key) => <tr key={key} className="border-t"><td className="px-3 py-2">{key}</td>{data.companies.map((company) => { const month = monthOf(company.analysis, key); return <td key={company.id} className="whitespace-nowrap px-3 py-2 text-right">{month ? <>{brl(month.total)}<div className="text-xs text-muted-foreground">{brl(month.taxes)} em impostos</div></> : "-"}</td> })}<td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{brl(monthOf(data.total, key)?.total)}</td></tr>)}</tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => downloadCsv("contabilidade-empresas.csv", head, rows)}><Download className="h-4 w-4" />Planilha do consolidado</Button>
    </div>
  )
}

export function AccountingTab({ emitir }: { emitir?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [sub, setSub] = useState("analise")
  const off = sub === "emitir" || sub === "importar" || sub === "chassis" || sub === "remessas" ? "hidden " : ""
  const [operation, setOperation] = useState<Operation>("Entrada")
  const [filter, setFilter] = useState<"" | Operation>("")
  const [q, setQ] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [analysis, setAnalysis] = useState<AccountingAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState("")
  const [report, setReport] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [consolidated, setConsolidated] = useState<Consolidated | null>(null)
  const [consolidatedError, setConsolidatedError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter) params.set("operacao", filter)
      if (q.trim()) params.set("q", q.trim())
      if (de) params.set("de", de)
      if (ate) params.set("ate", ate)
      const [result, summary] = await Promise.all([send<{ invoices: Row[] }>(`/api/contabilidade/notas?${params}`), send<{ analysis: AccountingAnalysis }>(`/api/contabilidade/notas?${params}&analise=1`)])
      setRows(result.invoices || []); setAnalysis(summary.analysis || null); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [filter, q, de, ate])
  useEffect(() => {
    if (sub !== "consolidado") return
    const params = new URLSearchParams()
    if (filter) params.set("operacao", filter)
    if (de) params.set("de", de)
    if (ate) params.set("ate", ate)
    setConsolidated(null); setConsolidatedError("")
    send<Consolidated>(`/api/contabilidade/consolidado?${params}`).then(setConsolidated).catch((reason) => setConsolidatedError(reason instanceof Error ? reason.message : "Não foi possível consolidar."))
  }, [sub, filter, de, ate])
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer) }, [load])

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ""
    if (!files.length) return
    const lines: string[] = []
    let done = 0
    for (const file of files) {
      setProgress(`Importando ${++done} de ${files.length}: ${file.name}`)
      try {
        const xml = await file.text()
        const result = await send<{ status: string; number: string }>("/api/contabilidade/notas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml, fileName: file.name, operation }) })
        lines.push(`${result.status === "duplicada" ? "Já estava importada" : "Importada"}: ${file.name}${result.number ? ` (NF ${result.number})` : ""}`)
      } catch (reason) {
        lines.push(`ERRO em ${file.name}: ${reason instanceof Error ? reason.message : "falha"}`)
      }
    }
    setProgress(""); setReport(lines)
    await load()
  }

  const sums = useMemo(() => rows.reduce((acc, row) => ({ invoice: acc.invoice + Number(row.total_invoice), products: acc.products + Number(row.total_products), icms: acc.icms + Number(row.total_icms), st: acc.st + Number(row.total_icms_st), ipi: acc.ipi + Number(row.total_ipi), pis: acc.pis + Number(row.total_pis), cofins: acc.cofins + Number(row.total_cofins), iss: acc.iss + Number(row.total_iss) }), { invoice: 0, products: 0, icms: 0, st: 0, ipi: 0, pis: 0, cofins: 0, iss: 0 }), [rows])
  const materials = analysis?.materials || []

  function exportNotes() {
    downloadCsv("contabilidade-notas.csv", ["Operação", "Tipo", "Número", "Série", "Emissão", "Chave", "Natureza", "Emitente", "CNPJ emitente", "Destinatário", "CNPJ destinatário", "Produtos", "Frete", "Desconto", "Base ICMS", "ICMS", "ICMS ST", "IPI", "PIS", "COFINS", "ISS", "Tributos aprox.", "Total da nota"],
      rows.map((row) => [row.operation, row.kind, row.number || "", row.series || "", day(row.issued_at), row.access_key || "", row.nature || "", row.issuer_name || "", row.issuer_document || "", row.recipient_name || "", row.recipient_document || "", row.total_products, row.total_freight, row.total_discount, row.total_icms_base, row.total_icms, row.total_icms_st, row.total_ipi, row.total_pis, row.total_cofins, row.total_iss, row.total_taxes, row.total_invoice]))
  }
  async function exportItems() {
    const params = new URLSearchParams({ analise: "1", itens: "1" })
    if (filter) params.set("operacao", filter)
    if (q.trim()) params.set("q", q.trim())
    if (de) params.set("de", de)
    if (ate) params.set("ate", ate)
    const { items } = await send<{ items: Array<{ operation: string; number: string; issued_at: string; issuer_name: string; issuer_document: string; item: AccountingInvoice["items"][number] }> }>(`/api/contabilidade/notas?${params}`)
    downloadCsv("contabilidade-itens.csv", ["Operação", "NF", "Emissão", "Emitente", "CNPJ emitente", "Item", "Código", "Descrição", "NCM", "CFOP", "Un.", "Qtd.", "Vl. unit.", "Total", "CST ICMS", "Base ICMS", "Alíq. ICMS", "ICMS", "ICMS ST", "CST IPI", "IPI", "CST PIS", "PIS", "CST COFINS", "COFINS"],
      items.map(({ operation: op, number, issued_at, issuer_name, issuer_document, item }) => [op, number || "", day(issued_at), issuer_name || "", issuer_document || "", item.number, item.code, item.description, item.ncm, item.cfop, item.unit, item.quantity, item.unitPrice, item.total, item.icms.cst, item.icms.baseAmount, item.icms.rate, item.icms.amount, item.icmsSt.amount, item.ipi.cst, item.ipi.amount, item.pis.cst, item.pis.amount, item.cofins.cst, item.cofins.amount]))
  }

  return (
    <div className="space-y-4">

      <Tabs value={sub} onValueChange={setSub}>
        <div className="flex flex-wrap items-end gap-3">
          <TabsList><TabsTrigger value="analise">Análise</TabsTrigger><TabsTrigger value="consolidado">Todas as empresas</TabsTrigger><TabsTrigger value="chassis">Chassis (notas de venda)</TabsTrigger><TabsTrigger value="remessas">Remessas</TabsTrigger><TabsTrigger value="notas">Notas</TabsTrigger><TabsTrigger value="materiais">Materiais comprados</TabsTrigger><TabsTrigger value="emitir">Emitir NF</TabsTrigger><TabsTrigger value="importar">Importar NF (clientes e fornecedores)</TabsTrigger></TabsList>
          <div className={`${off}flex rounded-md border p-0.5 text-sm`}>
            {([["", "Todas"], ["Entrada", "Entradas"], ["Saída", "Saídas"]] as Array<["" | Operation, string]>).map(([value, label]) => (
              <button key={value || "todas"} type="button" onClick={() => setFilter(value)} className={`rounded px-3 py-1.5 ${filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className={`${off}relative min-w-[220px] flex-1`}><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Emitente, destinatário, CNPJ, número, chave ou natureza" className="pl-9" /></div>
          <label className={`${off}text-xs text-muted-foreground`}>De<Input type="date" value={de} onChange={(event) => setDe(event.target.value)} className="mt-1 w-40" /></label>
          <label className={`${off}text-xs text-muted-foreground`}>Até<Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} className="mt-1 w-40" /></label>
        </div>
        {error && !off ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <div className={`${off}mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm`}>
          <span><strong>{rows.length}</strong> nota(s)</span><span>Total das notas: <strong>{brl(sums.invoice)}</strong></span>{loading ? <span className="text-muted-foreground">Carregando...</span> : null}
        </div>

        <TabsContent value="analise" className="mt-3">{analysis ? <AnalysisPanel analysis={analysis} /> : <p className="text-sm text-muted-foreground">Carregando indicadores...</p>}</TabsContent>

        <TabsContent value="consolidado" className="mt-3">{consolidatedError ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{consolidatedError}</p> : consolidated ? <ConsolidatedPanel data={consolidated} /> : <p className="text-sm text-muted-foreground">Somando as empresas...</p>}</TabsContent>

        <TabsContent value="chassis" className="mt-3">{sub === "chassis" ? <ChassisPanel /> : null}</TabsContent>

        <TabsContent value="remessas" className="mt-3">{sub === "remessas" ? <RemessasPanel /> : null}</TabsContent>

        <TabsContent value="notas" className="mt-3">
          <div className="mb-2 flex gap-2"><Button type="button" variant="outline" size="sm" onClick={exportNotes} disabled={!rows.length}><Download className="h-4 w-4" />Planilha das notas</Button><Button type="button" variant="outline" size="sm" onClick={() => void exportItems()} disabled={!rows.length}><Download className="h-4 w-4" />Planilha dos itens com impostos</Button></div>
          <DataTable stickyHeader viewportClassName="max-h-[36rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]" headers={["Emissão", "Op.", "NF", "Emitente", "Destinatário", "Produtos", "ICMS", "ICMS ST", "IPI", "PIS", "COFINS", "ISS", "Total"]} empty={!rows.length && !loading}>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpen(row.id)}>
                <TableCell className="whitespace-nowrap">{day(row.issued_at)}</TableCell><TableCell>{row.operation}</TableCell><TableCell className="whitespace-nowrap">{row.kind} {row.number || "-"}{row.series ? `/${row.series}` : ""}</TableCell>
                <TableCell>{row.issuer_name || "-"}<div className="text-xs text-muted-foreground">{row.issuer_document}</div></TableCell><TableCell>{row.recipient_name || "-"}<div className="text-xs text-muted-foreground">{row.recipient_document}</div></TableCell>
                <TableCell className="text-right">{brl(row.total_products)}</TableCell><TableCell className="text-right">{brl(row.total_icms)}</TableCell><TableCell className="text-right">{brl(row.total_icms_st)}</TableCell><TableCell className="text-right">{brl(row.total_ipi)}</TableCell>
                <TableCell className="text-right">{brl(row.total_pis)}</TableCell><TableCell className="text-right">{brl(row.total_cofins)}</TableCell><TableCell className="text-right">{brl(row.total_iss)}</TableCell><TableCell className="text-right font-medium">{brl(row.total_invoice)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </TabsContent>

        <TabsContent value="emitir" className="mt-3">{emitir}</TabsContent>
        <TabsContent value="importar" className="mt-3"><NfImportPage embedded /></TabsContent>

        <TabsContent value="materiais" className="mt-3">
          <p className="mb-2 text-sm text-muted-foreground">Tudo o que aparece nas notas filtradas acima, somado por produto (código e descrição). Use o filtro de Entradas para ver só o que foi comprado.</p>
          <DataTable stickyHeader viewportClassName="max-h-[36rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]" headers={["Código", "Descrição", "NCM", "Un.", "Quantidade", "Preço médio", "Total", "ICMS", "IPI", "PIS", "COFINS", "Notas", "Fornecedores"]} empty={!materials.length && !loading}>
            {materials.map((item) => (
              <TableRow key={`${item.code}|${item.description}`}>
                <TableCell>{item.code}</TableCell><TableCell className="min-w-[220px]">{item.description}</TableCell><TableCell>{item.ncm}</TableCell><TableCell>{item.unit}</TableCell>
                <TableCell className="text-right">{qty(item.quantity)}</TableCell><TableCell className="text-right">{brl(item.averagePrice)}</TableCell><TableCell className="text-right font-medium">{brl(item.total)}</TableCell>
                <TableCell className="text-right">{brl(item.icms)}</TableCell><TableCell className="text-right">{brl(item.ipi)}</TableCell><TableCell className="text-right">{brl(item.pis)}</TableCell><TableCell className="text-right">{brl(item.cofins)}</TableCell>
                <TableCell className="text-right">{item.notes}</TableCell><TableCell className="min-w-[180px] text-xs">{item.suppliers.join(", ")}</TableCell>
              </TableRow>
            ))}
          </DataTable>
          <div className="mt-2"><Button type="button" variant="outline" size="sm" disabled={!materials.length} onClick={() => downloadCsv("contabilidade-materiais.csv", ["Código", "Descrição", "NCM", "Un.", "Quantidade", "Preço médio", "Total", "ICMS", "IPI", "PIS", "COFINS", "Notas", "Fornecedores"], materials.map((item) => [item.code, item.description, item.ncm, item.unit, item.quantity, item.averagePrice, item.total, item.icms, item.ipi, item.pis, item.cofins, item.notes, item.suppliers.join(", ")]))}><Download className="h-4 w-4" />Planilha dos materiais</Button></div>
        </TabsContent>

      </Tabs>

      <div className={off}><SectionCard title="Contabilidade: subir notas fiscais" description="Envie os XML das notas (NF-e, NFC-e ou NFS-e), de uma só vez ou várias. Cada nota é guardada com todos os campos, impostos destacados e itens, e a mesma nota não entra duas vezes.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex rounded-md border p-0.5 text-sm">
            {(["Entrada", "Saída"] as Operation[]).map((value) => (
              <button key={value} type="button" onClick={() => setOperation(value)} className={`rounded px-3 py-1.5 ${operation === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{value === "Entrada" ? "Notas de compra (entrada)" : "Notas de venda (saída)"}</button>
            ))}
          </div>
          <input ref={input} type="file" accept=".xml,text/xml,application/xml" multiple hidden onChange={upload} />
          <Button type="button" onClick={() => input.current?.click()} disabled={!!progress}>{progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Escolher arquivos XML</Button>
          {progress ? <span className="text-sm text-muted-foreground">{progress}</span> : null}
        </div>
        {report.length ? <div className="mt-3 max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">{report.map((line, index) => <div key={index} className={line.startsWith("ERRO") ? "text-destructive" : ""}>{line}</div>)}</div> : null}
      </SectionCard></div>

      <FormSheet open={!!open} onOpenChange={(value) => !value && setOpen(null)} title="Nota fiscal completa" description="Todos os campos lidos do XML.">
        {open ? <InvoiceDetail key={open} id={open} /> : null}
      </FormSheet>
    </div>
  )
}
