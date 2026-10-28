"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SearchableSelectField, SectionCard } from "@/components/operations/shared"
import { chassisBySize, chassisTimeline, issuedDay, pickChassis, type ChassisPick, type ChassisRow, type Granularity, type GroupBy } from "@/lib/chassis"

type Row = Omit<ChassisRow, "description" | "accessKey" | "nature">
type SizeField = "capacity" | "pbt" | "axles"

const COLORS = ["#1e3a8a", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#4d7c0f", "#a16207", "#475569", "#c026d3"]
const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-")
const tons = (value: number) => (value ? `${String(value).replace(".", ",")} t` : "-")
const periodLabel = (key: string, granularity: Granularity) => {
  if (!/^\d{4}-\d{2}/.test(key)) return "sem data"
  if (granularity === "mes") return `${key.slice(5, 7)}/${key.slice(2, 4)}`
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`
}
const periodTitle = (key: string, granularity: Granularity) => (granularity === "mes" ? `mês ${key.slice(5, 7)}/${key.slice(0, 4)}` : `semana de ${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`)
const formatDocument = (value: string) => (value.length === 14 ? value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : value.length === 11 ? value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : value)
const sizeName: Record<SizeField, string> = { capacity: "Capacidade de carga", pbt: "PBT (peso bruto)", axles: "Eixos" }

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

const clickedName = (entry: unknown) => String((entry as { payload?: { name?: string }; name?: string })?.payload?.name ?? (entry as { name?: string })?.name ?? "")

/** Página Chassis: quantos chassis de cada modelo, em qual período e de que tamanho; clicar no gráfico abre as notas daquele recorte. */
export function ChassisPage() {
  const [all, setAll] = useState<Row[]>([])
  const [notes, setNotes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [company, setCompany] = useState("")
  const [model, setModel] = useState("")
  const [color, setColor] = useState("")
  const [capacity, setCapacity] = useState("")
  const [client, setClient] = useState("")
  const [granularity, setGranularity] = useState<Granularity>("mes")
  const [by, setBy] = useState<GroupBy>("model")
  const [sizeField, setSizeField] = useState<SizeField>("capacity")
  const [intercompany, setIntercompany] = useState(false)
  const [pick, setPick] = useState<(ChassisPick & { title: string }) | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await send<{ rows: Row[]; notes: number }>("/api/contabilidade/chassis?visao=todos")
      setAll(result.rows); setNotes(result.notes); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const companies = useMemo(() => [...new Set(all.map((row) => row.companyName))].sort(), [all])
  const colors = useMemo(() => [...new Set(all.map((row) => row.color || "Sem cor"))].sort(), [all])
  const capacities = useMemo(() => [...new Set(all.map((row) => row.capacity || 0))].sort((a, b) => a - b), [all])
  const clientKey = (row: Row) => row.clientDocument || `nome:${row.clientName}`
  const clientOptions = useMemo(() => {
    const byKey = new Map<string, { name: string; document: string; chassis: number }>()
    for (const row of all) {
      if (!intercompany && row.intercompany) continue
      const entry = byKey.get(clientKey(row)) || { name: row.clientName || "Sem nome", document: row.clientDocument, chassis: 0 }
      entry.chassis += 1
      byKey.set(clientKey(row), entry)
    }
    return [{ value: "", label: "Todos os clientes" }, ...[...byKey.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "pt-BR")).map(([value, entry]) => ({ value, label: `${entry.name}${entry.document ? ` (${formatDocument(entry.document)})` : ""} · ${entry.chassis}` }))]
  }, [all, intercompany])
  const models = useMemo(() => [...new Set(all.map((row) => row.model || "Sem modelo"))].sort(), [all])
  const rows = useMemo(() => all.filter((row) => {
    const issued = issuedDay(row.issuedAt)
    if (de && issued < de) return false
    if (ate && issued > ate) return false
    if (company && row.companyName !== company) return false
    if (model && (row.model || "Sem modelo") !== model) return false
    if (color && (row.color || "Sem cor") !== color) return false
    if (capacity && String(row.capacity || 0) !== capacity) return false
    if (client && clientKey(row) !== client) return false
    if (!intercompany && row.intercompany) return false
    return true
  }) as ChassisRow[], [all, de, ate, company, model, color, capacity, client, intercompany])

  const timeline = useMemo(() => chassisTimeline(rows, granularity, by), [rows, granularity, by])
  const colorOf = useMemo(() => Object.fromEntries(timeline.series.map((name, index) => [name, COLORS[index % COLORS.length]])), [timeline.series])
  const ranking = useMemo(() => timeline.series.map((name) => ({ name, chassis: timeline.data.reduce((sum, row) => sum + Number(row[name] || 0), 0) })).sort((a, b) => b.chassis - a.chassis), [timeline])
  const bySize = useMemo(() => chassisBySize(rows, sizeField), [rows, sizeField])
  const chartData = timeline.data.map((row) => ({ ...row, label: periodLabel(String(row.period), granularity) }))
  const distinct = new Set(rows.map((row) => row.chassis)).size
  const total = rows.reduce((sum, row) => sum + row.itemTotal, 0)

  const opened = pick ? pickChassis(rows, pick) : []
  const open = (next: ChassisPick, title: string) => setPick({ ...next, by, granularity, title })

  function exportOpened() {
    if (!pick) return
    const header = ["Nota", "Série", "Emissão", "Chassi", "Modelo", "PBT (t)", "Capacidade (t)", "Eixos", "Cor", "Ano", "Cliente", "CPF/CNPJ", "Valor do item", "Valor da nota", "Empresa emitente"]
    const lines = opened.map((row) => [row.number, row.series, day(row.issuedAt), row.chassis, row.model, String(row.pbt).replace(".", ","), String(row.capacity).replace(".", ","), row.axles, row.color, row.year, row.clientName, formatDocument(row.clientDocument), String(row.itemTotal).replace(".", ","), String(row.invoiceTotal).replace(".", ","), row.companyName])
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "chassis-notas-emitidas.csv"; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <PageShell title="Chassis" description="Quantos chassis foram emitidos nas notas de venda, de qual modelo, em qual período e de que tamanho. Clique em uma barra para abrir as notas daquele recorte."
      actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>}>
      <SectionCard title="Filtros">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => setDe(event.target.value)} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Empresa
            <select value={company} onChange={(event) => setCompany(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todas</option>{companies.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Modelo
            <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todos</option>{models.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Cor
            <select value={color} onChange={(event) => setColor(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todas</option>{colors.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Capacidade de carga
            <select value={capacity} onChange={(event) => setCapacity(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todas</option>{capacities.map((value) => <option key={value} value={String(value)}>{value ? tons(value) : "Sem informação"}</option>)}</select>
          </label>
          <div className="w-full sm:w-[320px]"><SearchableSelectField label="Cliente" value={client} onChange={setClient} options={clientOptions} placeholder="Todos os clientes" searchPlaceholder="Pesquisar cliente por nome ou CNPJ/CPF..." /></div>
          <div className="text-xs text-muted-foreground">Período do gráfico
            <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["mes", "Mês"], ["semana", "Semana"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setGranularity(value)} className={`rounded px-3 py-1 ${granularity === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
          </div>
          <div className="text-xs text-muted-foreground">Agrupar por
            <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["model", "Modelo (FZ 1E)"], ["family", "Linha (FZ)"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setBy(value)} className={`rounded px-3 py-1 ${by === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={intercompany} onChange={(event) => setIntercompany(event.target.checked)} />Incluir vendas entre as empresas ND</label>
          {(de || ate || company || model || color || capacity || client) ? <Button variant="ghost" size="sm" onClick={() => { setDe(""); setAte(""); setCompany(""); setModel(""); setColor(""); setCapacity(""); setClient("") }}>Limpar filtros</Button> : null}
          {loading ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Chassis (distintos)" value={distinct.toLocaleString("pt-BR")} hint={`${rows.length.toLocaleString("pt-BR")} emitidos nas notas`} />
        <Card label="Valor dos chassis" value={brl(total)} hint="soma dos preços dos chassis nas notas" />
        <Card label={by === "model" ? "Modelos" : "Linhas"} value={String(timeline.series.length)} hint={ranking[0] ? `mais emitido: ${ranking[0].name} (${ranking[0].chassis})` : ""} />
        <Card label="Notas de venda lidas" value={notes.toLocaleString("pt-BR")} hint="saídas da Contabilidade, todas as empresas" />
      </div>

      <SectionCard title={`Chassis por ${granularity === "mes" ? "mês" : "semana"} e ${by === "model" ? "modelo" : "linha"}`} description="Cada cor é um modelo. Clique em um trecho da barra para ver as notas daquele modelo naquele período.">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend onClick={(entry) => open({ name: String(entry.dataKey || entry.value) }, `${String(entry.dataKey || entry.value)} · todo o período filtrado`)} wrapperStyle={{ cursor: "pointer", fontSize: 12 }} />
              {timeline.series.map((name) => (
                <Bar key={name} dataKey={name} stackId="chassis" fill={colorOf[name]} cursor="pointer"
                  onClick={(entry) => { const period = String((entry as { payload?: { period?: string } })?.payload?.period || ""); open({ name, period }, `${name} · ${periodTitle(period, granularity)}`) }} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={`Chassis por ${by === "model" ? "modelo" : "linha"} no período filtrado`} description="Clique na barra para abrir as notas.">
          <div style={{ height: Math.max(180, ranking.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value} chassi(s)`, "Emitidos"]} />
                <Bar dataKey="chassis" cursor="pointer" radius={[0, 3, 3, 0]} fill="#1e3a8a" onClick={(entry) => { const name = clickedName(entry); open({ name }, `${name} · período filtrado`) }} label={{ position: "right", fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Chassis por tamanho" description="O tamanho vem da descrição da nota: capacidade de carga e PBT em toneladas e número de eixos. A nota não traz comprimento nem largura.">
          <div className="mb-2 flex rounded-md border p-0.5 text-sm">
            {(["capacity", "pbt", "axles"] as SizeField[]).map((field) => <button key={field} type="button" onClick={() => setSizeField(field)} className={`rounded px-3 py-1 ${sizeField === field ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{sizeName[field]}</button>)}
          </div>
          <div style={{ height: Math.max(180, bySize.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySize.map((entry) => ({ ...entry, name: entry.label }))} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value} chassi(s)`, "Emitidos"]} />
                <Bar dataKey="chassis" cursor="pointer" radius={[0, 3, 3, 0]} fill="#0f766e" onClick={(entry) => { const name = clickedName(entry); const found = bySize.find((item) => item.label === name); if (found) open({ size: { field: sizeField, value: found.value } }, `${sizeName[sizeField]}: ${name}`) }} label={{ position: "right", fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Resumo por modelo" description="Clique em uma linha para abrir as notas.">
        <DataTable headers={[by === "model" ? "Modelo" : "Linha", "Chassis", "% do total", "Valor total", "Valor médio"]} empty={!ranking.length && !loading}>
          {ranking.map((entry) => {
            const part = rows.filter((row) => (by === "family" ? row.family : row.model) === entry.name || (!(by === "family" ? row.family : row.model) && entry.name === "Sem modelo"))
            const value = part.reduce((sum, row) => sum + row.itemTotal, 0)
            return (
              <TableRow key={entry.name} className="cursor-pointer" onClick={() => open({ name: entry.name }, `${entry.name} · período filtrado`)}>
                <TableCell className="font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf[entry.name] }} />{entry.name}</TableCell>
                <TableCell className="text-right">{entry.chassis.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right">{distinct ? `${((entry.chassis / distinct) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "-"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(value)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(part.length ? value / part.length : 0)}</TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>

      <Dialog open={!!pick} onOpenChange={(value) => { if (!value) setPick(null) }}>
        <DialogContent className="max-h-[92vh] w-[96vw] overflow-hidden sm:max-w-[1200px]">
          <DialogHeader>
            <DialogTitle>Notas emitidas · {pick?.title}</DialogTitle>
            <DialogDescription>{opened.length.toLocaleString("pt-BR")} chassi(s) em {new Set(opened.map((row) => row.invoiceId)).size.toLocaleString("pt-BR")} nota(s) · {brl(opened.reduce((sum, row) => sum + row.itemTotal, 0))} nos itens{de || ate ? ` · filtro ${de ? day(`${de}T12:00:00-03:00`) : "início"} a ${ate ? day(`${ate}T12:00:00-03:00`) : "hoje"}` : ""}</DialogDescription>
          </DialogHeader>
          <div><Button type="button" variant="outline" size="sm" onClick={exportOpened} disabled={!opened.length}><Download className="h-4 w-4" />Planilha das notas</Button></div>
          <DataTable headers={["Nota", "Emissão", "Chassi", "Modelo", "Cor", "Tamanho", "Cliente", "CPF/CNPJ", "Valor do item", "Valor da nota", "Empresa"]} empty={!opened.length} stickyHeader viewportClassName="max-h-[55vh]">
            {opened.map((row) => (
              <TableRow key={`${row.invoiceId}-${row.chassis}`}>
                <TableCell className="whitespace-nowrap">{row.number}{row.series ? `/${row.series}` : ""}</TableCell>
                <TableCell className="whitespace-nowrap">{day(row.issuedAt)}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{row.chassis}</TableCell>
                <TableCell className="whitespace-nowrap">{row.model || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{row.color || "-"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">PBT {tons(row.pbt)} · cap. {tons(row.capacity)} · {row.axles ? `${row.axles} eixo${row.axles > 1 ? "s" : ""}` : "-"}</TableCell>
                <TableCell className="max-w-[240px] truncate" title={row.clientName}>{row.clientName || "-"}{row.intercompany ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">entre empresas</span> : null}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDocument(row.clientDocument) || "-"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.itemTotal)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.invoiceTotal)}</TableCell>
                <TableCell className="whitespace-nowrap">{row.companyName}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
