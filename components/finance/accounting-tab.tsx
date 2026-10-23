"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, FileUp, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, FormSheet, SectionCard } from "@/components/operations/shared"
import { aggregateMaterials, type AccountingInvoice } from "@/lib/accounting-invoice"

type Operation = "Entrada" | "Saída"
type Row = {
  id: string; operation: Operation; kind: string; access_key: string | null; number: string | null; series: string | null; issued_at: string | null; nature: string | null
  issuer_document: string | null; issuer_name: string | null; recipient_document: string | null; recipient_name: string | null
  total_products: number; total_invoice: number; total_icms_base: number; total_icms: number; total_icms_st: number; total_ipi: number; total_pis: number; total_cofins: number
  total_iss: number; total_freight: number; total_discount: number; total_taxes: number; data: Omit<AccountingInvoice, "fields">; file_name: string | null
}
type Detail = Row & { fields: Array<[string, string]>; xml: string | null }

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

export function AccountingTab() {
  const input = useRef<HTMLInputElement>(null)
  const [operation, setOperation] = useState<Operation>("Entrada")
  const [filter, setFilter] = useState<"" | Operation>("")
  const [q, setQ] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState("")
  const [report, setReport] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter) params.set("operacao", filter)
      if (q.trim()) params.set("q", q.trim())
      if (de) params.set("de", de)
      if (ate) params.set("ate", ate)
      const result = await send<{ invoices: Row[] }>(`/api/contabilidade/notas?${params}`)
      setRows(result.invoices); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [filter, q, de, ate])
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
  const materials = useMemo(() => aggregateMaterials(rows.map((row) => ({ number: row.number || "", issuedAt: row.issued_at || "", issuerName: row.issuer_name || "", items: row.data?.items || [] }))), [rows])

  function exportNotes() {
    downloadCsv("contabilidade-notas.csv", ["Operação", "Tipo", "Número", "Série", "Emissão", "Chave", "Natureza", "Emitente", "CNPJ emitente", "Destinatário", "CNPJ destinatário", "Produtos", "Frete", "Desconto", "Base ICMS", "ICMS", "ICMS ST", "IPI", "PIS", "COFINS", "ISS", "Tributos aprox.", "Total da nota"],
      rows.map((row) => [row.operation, row.kind, row.number || "", row.series || "", day(row.issued_at), row.access_key || "", row.nature || "", row.issuer_name || "", row.issuer_document || "", row.recipient_name || "", row.recipient_document || "", row.total_products, row.total_freight, row.total_discount, row.total_icms_base, row.total_icms, row.total_icms_st, row.total_ipi, row.total_pis, row.total_cofins, row.total_iss, row.total_taxes, row.total_invoice]))
  }
  function exportItems() {
    const lines: Array<Array<string | number>> = []
    for (const row of rows) for (const item of row.data?.items || []) lines.push([row.operation, row.number || "", day(row.issued_at), row.issuer_name || "", row.issuer_document || "", item.number, item.code, item.description, item.ncm, item.cfop, item.unit, item.quantity, item.unitPrice, item.total, item.icms.cst, item.icms.baseAmount, item.icms.rate, item.icms.amount, item.icmsSt.amount, item.ipi.cst, item.ipi.amount, item.pis.cst, item.pis.amount, item.cofins.cst, item.cofins.amount])
    downloadCsv("contabilidade-itens.csv", ["Operação", "NF", "Emissão", "Emitente", "CNPJ emitente", "Item", "Código", "Descrição", "NCM", "CFOP", "Un.", "Qtd.", "Vl. unit.", "Total", "CST ICMS", "Base ICMS", "Alíq. ICMS", "ICMS", "ICMS ST", "CST IPI", "IPI", "CST PIS", "PIS", "CST COFINS", "COFINS"], lines)
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Contabilidade: subir notas fiscais" description="Envie os XML das notas (NF-e, NFC-e ou NFS-e), de uma só vez ou várias. Cada nota é guardada com todos os campos, impostos destacados e itens, e a mesma nota não entra duas vezes.">
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
      </SectionCard>

      <Tabs defaultValue="notas">
        <div className="flex flex-wrap items-end gap-3">
          <TabsList><TabsTrigger value="notas">Notas</TabsTrigger><TabsTrigger value="materiais">Materiais comprados</TabsTrigger><TabsTrigger value="impostos">Resumo de impostos</TabsTrigger></TabsList>
          <div className="flex rounded-md border p-0.5 text-sm">
            {([["", "Todas"], ["Entrada", "Entradas"], ["Saída", "Saídas"]] as Array<["" | Operation, string]>).map(([value, label]) => (
              <button key={value || "todas"} type="button" onClick={() => setFilter(value)} className={`rounded px-3 py-1.5 ${filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Emitente, destinatário, CNPJ, número, chave ou natureza" className="pl-9" /></div>
          <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => setDe(event.target.value)} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} className="mt-1 w-40" /></label>
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span><strong>{rows.length}</strong> nota(s)</span><span>Total das notas: <strong>{brl(sums.invoice)}</strong></span>{loading ? <span className="text-muted-foreground">Carregando...</span> : null}
        </div>

        <TabsContent value="notas" className="mt-3">
          <div className="mb-2 flex gap-2"><Button type="button" variant="outline" size="sm" onClick={exportNotes} disabled={!rows.length}><Download className="h-4 w-4" />Planilha das notas</Button><Button type="button" variant="outline" size="sm" onClick={exportItems} disabled={!rows.length}><Download className="h-4 w-4" />Planilha dos itens com impostos</Button></div>
          <DataTable headers={["Emissão", "Op.", "NF", "Emitente", "Destinatário", "Produtos", "ICMS", "ICMS ST", "IPI", "PIS", "COFINS", "ISS", "Total"]} empty={!rows.length && !loading}>
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

        <TabsContent value="materiais" className="mt-3">
          <p className="mb-2 text-sm text-muted-foreground">Tudo o que aparece nas notas filtradas acima, somado por produto (código e descrição). Use o filtro de Entradas para ver só o que foi comprado.</p>
          <DataTable headers={["Código", "Descrição", "NCM", "Un.", "Quantidade", "Preço médio", "Total", "ICMS", "IPI", "PIS", "COFINS", "Notas", "Fornecedores"]} empty={!materials.length && !loading}>
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

        <TabsContent value="impostos" className="mt-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {([["Produtos/serviços", sums.products], ["ICMS", sums.icms], ["ICMS ST", sums.st], ["IPI", sums.ipi], ["PIS", sums.pis], ["COFINS", sums.cofins], ["ISS", sums.iss], ["Total das notas", sums.invoice]] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold">{brl(value)}</div></div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Somas das notas filtradas. Entradas e saídas ficam separadas pelo filtro acima.</p>
        </TabsContent>
      </Tabs>

      <FormSheet open={!!open} onOpenChange={(value) => !value && setOpen(null)} title="Nota fiscal completa" description="Todos os campos lidos do XML.">
        {open ? <InvoiceDetail key={open} id={open} /> : null}
      </FormSheet>
    </div>
  )
}
