"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronRight, ExternalLink, RefreshCw, Settings2 } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SelectField } from "@/components/operations/shared"
import { useAuth } from "@/lib/auth-context"
import type { DashboardChart, DashboardSection, DetailTable, Indicator, SectionResult } from "@/lib/dashboard-erp"

type ChartType = "bar" | "line" | "area"
type PeriodPreset = "mes" | "mes-anterior" | "trimestre" | "ano" | "personalizado"
type Config = { period: PeriodPreset; start: string; end: string; costCenterId: string; providerId: string; sections: DashboardSection[]; hiddenIndicators: string[]; chartType: ChartType; refreshMinutes: number }
type Payload = { period: { start: string; end: string; today: string }; allowedSections: DashboardSection[]; sections: Partial<Record<DashboardSection, SectionResult>>; options: { costCenters: Array<{ id: string; name: string }>; providers: Array<{ id: string; name: string }> }; warnings: string[]; generatedAt: string }

const sectionTitles: Record<DashboardSection, string> = { financeiro: "Financeiro", estoque: "Estoque", os: "Ordens de Serviço", frota: "Frota", comercial: "Comercial" }
const sectionOrder: DashboardSection[] = ["financeiro", "os", "estoque", "frota", "comercial"]
const chartColors = ["#2563eb", "#38bdf8", "#1e3a8a", "#16a34a", "#f59e0b", "#64748b", "#93c5fd", "#a78bfa"]

function iso(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function presetRange(preset: PeriodPreset, custom: { start: string; end: string }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  if (preset === "mes-anterior") return { start: iso(new Date(year, month - 1, 1)), end: iso(new Date(year, month, 0)) }
  if (preset === "trimestre") return { start: iso(new Date(year, month - 2, 1)), end: iso(now) }
  if (preset === "ano") return { start: iso(new Date(year, 0, 1)), end: iso(now) }
  if (preset === "personalizado" && custom.start && custom.end) return custom
  return { start: iso(new Date(year, month, 1)), end: iso(now) }
}

function formatValue(indicator: Indicator) {
  const value = Number(indicator.value || 0)
  if (indicator.format === "money") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Math.abs(value) >= 10000 ? 0 : 2 })
  if (indicator.format === "percent") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
  if (indicator.format === "hours") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`
  if (indicator.format === "times") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`
  return value.toLocaleString("pt-BR")
}

const defaultConfig: Config = { period: "mes", start: "", end: "", costCenterId: "", providerId: "", sections: [], hiddenIndicators: [], chartType: "bar", refreshMinutes: 0 }

