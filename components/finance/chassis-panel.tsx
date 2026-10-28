"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, Search } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SearchableSelectField, SectionCard } from "@/components/operations/shared"
import type { ChassisRow, chassisByModel, chassisByModelMonth, chassisChart, chassisPerChassis } from "@/lib/chassis"

type Chart = ReturnType<typeof chassisChart>
type Payload = { rows: ChassisRow[]; found: number; notes: number; chart: Chart; client: { name: string; document: string } | null }
type ClientOption = { id: string; name: string; document: string }
type View = "consulta" | "modelo" | "mes" | "chassi"
type ModelPayload = { found: number; notes: number; byModel: ReturnType<typeof chassisByModel>; byModelMonth: ReturnType<typeof chassisByModelMonth> }
type ChassiPayload = { found: number; notes: number; perChassis: ReturnType<typeof chassisPerChassis> }
const VIEWS: Array<[View, string]> = [["consulta", "Consulta e gráfico"], ["modelo", "Quantidade e valor por modelo"], ["mes", "Modelo por mês"], ["chassi", "Valor por chassi"]]
const csvNumber = (value: number) => String(Number(value || 0)).replace(".", ",")
function saveCsv(name: string, header: string[], lines: Array<Array<string | number>>) {
  const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n")
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
}

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-")
const monthLabel = (key: string) => (/^\d{4}-\d{2}$/.test(key) ? `${key.slice(5)}/${key.slice(2, 4)}` : "s/ data")
const formatDocument = (value: string) => (value.length === 14 ? value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : value.length === 11 ? value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : value)

