"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SectionCard } from "@/components/operations/shared"
import { MultiSelectSearch } from "@/components/chassis/client-multi-select"
import { RegistrySection } from "@/components/chassis/registry-section"
import type { OtherNote } from "@/lib/chassis"
import { chassisBySize, chassisTimeline, issuedDay, periodKey, pickChassis, rowUnits, trailerUnits, type ChassisPick, type ChassisRow, type Granularity, type GroupBy } from "@/lib/chassis"

type Row = Omit<ChassisRow, "description" | "accessKey" | "nature"> & { sizeNote?: string; semNota?: boolean; seller?: string; externalSeller?: string; consumer?: string }
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

type TipEntry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }
const avg = (total: number, count: number) => brl(count ? total / count : 0)

/** Balão do mouse das barras de ranking e de tamanho: quantidade, valor total e valor médio. */
function SummaryTip({ active, payload }: { active?: boolean; payload?: TipEntry[] }) {
  const item = payload?.[0]?.payload as { name?: string; chassis?: number; total?: number } | undefined
  if (!active || !item) return null
  return (
    <div className="rounded-md border bg-background p-3 text-sm shadow-md">
      <div className="font-semibold">{item.name}</div>
      <div className="mt-1 text-muted-foreground">Quantidade: <span className="font-medium text-foreground">{Number(item.chassis || 0).toLocaleString("pt-BR")} carreta(s)</span></div>
      <div className="text-muted-foreground">Valor total: <span className="font-medium text-foreground">{brl(item.total)}</span></div>
      <div className="text-muted-foreground">Valor médio por carreta: <span className="font-medium text-foreground">{avg(Number(item.total || 0), Number(item.chassis || 0))}</span></div>
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
  const [ano, setAno] = useState("")
  const [mes, setMes] = useState("")
  const [company, setCompany] = useState("")
  const [model, setModel] = useState("")
  const [seller, setSeller] = useState("")
  const [color, setColor] = useState("")
  const [capacity, setCapacity] = useState("")
  const [clients, setClients] = useState<string[]>([])
  const [others, setOthers] = useState<OtherNote[]>([])
  const [granularity, setGranularity] = useState<Granularity>("mes")
  const [by, setBy] = useState<GroupBy>("model")
  const [sizeField, setSizeField] = useState<SizeField>("capacity")
  const [intercompany, setIntercompany] = useState(false)
  const [pick, setPick] = useState<(ChassisPick & { title: string }) | null>(null)
  const [dialogMode, setDialogMode] = useState<"nota" | "chassi">("nota")
  const [dialogModel, setDialogModel] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await send<{ rows: Row[]; others: OtherNote[]; notes: number }>("/api/contabilidade/chassis?visao=todos")
      setAll(result.rows); setOthers(result.others || []); setNotes(result.notes); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const companies = useMemo(() => [...new Set(all.map((row) => row.companyName))].sort(), [all])
  const colors = useMemo(() => [...new Set(all.map((row) => row.color || "Sem cor"))].sort(), [all])
  const capacities = useMemo(() => [...new Set(all.map((row) => row.capacity || 0))].sort((a, b) => a - b), [all])
  const clientKey = (row: Row) => row.clientDocument || `nome:${row.clientName}`
  const otherKey = (note: OtherNote) => note.clientDocument || `nome:${note.clientName}`
  const clientOptions = useMemo(() => {
    const byKey = new Map<string, { name: string; document: string; units: number }>()
    for (const row of all) {
      if (row.semNota || (!intercompany && row.intercompany)) continue
      const entry = byKey.get(clientKey(row)) || { name: row.clientName || "Sem nome", document: row.clientDocument, units: 0 }
      entry.units += rowUnits(row)
      byKey.set(clientKey(row), entry)
    }
    for (const note of others) {
      if (!intercompany && note.intercompany) continue
      if (!byKey.has(otherKey(note))) byKey.set(otherKey(note), { name: note.clientName || "Sem nome", document: note.clientDocument, units: 0 })
    }
    return [...byKey.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "pt-BR")).map(([value, entry]) => ({ value, label: `${entry.name}${entry.document ? ` (${formatDocument(entry.document)})` : ""}${entry.units ? ` · ${entry.units}` : ""}` }))
  }, [all, others, intercompany])
  const years = useMemo(() => [...new Set(all.map((row) => issuedDay(row.issuedAt).slice(0, 4)).filter(Boolean))].sort().reverse(), [all])
  const pickMonth = (year: string, month: string) => {
    setAno(year); setMes(year ? month : "")
    if (!year) { setDe(""); setAte(""); return }
    if (!month) { setDe(`${year}-01-01`); setAte(`${year}-12-31`); return }
    const last = new Date(Number(year), Number(month), 0).getDate()
    setDe(`${year}-${month}-01`); setAte(`${year}-${month}-${String(last).padStart(2, "0")}`)
  }
  const sellers = useMemo(() => [...new Set(all.flatMap((row) => [(row as Row).seller, (row as Row).externalSeller]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")), [all])
  const models = useMemo(() => [...new Set(all.map((row) => row.model || "Sem modelo"))].sort(), [all])
  const rows = useMemo(() => all.filter((row) => {
    const issued = issuedDay(row.issuedAt)
    if (de && issued < de) return false
    if (ate && issued > ate) return false
    if (company && row.companyName !== company) return false
    if (model && (row.model || "Sem modelo") !== model) return false
    if (color && (row.color || "Sem cor") !== color) return false
    if (capacity && String(row.capacity || 0) !== capacity) return false
    if (seller && (row as Row).seller !== seller && (row as Row).externalSeller !== seller) return false
    if (clients.length && !clients.includes(clientKey(row))) return false
    if (!intercompany && row.intercompany) return false
    return true
  }) as ChassisRow[], [all, de, ate, company, model, color, capacity, seller, clients, intercompany])

  const othersShown = useMemo(() => others.filter((note) => {
    const issued = issuedDay(note.issuedAt)
    if (model || color || capacity || seller) return false
    if (de && issued < de) return false
    if (ate && issued > ate) return false
    if (company && note.companyName !== company) return false
    if (clients.length && !clients.includes(otherKey(note))) return false
    if (!intercompany && note.intercompany) return false
    return true
  }).sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || ""))), [others, de, ate, company, model, color, capacity, seller, clients, intercompany])
  const othersValue = othersShown.reduce((sum, note) => sum + note.total, 0)
  const othersQuantity = othersShown.reduce((sum, note) => sum + note.quantity, 0)
  const notesWithTrailer = useMemo(() => { const map = new Map<string, number>(); for (const row of rows) if (!(row as Row).semNota) map.set(row.invoiceId, row.invoiceTotal); return map }, [rows])
  const allNotesValue = [...notesWithTrailer.values()].reduce((sum, value) => sum + value, 0) + othersValue

  const timeline = useMemo(() => chassisTimeline(rows, granularity, by), [rows, granularity, by])
  const colorOf = useMemo(() => Object.fromEntries(timeline.series.map((name, index) => [name, COLORS[index % COLORS.length]])), [timeline.series])
  const groupOf = useCallback((row: ChassisRow) => (by === "family" ? row.family : row.model) || "Sem modelo", [by])
  const valueByGroup = useMemo(() => { const map = new Map<string, number>(); for (const row of rows) map.set(groupOf(row), (map.get(groupOf(row)) || 0) + row.itemTotal); return map }, [rows, groupOf])
  const valueByCell = useMemo(() => { const map = new Map<string, number>(); for (const row of rows) { const key = `${periodKey(row.issuedAt, granularity)}|${groupOf(row)}`; map.set(key, (map.get(key) || 0) + row.itemTotal) } return map }, [rows, granularity, groupOf])
  const ranking = useMemo(() => timeline.series.map((name) => ({ name, chassis: timeline.data.reduce((sum, row) => sum + Number(row[name] || 0), 0), total: Math.round((valueByGroup.get(name) || 0) * 100) / 100 })).sort((a, b) => b.chassis - a.chassis), [timeline, valueByGroup])
  const bySize = useMemo(() => chassisBySize(rows, sizeField), [rows, sizeField])
  // vendedores por mês: cada chassi conta uma vez, para o vendedor da fábrica (se tiver) ou, senão, para o vendedor externo.
  // Sem período escolhido nos filtros, vale só o ano atual (de janeiro até o mês de hoje); com período (ano, mês ou De/Até), vale o escolhido.
  const currentYear = String(new Date().getFullYear())
  const sellerPeriod = de || ate ? `${de ? day(`${de}T12:00:00-03:00`) : "início"} a ${ate ? day(`${ate}T12:00:00-03:00`) : "hoje"}` : currentYear
  const sellerMonthly = useMemo(() => {
    const scoped = de || ate ? rows : rows.filter((item) => issuedDay(item.issuedAt).startsWith(currentYear))
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
    const dated = scoped.map((row) => issuedDay(row.issuedAt)).filter(Boolean).sort()
    const first = de || dated[0] || `${currentYear}-01-01`
    const last = [ate || dated[dated.length - 1] || today, today].sort()[0] // meses futuros não entram na média
    const months: string[] = []
    for (let year = Number(first.slice(0, 4)), month = Number(first.slice(5, 7)); `${year}-${String(month).padStart(2, "0")}` <= last.slice(0, 7) && months.length < 60; month++) {
      if (month > 12) { month = 1; year++ }
      months.push(`${year}-${String(month).padStart(2, "0")}`)
    }
    const perSeller = new Map<string, { name: string; kind: "fabrica" | "externo"; total: number; value: number; byMonth: Record<string, number> }>()
    let without = 0
    for (const row of scoped) {
      const units = rowUnits(row), month = issuedDay(row.issuedAt).slice(0, 7)
      const name = (row as Row).seller || (row as Row).externalSeller || ""
      if (!name) { without += units; continue }
      if (!months.includes(month)) continue
      const entry = perSeller.get(name) || { name, kind: (row as Row).seller ? "fabrica" : "externo", total: 0, value: 0, byMonth: {} }
      entry.total += units; entry.value += row.itemTotal; entry.byMonth[month] = (entry.byMonth[month] || 0) + units
      perSeller.set(name, entry)
    }
    const ranked = [...perSeller.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"))
    const shown = ranked.slice(0, 9), others = ranked.slice(9)
    const series = [...shown.map((entry) => entry.name), ...(others.length ? ["Outros"] : [])]
    const data = months.map((month) => {
      const row: Record<string, number | string> = { period: month, label: `${month.slice(5)}/${month.slice(2, 4)}` }
      let total = 0
      for (const entry of shown) { row[entry.name] = entry.byMonth[month] || 0; total += entry.byMonth[month] || 0 }
      if (others.length) { const sum = others.reduce((acc, entry) => acc + (entry.byMonth[month] || 0), 0); row.Outros = sum; total += sum }
      row.total = total
      return row
    })
    const grand = ranked.reduce((sum, entry) => sum + entry.total, 0)
    const count = Math.max(1, months.length)
    return { months: count, series, data, ranked: ranked.map((entry) => ({ ...entry, average: entry.total / count })), others: others.length, average: grand / count, total: grand, without }
  }, [rows, de, ate, currentYear])
  const chartData = timeline.data.map((row) => ({ ...row, label: periodLabel(String(row.period), granularity) }))
  const units = useMemo(() => trailerUnits(rows), [rows])
  const distinct = units.units
  const total = rows.reduce((sum, row) => sum + row.itemTotal, 0)
  const withoutNoteUnits = useMemo(() => new Set(rows.filter((row) => (row as Row).semNota).map((row) => row.chassis)).size, [rows])
  const pricedUnits = Math.max(0, distinct - withoutNoteUnits)

  // ao abrir pela coluna do mês entram TODAS as notas e carretas do período; o modelo se escolhe dentro da lista
  const openedAll = useMemo(() => (pick ? pickChassis(rows, { ...pick, name: undefined }) : []), [pick, rows])
  const opened = useMemo(() => (dialogModel ? openedAll.filter((row) => groupOf(row) === dialogModel) : openedAll), [openedAll, dialogModel, groupOf])
  const dialogModels = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of openedAll) map.set(groupOf(row), (map.get(groupOf(row)) || 0) + rowUnits(row))
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [openedAll, groupOf])
  const open = (next: ChassisPick, title: string) => { setPick({ ...next, by, granularity, title }); setDialogModel(next.name || "") }
  // o que a nota tem no total (todos os chassis dela, mesmo os de outro modelo ou fora do filtro)
  const noteTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of all) map.set(row.invoiceId, (map.get(row.invoiceId) || 0) + rowUnits(row))
    return map
  }, [all])
  const notesOpened = useMemo(() => {
    const groups = new Map<string, ChassisRow[]>()
    for (const row of opened) (groups.get(row.invoiceId) || groups.set(row.invoiceId, []).get(row.invoiceId)!).push(row)
    return [...groups.values()].map((items) => {
      const prices = items.map((item) => item.unitPrice)
      return { first: items[0], items, chassisValue: items.reduce((sum, item) => sum + item.itemTotal, 0), minUnit: Math.min(...prices), maxUnit: Math.max(...prices), units: items.reduce((sum, item) => sum + rowUnits(item), 0), inNote: noteTotals.get(items[0].invoiceId) || items.length }
    })
  }, [opened, noteTotals])

  function exportOpened() {
    if (!pick) return
    const number = (value: number) => String(value).replace(".", ",")
    const note = (row: ChassisRow) => `${row.number}${row.series ? `/${row.series}` : ""}`
    const header = dialogMode === "nota"
      ? ["Nota", "Emissão", "Cliente", "CPF/CNPJ", "Chassis no recorte", "Chassis na nota", "Valor por chassi", "Valor dos chassis", "Valor total da nota", "Empresa emitente", "Chassis"]
      : ["Nota", "Emissão", "Chassi", "Modelo", "Descrição / tamanho", "Cor", "Ano", "PBT (t)", "Capacidade (t)", "Eixos", "Quantidade", "Valor unitário", "Valor do chassi", "Chassis na nota", "Valor total da nota", "Cliente", "CPF/CNPJ", "Empresa emitente", "Vendedor (fábrica)", "Vendedor externo", "Consumidor"]
    const lines = dialogMode === "nota"
      ? notesOpened.map((group) => [note(group.first), day(group.first.issuedAt), group.first.clientName, formatDocument(group.first.clientDocument), group.units, group.inNote, group.minUnit === group.maxUnit ? number(group.minUnit) : `${number(group.minUnit)} a ${number(group.maxUnit)}`, number(group.chassisValue), number(group.first.invoiceTotal), group.first.companyName, group.items.map((item) => `${item.chassis || "lote sem nº de chassi"}${item.quantity > 1 ? ` x${item.quantity}` : ""} (${number(item.itemTotal)})`).join(" ; ")])
      : opened.map((row) => [note(row), day(row.issuedAt), row.chassis || "(lote sem nº de chassi)", row.model, (row as Row).sizeNote || "", row.color, row.year, number(row.pbt), number(row.capacity), row.axles, row.quantity, number(row.unitPrice), number(row.itemTotal), noteTotals.get(row.invoiceId) || 1, number(row.invoiceTotal), row.clientName, formatDocument(row.clientDocument), row.companyName, (row as Row).seller || "", (row as Row).externalSeller || "", (row as Row).consumer || ""])
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n")
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `chassis-notas-${dialogMode === "nota" ? "por-nota" : "por-chassi"}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <PageShell title="Chassis" description="Quantas carretas foram emitidas nas notas de venda (com número de chassi ou em lote), de qual modelo, em qual período e de que tamanho. Clique em uma barra para abrir as notas daquele recorte."
      actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>}>
      <SectionCard title="Filtros">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Ano
            <select value={ano} onChange={(event) => pickMonth(event.target.value, mes)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Mês
            <select value={mes} disabled={!ano} onChange={(event) => pickMonth(ano, event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground disabled:opacity-50"><option value="">Todos</option>{["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"].map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => { setDe(event.target.value); setAno(""); setMes("") }} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => { setAte(event.target.value); setAno(""); setMes("") }} className="mt-1 w-40" /></label>
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
          <label className="text-xs text-muted-foreground">Vendedor
            <select value={seller} onChange={(event) => setSeller(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todos</option>{sellers.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <MultiSelectSearch label="Clientes (marque quantos quiser)" options={clientOptions} value={clients} onChange={setClients} placeholder="Todos os clientes" searchPlaceholder="Pesquisar cliente por nome ou CNPJ/CPF..." />
          <div className="text-xs text-muted-foreground">Período do gráfico
            <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["mes", "Mês"], ["semana", "Semana"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setGranularity(value)} className={`rounded px-3 py-1 ${granularity === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
          </div>
          <div className="text-xs text-muted-foreground">Agrupar por
            <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["model", "Modelo (FZ 1E)"], ["family", "Linha (FZ)"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setBy(value)} className={`rounded px-3 py-1 ${by === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={intercompany} onChange={(event) => setIntercompany(event.target.checked)} />Incluir vendas entre as empresas ND</label>
          {(de || ate || company || model || color || capacity || seller || clients.length) ? <Button variant="ghost" size="sm" onClick={() => { setDe(""); setAte(""); setAno(""); setMes(""); setCompany(""); setModel(""); setColor(""); setCapacity(""); setSeller(""); setClients([]) }}>Limpar filtros</Button> : null}
          {loading ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Carretas emitidas" value={distinct.toLocaleString("pt-BR")} hint={`${units.numbered.toLocaleString("pt-BR")} com número de chassi · ${units.batch.toLocaleString("pt-BR")} em lote sem número${withoutNoteUnits ? ` · ${withoutNoteUnits.toLocaleString("pt-BR")} sem nota (cadastro)` : ""}`} />
        <Card label="Valor das carretas" value={brl(total)} hint={`valor médio por carreta ${brl(pricedUnits ? total / pricedUnits : 0)}${withoutNoteUnits ? " (só as com nota)" : ""}`} />
        <Card label="Notas sem carreta" value={othersShown.length.toLocaleString("pt-BR")} hint={`${brl(othersValue)} · ${othersQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} itens (peças, madeira e outros)`} />
        <Card label="Total das notas de venda" value={brl(allNotesValue)} hint={`${(notesWithTrailer.size + othersShown.length).toLocaleString("pt-BR")} nota(s): ${notesWithTrailer.size.toLocaleString("pt-BR")} com carreta + ${othersShown.length.toLocaleString("pt-BR")} sem`} />
      </div>

      <SectionCard title={`Carretas por ${granularity === "mes" ? "mês" : "semana"} e ${by === "model" ? "modelo" : "linha"}`} description="Cada cor é um modelo. Clique na barra para ver todas as notas e carretas do período; dentro da lista você filtra por modelo. Chassis do cadastro sem nota entram pela data da primeira menção na conversa.">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const period = String((payload[0].payload as { period?: string }).period || "")
                const lines = (payload as TipEntry[]).filter((entry) => Number(entry.value) > 0).map((entry) => ({ name: String(entry.dataKey), color: String(entry.color), chassis: Number(entry.value), total: valueByCell.get(`${period}|${String(entry.dataKey)}`) || 0 }))
                const chassisTotal = lines.reduce((sum, line) => sum + line.chassis, 0), valueTotal = lines.reduce((sum, line) => sum + line.total, 0)
                return (
                  <div className="rounded-md border bg-background p-3 text-sm shadow-md">
                    <div className="font-semibold capitalize">{periodTitle(period, granularity) || String(label)}</div>
                    <div className="mb-2 mt-0.5 rounded bg-muted px-2 py-1 font-semibold">Total: {chassisTotal.toLocaleString("pt-BR")} carreta(s) · {brl(valueTotal)}</div>
                    {lines.map((line) => <div key={line.name} className="flex items-center justify-between gap-4"><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: line.color }} />{line.name}</span><span className="whitespace-nowrap font-medium">{line.chassis} · {brl(line.total)}</span></div>)}
                  </div>
                )
              }} />
              <Legend onClick={(entry) => open({ name: String(entry.dataKey || entry.value) }, `${String(entry.dataKey || entry.value)} · todo o período filtrado`)} wrapperStyle={{ cursor: "pointer", fontSize: 12 }} />
              {timeline.series.map((name) => (
                <Bar key={name} dataKey={name} stackId="chassis" fill={colorOf[name]} cursor="pointer"
                  onClick={(entry) => { const period = String((entry as { payload?: { period?: string } })?.payload?.period || ""); open({ period }, `${periodTitle(period, granularity)} · todos os modelos`) }} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title={`Vendas por vendedor e mês · ${sellerPeriod}`} description={`${de || ate ? "Período escolhido nos filtros." : `Referente a ${currentYear} (ano atual, de janeiro até este mês); escolha Ano, Mês ou De/Até nos filtros para ver outro período.`} Cada coluna é um mês, empilhada por vendedor (chassis vendidos). A linha tracejada é a média mensal de vendas no período. Clique em uma cor para filtrar pelo vendedor. ${sellerMonthly.without.toLocaleString("pt-BR")} chassi(s) sem vendedor informado não aparecem.`}>
        {sellerMonthly.series.length ? (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <Card label="Vendas no período (com vendedor)" value={sellerMonthly.total.toLocaleString("pt-BR")} hint={`${sellerMonthly.months} mês(es) · ${sellerMonthly.ranked.length} vendedor(es)`} />
              <Card label="Média mensal de vendas" value={sellerMonthly.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} hint="chassis por mês, somando todos os vendedores" />
              <Card label="Melhor mês" value={String([...sellerMonthly.data].sort((a, b) => Number(b.total) - Number(a.total))[0]?.label || "-")} hint={`${Number([...sellerMonthly.data].sort((a, b) => Number(b.total) - Number(a.total))[0]?.total || 0).toLocaleString("pt-BR")} chassis`} />
            </div>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sellerMonthly.data} margin={{ top: 16, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0].payload as Record<string, number | string>
                    const lines = sellerMonthly.series.map((name, index) => ({ name, value: Number(row[name] || 0), color: COLORS[index % COLORS.length] })).filter((line) => line.value > 0).sort((a, b) => b.value - a.value)
                    return (
                      <div className="rounded-md border bg-background p-3 text-sm shadow-md">
                        <div className="font-semibold">{String(row.label)}</div>
                        <div className="mb-2 mt-0.5 rounded bg-muted px-2 py-1 font-semibold">Total: {Number(row.total).toLocaleString("pt-BR")} chassi(s)</div>
                        {lines.map((line) => <div key={line.name} className="flex items-center justify-between gap-4"><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: line.color }} />{line.name}</span><span className="font-medium">{line.value}</span></div>)}
                      </div>
                    )
                  }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={sellerMonthly.average} stroke="#b91c1c" strokeDasharray="6 4" label={{ value: `média ${sellerMonthly.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/mês`, position: "insideTopRight", fill: "#b91c1c", fontSize: 12 }} />
                  {sellerMonthly.series.map((name, index) => <Bar key={name} dataKey={name} stackId="seller" fill={name === "Outros" ? "#94a3b8" : COLORS[index % COLORS.length]} cursor={name === "Outros" ? "default" : "pointer"} onClick={() => { if (name !== "Outros") setSeller(name) }} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {sellerMonthly.others ? <p className="mt-1 text-xs text-muted-foreground">Os 9 que mais venderam aparecem separados; os outros {sellerMonthly.others} estão em "Outros" (use o filtro Vendedor para ver cada um).</p> : null}

            <p className="mb-1 mt-5 text-sm font-semibold">Média mensal de cada vendedor</p>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sellerMonthly.ranked.slice(0, 20)} margin={{ top: 20, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" interval={0} angle={-35} textAnchor="end" height={80} tick={{ fontSize: 11 }} tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}…` : value)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const entry = payload[0].payload as { name: string; total: number; average: number; value: number; kind: string }
                    return (
                      <div className="rounded-md border bg-background p-3 text-sm shadow-md">
                        <div className="font-semibold">{entry.name}</div>
                        <div className="text-muted-foreground">{entry.kind === "fabrica" ? "Vendedor da fábrica" : "Vendedor externo"}</div>
                        <div className="mt-1 text-muted-foreground">Média mensal: <span className="font-medium text-foreground">{entry.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} chassis/mês</span></div>
                        <div className="text-muted-foreground">Total no período: <span className="font-medium text-foreground">{entry.total.toLocaleString("pt-BR")} em {sellerMonthly.months} mês(es)</span></div>
                        <div className="text-muted-foreground">Valor total: <span className="font-medium text-foreground">{brl(entry.value)}</span></div>
                      </div>
                    )
                  }} cursor={{ fill: "rgba(30,58,138,0.08)" }} />
                  <Bar dataKey="average" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(entry) => setSeller(clickedName(entry))} label={{ position: "top", fontSize: 11, formatter: (value: number) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) }}>
                    {sellerMonthly.ranked.slice(0, 20).map((entry) => <Cell key={entry.name} fill={entry.kind === "fabrica" ? "#1e3a8a" : "#0f766e"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Azul: vendedor da fábrica; verde: vendedor externo (loja ou representante). Média = chassis vendidos ÷ {sellerMonthly.months} mês(es) do período. {sellerMonthly.ranked.length > 20 ? `Mostrando os 20 maiores de ${sellerMonthly.ranked.length}.` : ""}</p>
          </>
        ) : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : "Nenhum chassi com vendedor informado neste período."}</p>}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={`Chassis por ${by === "model" ? "modelo" : "linha"} no período filtrado`} description="Clique na barra para abrir as notas.">
          <div style={{ height: Math.max(180, ranking.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                <Tooltip content={<SummaryTip />} cursor={{ fill: "rgba(30,58,138,0.08)" }} />
                <Bar dataKey="chassis" cursor="pointer" radius={[0, 3, 3, 0]} fill="#1e3a8a" onClick={(entry) => { const name = clickedName(entry); open({ name }, `${name} · período filtrado`) }} label={{ position: "right", fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Chassis por tamanho" description="O tamanho vem da descrição da nota: capacidade de carga e PBT em toneladas e número de eixos. A nota não traz comprimento nem largura: a descrição/tamanho vem do cadastro de chassis (abaixo).">
          <div className="mb-2 flex rounded-md border p-0.5 text-sm">
            {(["capacity", "pbt", "axles"] as SizeField[]).map((field) => <button key={field} type="button" onClick={() => setSizeField(field)} className={`rounded px-3 py-1 ${sizeField === field ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{sizeName[field]}</button>)}
          </div>
          <div style={{ height: Math.max(180, bySize.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySize.map((entry) => ({ ...entry, name: entry.label }))} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
                <Tooltip content={<SummaryTip />} cursor={{ fill: "rgba(15,118,110,0.08)" }} />
                <Bar dataKey="chassis" cursor="pointer" radius={[0, 3, 3, 0]} fill="#0f766e" onClick={(entry) => { const name = clickedName(entry); const found = bySize.find((item) => item.label === name); if (found) open({ size: { field: sizeField, value: found.value } }, `${sizeName[sizeField]}: ${name}`) }} label={{ position: "right", fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Resumo por modelo" description="Clique em uma linha para abrir as notas.">
        <DataTable headers={[by === "model" ? "Modelo" : "Linha", "Carretas", "% do total", "Valor total", "Valor médio"]} empty={!ranking.length && !loading}>
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

      <SectionCard title="Notas sem carreta (peças, madeira, chapas e outros)" description={`${othersShown.length.toLocaleString("pt-BR")} nota(s) · ${brl(othersValue)} · ${othersQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} itens no total. Entram no "Total das notas de venda", mas não nas carretas.${model || color || capacity ? " Com filtro de modelo, cor ou capacidade esta lista fica vazia." : ""}`}>
        <DataTable headers={["Nota", "Emissão", "Cliente", "CPF/CNPJ", "Itens", "Quantidade", "Valor da nota", "Empresa"]} empty={!othersShown.length && !loading} stickyHeader viewportClassName="max-h-[45vh]">
          {othersShown.map((note) => (
            <TableRow key={note.invoiceId}>
              <TableCell className="whitespace-nowrap">{note.number}{note.series ? `/${note.series}` : ""}</TableCell>
              <TableCell className="whitespace-nowrap">{day(note.issuedAt)}</TableCell>
              <TableCell className="max-w-[240px] truncate" title={note.clientName}>{note.clientName || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDocument(note.clientDocument) || "-"}</TableCell>
              <TableCell className="max-w-[320px] truncate text-xs" title={note.summary}>{note.summary || "-"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{note.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{brl(note.total)}</TableCell>
              <TableCell className="whitespace-nowrap">{note.companyName}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <RegistrySection />

      <Dialog open={!!pick} onOpenChange={(value) => { if (!value) setPick(null) }}>
        <DialogContent className="max-h-[92vh] w-[96vw] overflow-hidden sm:max-w-[1280px]">
          <DialogHeader>
            <DialogTitle>Notas emitidas · {pick?.title}</DialogTitle>
            <DialogDescription>{opened.reduce((sum, row) => sum + rowUnits(row), 0).toLocaleString("pt-BR")} carreta(s) em {notesOpened.length.toLocaleString("pt-BR")} nota(s) · {brl(opened.reduce((sum, row) => sum + row.itemTotal, 0))} nas carretas{de || ate ? ` · filtro ${de ? day(`${de}T12:00:00-03:00`) : "início"} a ${ate ? day(`${ate}T12:00:00-03:00`) : "hoje"}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5 text-sm">
              {([["nota", "Por nota (vários chassis na mesma linha)"], ["chassi", "Um chassi por linha"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setDialogMode(value)} className={`rounded px-3 py-1 ${dialogMode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{label}</button>)}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">Modelo
              <select value={dialogModel} onChange={(event) => setDialogModel(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                <option value="">Todos os modelos ({openedAll.reduce((sum, row) => sum + rowUnits(row), 0).toLocaleString("pt-BR")})</option>
                {dialogModels.map(([name, units]) => <option key={name} value={name}>{name} ({units.toLocaleString("pt-BR")})</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" size="sm" onClick={exportOpened} disabled={!opened.length}><Download className="h-4 w-4" />Planilha das notas</Button>
          </div>

          {dialogMode === "nota" ? (
            <DataTable headers={["Nota", "Emissão", "Cliente", "CPF/CNPJ", "Carretas", "Chassis da nota (separados)", "Valor por carreta", "Valor das carretas", "Valor total da nota", "Empresa"]} empty={!notesOpened.length} stickyHeader viewportClassName="max-h-[58vh]">
              {notesOpened.map((group) => (
                <TableRow key={group.first.invoiceId} className="align-top">
                  <TableCell className="whitespace-nowrap font-medium">{(group.first as Row).semNota ? "sem nota" : `${group.first.number}${group.first.series ? `/${group.first.series}` : ""}`}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(group.first.issuedAt)}</TableCell>
                  <TableCell className="max-w-[220px]" title={group.first.clientName}><div className="truncate">{group.first.clientName || "-"}</div>{group.first.intercompany ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">entre empresas</span> : null}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDocument(group.first.clientDocument) || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{group.units}{group.inNote > group.units ? <div className="text-[10px] text-muted-foreground">de {group.inNote} na nota</div> : null}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {group.items.map((item, itemIndex) => (
                        <div key={`${item.chassis}-${itemIndex}`} className="flex items-center justify-between gap-4 whitespace-nowrap rounded bg-muted/40 px-2 py-1 text-xs">
                          <span>{item.chassis ? <span className="font-mono font-medium">{item.chassis}</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">lote sem nº de chassi</span>} · {item.model || "-"} · {item.color || "-"} · {tons(item.capacity)}{(item as Row).sizeNote ? ` · ${(item as Row).sizeNote}` : ""}</span>
                          <span className="font-medium">{item.quantity > 1 ? `${item.quantity} × ${brl(item.unitPrice)} = ` : ""}{brl(item.itemTotal)}</span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">{group.minUnit === group.maxUnit ? brl(group.minUnit) : <>{brl(group.minUnit)}<div className="text-[10px] text-muted-foreground">até {brl(group.maxUnit)}</div></>}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium">{brl(group.chassisValue)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{brl(group.first.invoiceTotal)}</TableCell>
                  <TableCell className="whitespace-nowrap">{group.first.companyName}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          ) : (
            <DataTable headers={["Nota", "Emissão", "Chassi", "Modelo", "Cor", "Tamanho", "Qtd.", "Valor unitário", "Valor da linha", "Carretas na nota", "Valor total da nota", "Cliente", "CPF/CNPJ", "Empresa", "Vendedor"]} empty={!opened.length} stickyHeader viewportClassName="max-h-[58vh]">
              {opened.map((row, index) => {
                const inNote = noteTotals.get(row.invoiceId) || 1
                const startsGroup = index === 0 || opened[index - 1].invoiceId !== row.invoiceId
                return (
                  <TableRow key={`${row.invoiceId}-${row.chassis}-${index}`} className={startsGroup && index > 0 ? "border-t-2" : ""}>
                    <TableCell className="whitespace-nowrap">{row.number}{row.series ? `/${row.series}` : ""}</TableCell>
                    <TableCell className="whitespace-nowrap">{day(row.issuedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{row.chassis || <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-amber-800">lote sem nº de chassi</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.model || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.color || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">PBT {tons(row.pbt)} · cap. {tons(row.capacity)} · {row.axles ? `${row.axles} eixo${row.axles > 1 ? "s" : ""}` : "-"}{(row as Row).sizeNote ? <div className="text-muted-foreground">{(row as Row).sizeNote}</div> : null}</TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{brl(row.unitPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.itemTotal)}</TableCell>
                    <TableCell className="text-right">{inNote > 1 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{inNote} na nota</span> : "1"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{brl(row.invoiceTotal)}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={row.clientName}>{row.clientName || "-"}{row.intercompany ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">entre empresas</span> : null}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDocument(row.clientDocument) || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.companyName}</TableCell>
                    <TableCell className="whitespace-nowrap">{(row as Row).seller || (row as Row).externalSeller ? <>{(row as Row).seller || "-"}{(row as Row).externalSeller ? <div className="text-xs text-muted-foreground">{(row as Row).externalSeller}</div> : null}</> : "-"}</TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