export function ErpDashboard() {
  const { user, companies, selectCompany } = useAuth()
  const [config, setConfig] = useState<Config>(defaultConfig)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [saveWarning, setSaveWarning] = useState("")
  const [detail, setDetail] = useState<{ indicator: Indicator; table?: DetailTable & { total: number }; error?: string } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const range = presetRange(config.period, { start: config.start, end: config.end })

  useEffect(() => {
    fetch("/api/dashboard/erp/preferences", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data?.config) setConfig({ ...defaultConfig, ...data.config }) })
      .catch(() => undefined)
      .finally(() => setConfigLoaded(true))
  }, [])

  const query = useMemo(() => {
    const params = new URLSearchParams({ start: range.start, end: range.end })
    if (config.costCenterId) params.set("costCenterId", config.costCenterId)
    if (config.providerId) params.set("providerId", config.providerId)
    return params
  }, [range.start, range.end, config.costCenterId, config.providerId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/erp?${query}`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`)
      setPayload(data)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar o dashboard.")
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { if (configLoaded) void load() }, [configLoaded, load, user?.company.id])

  useEffect(() => {
    if (!config.refreshMinutes) return
    const timer = setInterval(() => void load(), config.refreshMinutes * 60_000)
    return () => clearInterval(timer)
  }, [config.refreshMinutes, load])

  function update(patch: Partial<Config>) {
    setConfig((current) => {
      const next = { ...current, ...patch }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        fetch("/api/dashboard/erp/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: next }) })
          .then(async (response) => setSaveWarning(response.ok ? "" : (await response.json().catch(() => null))?.error || "Configuração não salva."))
          .catch(() => setSaveWarning("Configuração não salva."))
      }, 600)
      return next
    })
  }

  async function openDetail(indicator: Indicator) {
    setDetail({ indicator })
    try {
      const params = new URLSearchParams(query)
      params.set("detail", indicator.key)
      const response = await fetch(`/api/dashboard/erp?${params}`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`)
      setDetail({ indicator, table: data.detail })
    } catch (reason) {
      setDetail({ indicator, error: reason instanceof Error ? reason.message : "Erro ao carregar os registros." })
    }
  }

  const allowed = payload?.allowedSections || []
  const visibleSections = sectionOrder.filter((section) => allowed.includes(section) && (!config.sections.length || config.sections.includes(section)) && payload?.sections[section])
  const toggleList = <T extends string>(list: T[], item: T, on: boolean) => on ? Array.from(new Set([...list, item])) : list.filter((value) => value !== item)

  return (
    <PageShell
      title="Dashboard"
      description={`Indicadores de ${range.start.split("-").reverse().join("/")} a ${range.end.split("-").reverse().join("/")}${payload ? ` · atualizado às ${new Date(payload.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}. Clique em um indicador para ver os registros.`}
      actions={<>
        <Button variant="outline" onClick={() => setConfigOpen((open) => !open)}><Settings2 className="h-4 w-4" />Configurar painel</Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </>}
    >
      {configOpen ? <Card>
        <CardHeader><CardTitle className="text-base">Configuração do painel</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectField label="Período de análise" value={config.period} onChange={(value) => update({ period: value as PeriodPreset, ...(value === "personalizado" && !config.start ? range : {}) })} options={[{ value: "mes", label: "Este mês" }, { value: "mes-anterior", label: "Mês anterior" }, { value: "trimestre", label: "Últimos 3 meses" }, { value: "ano", label: "Este ano" }, { value: "personalizado", label: "Personalizado" }]} />
            {config.period === "personalizado" ? <>
              <div className="space-y-2"><Label>De</Label><Input type="date" value={config.start} max={config.end || undefined} onChange={(event) => update({ start: event.target.value })} /></div>
              <div className="space-y-2"><Label>Até</Label><Input type="date" value={config.end} min={config.start || undefined} onChange={(event) => update({ end: event.target.value })} /></div>
            </> : null}
            {companies.length > 1 ? <SelectField label="Empresa / filial" value={user?.company.id || ""} onChange={(value) => void selectCompany(value)} options={companies.map((company) => ({ value: company.id, label: company.tradeName || company.name }))} /> : null}
            <SelectField label="Usuário / equipe (OS)" value={config.providerId || "todos"} onChange={(value) => update({ providerId: value === "todos" ? "" : value })} options={[{ value: "todos", label: "Todos" }, ...(payload?.options.providers || []).map((item) => ({ value: item.id, label: item.name }))]} />
            <SelectField label="Centro de custo (financeiro)" value={config.costCenterId || "todos"} onChange={(value) => update({ costCenterId: value === "todos" ? "" : value })} options={[{ value: "todos", label: "Todos" }, ...(payload?.options.costCenters || []).map((item) => ({ value: item.id, label: item.name }))]} />
            <SelectField label="Tipo de gráfico" value={config.chartType} onChange={(value) => update({ chartType: value as ChartType })} options={[{ value: "bar", label: "Barras" }, { value: "line", label: "Linhas" }, { value: "area", label: "Área" }]} />
            <SelectField label="Atualização automática" value={String(config.refreshMinutes)} onChange={(value) => update({ refreshMinutes: Number(value) })} options={[{ value: "0", label: "Manual" }, { value: "1", label: "A cada 1 minuto" }, { value: "5", label: "A cada 5 minutos" }, { value: "15", label: "A cada 15 minutos" }, { value: "30", label: "A cada 30 minutos" }]} />
          </div>
          <div className="space-y-2">
            <Label>Seções e indicadores exibidos</Label>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sectionOrder.filter((section) => allowed.includes(section)).map((section) => {
                const sectionOn = !config.sections.length || config.sections.includes(section)
                return <div key={section} className="rounded-md border p-3">
                  <label className="flex items-center gap-2 font-medium"><Checkbox checked={sectionOn} onCheckedChange={(checked) => update({ sections: toggleList(config.sections.length ? config.sections : allowed, section, checked === true) })} />{sectionTitles[section]}</label>
                  <div className="mt-2 space-y-1 pl-6">
                    {(payload?.sections[section]?.indicators || []).map((indicator) => <label key={indicator.key} className="flex items-center gap-2 text-sm"><Checkbox checked={!config.hiddenIndicators.includes(indicator.key)} onCheckedChange={(checked) => update({ hiddenIndicators: toggleList(config.hiddenIndicators, indicator.key, checked !== true) })} />{indicator.label}</label>)}
                  </div>
                </div>
              })}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Permissão de visualização: cada seção aparece somente para quem tem acesso ao módulo correspondente (Configurações › Usuários e permissões). Você vê: {allowed.map((section) => sectionTitles[section]).join(", ") || "nenhuma seção"}. A configuração é salva para o seu usuário.</p>
          {saveWarning ? <p className="text-sm text-amber-700">{saveWarning}</p> : null}
        </CardContent>
      </Card> : null}

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {payload?.warnings.length ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Dados indisponíveis: {payload.warnings.join(" ")}</p> : null}
      {payload && !allowed.length ? <p className="text-sm text-muted-foreground">Seu usuário não tem permissão para nenhum módulo do dashboard.</p> : null}
      {!payload && loading ? <div className="py-16 text-center text-sm text-muted-foreground">Carregando indicadores...</div> : null}

      {visibleSections.map((section) => {
        const result = payload!.sections[section]!
        const indicators = result.indicators.filter((indicator) => !config.hiddenIndicators.includes(indicator.key))
        const charts = result.charts.filter((chart) => chart.series.length)
        return <section key={section} className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><span aria-hidden className="h-4 w-1 rounded-full bg-primary" />{sectionTitles[section]}</h2>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <IndicatorList indicators={indicators} onOpen={(indicator) => void openDetail(indicator)} />
            <div className="grid gap-4 md:grid-cols-2">
              {charts.map((chart) => <Card key={chart.key} className={chart.wide ? "md:col-span-2" : ""}><CardHeader className="pb-1"><CardTitle className="text-sm font-semibold">{chart.title}</CardTitle></CardHeader><CardContent><ChartView type={config.chartType} chart={chart} /></CardContent></Card>)}
              {!charts.length ? <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground md:col-span-2">Sem gráficos para este módulo no período.</p> : null}
            </div>
          </div>
          {result.notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
        </section>
      })}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{detail?.indicator.label}: {detail ? formatValue(detail.indicator) : ""}</DialogTitle>
            <DialogDescription>{detail?.table ? `${detail.table.title} · ${detail.table.total} registro(s)${detail.table.total > detail.table.rows.length ? `, exibindo ${detail.table.rows.length}` : ""}` : detail?.error || "Carregando registros..."}</DialogDescription>
          </DialogHeader>
          {detail?.table ? <>
            <DataTable headers={detail.table.columns} empty={!detail.table.rows.length}>
              {detail.table.rows.map((row, index) => <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>)}
            </DataTable>
            <Button asChild variant="outline" className="w-fit"><Link href={detail.table.href}><ExternalLink className="h-4 w-4" />Abrir módulo</Link></Button>
          </> : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

/** Indicadores de um módulo numa lista compacta (um só cartão): cada linha abre os registros por trás do número. */
function IndicatorList({ indicators, onOpen }: { indicators: Indicator[]; onOpen: (indicator: Indicator) => void }) {
  return (
    <Card className="overflow-hidden py-0">
      <ul className="divide-y divide-border">
        {indicators.map((indicator) => (
          <li key={indicator.key}>
            <button type="button" onClick={() => onOpen(indicator)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{indicator.label}</span>
                {indicator.hint ? <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={indicator.hint}>{indicator.hint}</span> : null}
              </span>
              <span className={`text-lg font-semibold tabular-nums tracking-tight ${indicator.tone === "bad" ? "text-destructive" : indicator.tone === "good" ? "text-emerald-600" : "text-foreground"}`}>{formatValue(indicator)}</span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-primary" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ChartView({ type, chart }: { type: ChartType; chart: DashboardChart }) {
  const { series, bars } = chart
  const xKey = Object.keys(series[0] || {}).find((key) => !bars.some((bar) => bar.key === key)) || "x"
  const isMoney = chart.format ? chart.format === "money" : bars.some((bar) => /custo|entradas|saidas|valor/i.test(bar.key))
  const compact = (value: number) => isMoney ? Number(value).toLocaleString("pt-BR", { notation: "compact", style: "currency", currency: "BRL" }) : Number(value).toLocaleString("pt-BR")
  const full = (value: number) => isMoney ? Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : Number(value).toLocaleString("pt-BR")
  const hasData = series.some((row) => bars.some((bar) => Number(row[bar.key] || 0) !== 0))
  if (!hasData) return <div className="grid h-24 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Sem dados no período</div>

  if (chart.kind === "pie") {
    const valueKey = bars[0].key
    const rows = series.filter((row) => Number(row[valueKey] || 0) > 0)
    const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0)
    return <div className="h-[260px] w-full"><ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={xKey} innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none">{rows.map((row, index) => <Cell key={String(row[xKey])} fill={chartColors[index % chartColors.length]} />)}</Pie>
        <Tooltip formatter={(value, name) => [`${full(Number(value))} (${total ? Math.round((Number(value) / total) * 100) : 0}%)`, String(name)]} />
        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, maxWidth: "45%" }} />
      </PieChart>
    </ResponsiveContainer></div>
  }

  if (chart.kind === "hbar") {
    const height = Math.min(360, Math.max(180, series.length * 34 + 40))
    return <div style={{ height }} className="w-full"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={series} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey={xKey} width={118} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => full(Number(value))} />
        {bars.map((bar, index) => <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={chartColors[index % chartColors.length]} radius={[0, 4, 4, 0]} />)}
      </BarChart>
    </ResponsiveContainer></div>
  }

  // elementos em lista (com key) e não dentro de um fragmento: o Recharts 3 só enxerga eixos e legenda que são filhos diretos
  const common = [
    <CartesianGrid key="grid" strokeDasharray="3 3" vertical={false} />,
    <XAxis key="x" dataKey={xKey} tick={{ fontSize: 11 }} />,
    <YAxis key="y" tickFormatter={compact} tick={{ fontSize: 11 }} />,
    <Tooltip key="tip" formatter={(value) => full(Number(value))} />,
    ...(bars.length > 1 ? [<Legend key="legend" iconType="circle" wrapperStyle={{ fontSize: 12 }} />] : []),
  ]
  return <div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%">
    {type === "line"
      ? <LineChart data={series}>{common}{bars.map((bar, index) => <Line key={bar.key} type="monotone" dataKey={bar.key} name={bar.label} stroke={chartColors[index % chartColors.length]} strokeWidth={2} />)}</LineChart>
      : type === "area"
        ? <AreaChart data={series}>{common}{bars.map((bar, index) => <Area key={bar.key} type="monotone" dataKey={bar.key} name={bar.label} stroke={chartColors[index % chartColors.length]} fill={chartColors[index % chartColors.length]} fillOpacity={0.2} />)}</AreaChart>
        : <BarChart data={series}>{common}{bars.map((bar, index) => <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={chartColors[index % chartColors.length]} radius={[4, 4, 0, 0]} />)}</BarChart>}
  </ResponsiveContainer></div>
}