async function send<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function Ranking({ title, rows }: { title: string; rows: Chart["models"] }) {
  const max = Math.max(1, ...rows.map((row) => row.chassis))
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">{title}</p>
      {rows.length ? rows.map((row) => (
        <div key={row.label} className="mb-2">
          <div className="flex justify-between gap-2 text-xs"><span className="truncate">{row.label}</span><span className="whitespace-nowrap">{row.chassis} · {brl(row.total)}</span></div>
          <div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(3, (row.chassis / max) * 100)}%` }} /></div>
        </div>
      )) : <p className="text-xs text-muted-foreground">Sem dados.</p>}
    </div>
  )
}

/** Contabilidade > Chassis: gráfico dos chassis vendidos e consulta por chassi, número da nota ou cliente do sistema. */
export function ChassisPanel() {
  const [q, setQ] = useState("")
  const [clientId, setClientId] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [intercompany, setIntercompany] = useState(false)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [data, setData] = useState<Payload | null>(null)
  const [view, setView] = useState<View>("consulta")
  const [modelData, setModelData] = useState<ModelPayload | null>(null)
  const [chassiData, setChassiData] = useState<ChassiPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => { send<{ clients: ClientOption[] }>("/api/contabilidade/chassis?opcoes=clientes").then((result) => setClients(result.clients)).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set("q", q.trim())
      if (clientId) params.set("clienteId", clientId)
      if (de) params.set("de", de)
      if (ate) params.set("ate", ate)
      if (intercompany) params.set("interna", "1")
      if (view === "modelo" || view === "mes") { params.set("visao", "modelo"); setModelData(await send<ModelPayload>(`/api/contabilidade/chassis?${params}`)) }
      else if (view === "chassi") { params.set("visao", "chassi"); setChassiData(await send<ChassiPayload>(`/api/contabilidade/chassis?${params}`)) }
      else setData(await send<Payload>(`/api/contabilidade/chassis?${params}`))
      setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível consultar.") } finally { setLoading(false) }
  }, [q, clientId, de, ate, intercompany, view])
  useEffect(() => { const timer = setTimeout(() => void load(), 350); return () => clearTimeout(timer) }, [load])

  const options = useMemo(() => [{ value: "", label: "Todos os clientes" }, ...clients.map((client) => ({ value: client.id, label: `${client.name}${client.document ? ` (${client.document})` : ""}` }))], [clients])
  const chart = data?.chart
  const monthly = (chart?.months || []).map((month) => ({ label: monthLabel(month.label), chassis: month.chassis, total: month.total }))

  function exportCsv() {
    if (!data) return
    const header = ["Chassi", "Modelo", "Cor", "Ano", "Código do produto", "Nota", "Série", "Emissão", "Cliente", "CPF/CNPJ", "Valor do item", "Valor da nota", "Empresa emitente", "Chave de acesso", "Entre empresas do grupo"]
    const lines = data.rows.map((row) => [row.chassis, row.model, row.color, row.year, row.productCode, row.number, row.series, day(row.issuedAt), row.clientName, formatDocument(row.clientDocument), String(row.itemTotal).replace(".", ","), String(row.invoiceTotal).replace(".", ","), row.companyName, `'${row.accessKey}`, row.intercompany ? "sim" : "não"])
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "chassis-notas-de-venda.csv"; anchor.click(); URL.revokeObjectURL(url)
  }

  function exportModel() {
    if (!modelData) return
    saveCsv("chassis-por-modelo.csv", ["Modelo", "Chassis distintos", "Emitidos nas notas", "Notas", "Valor total", "Valor médio", "Menor valor", "Maior valor", "Primeira emissão", "Última emissão"],
      modelData.byModel.map((row) => [row.model, row.chassis, row.items, row.notes, csvNumber(row.total), csvNumber(row.average), csvNumber(row.min), csvNumber(row.max), row.first, row.last]))
  }
  function exportMonth() {
    if (!modelData) return
    const months = modelData.byModelMonth.months
    saveCsv("chassis-modelo-por-mes.csv", ["Modelo", ...months.flatMap((month) => [`${monthLabel(month)} qtd`, `${monthLabel(month)} valor`]), "Total qtd", "Total valor"],
      modelData.byModelMonth.rows.map((row) => [row.model, ...row.byMonth.flatMap((cell) => [cell.chassis, csvNumber(cell.total)]), row.chassis, csvNumber(row.total)]))
  }
  function exportChassi() {
    if (!chassiData) return
    saveCsv("chassis-valor-por-chassi.csv", ["Chassi", "Modelo", "Cor", "Ano", "Notas", "Valor somado", "Última nota", "Última emissão", "Último cliente", "Empresa emitente", "Valor na última nota", "Notas que citam o chassi"],
      chassiData.perChassis.map((row) => [row.chassis, row.model, row.color, row.year, row.notes, csvNumber(row.total), row.lastNumber, day(row.lastIssuedAt), row.lastClient, row.lastCompany, csvNumber(row.lastValue), row.numbers]))
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Consulta de chassi" description="Digite o número do chassi (inteiro ou só o final), o número da nota, ou escolha o cliente do sistema: aparecem a nota e o chassi.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Chassi (ex.: 980NDFZ1ETD000233), nº da nota ou nome do cliente" className="pl-9" /></div>
          <div className="w-full sm:w-[320px]"><SearchableSelectField label="Cliente do sistema" value={clientId} onChange={setClientId} options={options} placeholder="Todos os clientes" searchPlaceholder="Pesquisar cliente..." /></div>
          <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => setDe(event.target.value)} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} className="mt-1 w-40" /></label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={intercompany} onChange={(event) => setIntercompany(event.target.checked)} />Incluir vendas entre as empresas ND</label>
          {loading ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <div className="flex flex-wrap gap-1 rounded-md border p-0.5 text-sm">
        {VIEWS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setView(value)} className={`rounded px-3 py-1.5 ${view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
        ))}
      </div>

      {view === "modelo" ? (
        <SectionCard title="Quantidade emitida e valor por modelo" description={modelData ? `${modelData.found.toLocaleString("pt-BR")} chassi(s) no filtro atual · valor = preço do chassi na nota` : "Carregando..."}>
          <div className="mb-2"><Button type="button" variant="outline" size="sm" onClick={exportModel} disabled={!modelData?.byModel.length}><Download className="h-4 w-4" />Planilha por modelo</Button></div>
          <DataTable headers={["Modelo", "Chassis distintos", "Emitidos nas notas", "Valor total", "Valor médio", "Menor", "Maior", "Primeira", "Última"]} empty={!modelData?.byModel.length && !loading}>
            {(modelData?.byModel || []).map((row) => (
              <TableRow key={row.model}>
                <TableCell className="font-medium">{row.model}</TableCell>
                <TableCell className="text-right">{row.chassis.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{row.items.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.total)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.average)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.min)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.max)}</TableCell>
                <TableCell className="whitespace-nowrap">{row.first ? day(row.first) : "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{row.last ? day(row.last) : "-"}</TableCell>
              </TableRow>
            ))}
            {modelData?.byModel.length ? (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{modelData.byModel.reduce((sum, row) => sum + row.chassis, 0).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{modelData.byModel.reduce((sum, row) => sum + row.items, 0).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(modelData.byModel.reduce((sum, row) => sum + row.total, 0))}</TableCell>
                <TableCell colSpan={5} />
              </TableRow>
            ) : null}
          </DataTable>
        </SectionCard>
      ) : null}

      {view === "mes" ? (
        <SectionCard title="Quantidade e valor por modelo, mês a mês" description={modelData ? `${modelData.found.toLocaleString("pt-BR")} chassi(s) no filtro atual` : "Carregando..."}>
          <div className="mb-2"><Button type="button" variant="outline" size="sm" onClick={exportMonth} disabled={!modelData?.byModelMonth.rows.length}><Download className="h-4 w-4" />Planilha modelo por mês</Button></div>
          <DataTable headers={["Modelo", ...(modelData?.byModelMonth.months || []).map(monthLabel), "Total", "Valor total"]} empty={!modelData?.byModelMonth.rows.length && !loading}>
            {(modelData?.byModelMonth.rows || []).map((row) => (
              <TableRow key={row.model}>
                <TableCell className="whitespace-nowrap font-medium">{row.model}</TableCell>
                {row.byMonth.map((cell) => <TableCell key={cell.month} className="whitespace-nowrap text-right">{cell.chassis ? <>{cell.chassis}<div className="text-[10px] text-muted-foreground">{brl(cell.total)}</div></> : <span className="text-muted-foreground">-</span>}</TableCell>)}
                <TableCell className="text-right font-semibold">{row.chassis}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{brl(row.total)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}

      {view === "chassi" ? (
        <SectionCard title="Valor por chassi" description={chassiData ? `${chassiData.perChassis.length.toLocaleString("pt-BR")} chassi(s) · quando o mesmo chassi aparece em mais de uma nota, o valor é a soma e a coluna "Notas" mostra quantas` : "Carregando..."}>
          <div className="mb-2"><Button type="button" variant="outline" size="sm" onClick={exportChassi} disabled={!chassiData?.perChassis.length}><Download className="h-4 w-4" />Planilha por chassi</Button></div>
          <DataTable headers={["Chassi", "Modelo", "Cor/Ano", "Notas", "Valor somado", "Última nota", "Emissão", "Último cliente", "Empresa emitente"]} empty={!chassiData?.perChassis.length && !loading} stickyHeader viewportClassName="max-h-[65vh]">
            {(chassiData?.perChassis || []).map((row) => (
              <TableRow key={row.chassis}>
                <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{row.chassis}</TableCell>
                <TableCell className="whitespace-nowrap">{row.model || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{[row.color, row.year].filter(Boolean).join(" / ") || "-"}</TableCell>
                <TableCell className={`text-right ${row.notes > 1 ? "font-semibold text-amber-700" : ""}`} title={row.notes > 1 ? `Notas: ${row.numbers}` : undefined}>{row.notes}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.total)}</TableCell>
                <TableCell className="whitespace-nowrap">{row.lastNumber}</TableCell>
                <TableCell className="whitespace-nowrap">{day(row.lastIssuedAt)}</TableCell>
                <TableCell className="max-w-[240px] truncate" title={row.lastClient}>{row.lastClient || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{row.lastCompany}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}

      {view === "consulta" && chart ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Chassis emitidos em notas" value={chart.totalChassis.toLocaleString("pt-BR")} hint={`${chart.distinctChassis.toLocaleString("pt-BR")} chassis distintos · venda ao cliente final`} />
            <Card label="Valor vendido (itens)" value={brl(chart.models.reduce((sum, model) => sum + model.total, 0))} hint="soma dos valores dos itens com chassi" />
            <Card label="Entre empresas ND" value={chart.intercompany.toLocaleString("pt-BR")} hint="transferências/vendas entre as empresas do grupo (fora do total)" />
            <Card label="Notas de venda lidas" value={(data?.notes || 0).toLocaleString("pt-BR")} hint="saídas da Contabilidade, todas as empresas" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-md border p-3 lg:col-span-2">
              <p className="mb-2 text-sm font-medium">Chassis vendidos por mês</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value, name) => (name === "chassis" ? [`${value} chassi(s)`, "Vendidos"] : [brl(value), "Valor"])} />
                    <Bar dataKey="chassis" name="chassis" fill="#1e3a8a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <Ranking title="Por modelo" rows={chart.models} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Ranking title="Maiores clientes (chassis)" rows={chart.clients} />
            <Ranking title="Por empresa emitente" rows={chart.companies} />
          </div>
        </>
      ) : null}

      {view === "consulta" ? <SectionCard title="Notas com chassi" description={data ? `${data.found.toLocaleString("pt-BR")} chassi(s) encontrado(s)${data.found > 500 ? " (mostrando os 500 mais recentes; refine a busca ou exporte)" : ""}${data.client ? ` · cliente: ${data.client.name}` : ""}` : "Carregando..."}>
        <div className="mb-2"><Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!data?.rows.length}><Download className="h-4 w-4" />Planilha dos chassis</Button></div>
        <DataTable headers={["Chassi", "Modelo", "Cor/Ano", "Nota", "Emissão", "Cliente", "CPF/CNPJ", "Valor do item", "Valor da nota", "Empresa emitente"]} empty={!data?.rows.length && !loading} stickyHeader viewportClassName="max-h-[60vh]">
          {(data?.rows || []).map((row) => (
            <TableRow key={`${row.invoiceId}-${row.chassis}`}>
              <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{row.chassis}</TableCell>
              <TableCell className="whitespace-nowrap">{row.model || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{[row.color, row.year].filter(Boolean).join(" / ") || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{row.number}{row.series ? `/${row.series}` : ""}</TableCell>
              <TableCell className="whitespace-nowrap">{day(row.issuedAt)}</TableCell>
              <TableCell className="max-w-[260px] truncate" title={row.clientName}>{row.clientName || "-"}{row.intercompany ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">entre empresas</span> : null}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDocument(row.clientDocument) || "-"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(row.itemTotal)}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(row.invoiceTotal)}</TableCell>
              <TableCell className="whitespace-nowrap">{row.companyName}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard> : null}
    </div>
  )
}
