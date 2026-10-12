"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Download, Play, RefreshCw, Save, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { ConfirmInline, DataTable, PageShell, SectionCard, SelectField, StatusBadge, TextField, useCrudFeedback } from "@/components/operations/shared"
import { canAccessReport, formatCell, frequencies, periodKinds, reportById, reportCatalog, reportFormats, reportModules, type ReportFormat, type ReportResult } from "@/lib/reports"

type Row = Record<string, any>
type Meta = { user: { id: string; name: string; isAdmin: boolean }; modules: string[]; users: Array<{ id: string; name: string; email: string; role: string; permissions: string[] }>; emailConfigured: boolean }
type RunResponse = { reportId: string; module: string; name: string; period: { start: string; end: string }; meta: { title: string; periodLabel: string; filtersText: string; companyName: string; generatedAt: string }; result: ReportResult }
type Builder = { module: string; reportId: string; periodKind: string; startDate: string; endDate: string; filters: Record<string, string>; columns: string[]; groupBy: string; sortKey: string; sortDir: "asc" | "desc"; showTotals: boolean; format: ReportFormat }
type SaveForm = { id: string; name: string; authorizedUserIds: string[]; frequency: string; weekday: string; day: string; active: boolean }

const PREVIEW_LIMIT = 500
const none = "nenhum"
const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const defaultsFor = (reportId: string): Pick<Builder, "filters" | "columns" | "groupBy" | "sortKey" | "sortDir"> => {
  const def = reportById(reportId)!
  return { filters: Object.fromEntries(def.filters.filter((filter) => filter.default).map((filter) => [filter.key, filter.default!])), columns: def.columns.filter((column) => !column.hidden).map((column) => column.key), groupBy: "", sortKey: def.sort.key, sortDir: def.sort.dir }
}

const newBuilder = (module: string): Builder => {
  const first = reportCatalog.find((item) => item.module === module) || reportCatalog[0]
  return { module: first.module, reportId: first.id, periodKind: "Mês atual", startDate: "", endDate: "", format: "PDF", showTotals: true, ...defaultsFor(first.id) }
}

function Opts({ label, value, onChange, items, placeholder = "Selecione" }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string }) {
  return <SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} />
}

export function ReportsPage() {
  const { toast } = useCrudFeedback()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState("")
  const [builder, setBuilder] = useState<Builder | null>(null)
  const [run, setRun] = useState<RunResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Row[]>([])
  const [runs, setRuns] = useState<Row[]>([])
  const [saveForm, setSaveForm] = useState<SaveForm | null>(null)
  const [tab, setTab] = useState("gerar")

  const load = useCallback(async () => {
    try {
      const [metaResult, savedResult, runsResult] = await Promise.all([api<Meta>("/api/relatorios/meta"), api<{ saved: Row[] }>("/api/relatorios/saved").catch(() => ({ saved: [] as Row[] })), api<{ runs: Row[] }>("/api/relatorios/runs").catch(() => ({ runs: [] as Row[] }))])
      setMeta(metaResult)
      setSaved(savedResult.saved)
      setRuns(runsResult.runs)
      setBuilder((current) => current || newBuilder(metaResult.modules[0] || "financeiro"))
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar os relatórios.")
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const def = builder ? reportById(builder.reportId) : undefined
  const modules = reportModules.filter((item) => meta?.modules.includes(item.value))
  const reportsOfModule = reportCatalog.filter((item) => item.module === builder?.module)
  const set = (patch: Partial<Builder>) => setBuilder((current) => (current ? { ...current, ...patch } : current))

  const payload = (extra: Row = {}) => builder && { reportId: builder.reportId, periodKind: builder.periodKind, startDate: builder.startDate, endDate: builder.endDate, filters: builder.filters, columns: builder.columns, groupBy: builder.groupBy, sortKey: builder.sortKey, sortDir: builder.sortDir, showTotals: builder.showTotals, ...extra }

  async function generate() {
    if (!builder) return
    setBusy(true)
    try {
      setRun(await api<RunResponse>("/api/relatorios/run", { method: "POST", body: JSON.stringify(payload()) }))
      await api<{ runs: Row[] }>("/api/relatorios/runs").then((result) => setRuns(result.runs)).catch(() => undefined)
    } catch (reason) {
      toast({ title: "Relatório não gerado", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  async function exportReport() {
    if (!builder) return
    setBusy(true)
    try {
      // gera de novo no servidor (dados e permissões atuais) e registra a exportação
      const fresh = await api<RunResponse>("/api/relatorios/run", { method: "POST", body: JSON.stringify(payload({ exportFormat: builder.format })) })
      setRun(fresh)
      const { buildReportFile, reportFileName } = await import("@/lib/report-export")
      const file = await buildReportFile(builder.format, fresh.result, fresh.meta)
      const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }))
      const link = document.createElement("a")
      link.href = url
      link.download = reportFileName(fresh.name, file.extension)
      link.click()
      URL.revokeObjectURL(url)
      toast({ title: "Relatório exportado", description: `${fresh.result.rowCount} registro(s) em ${builder.format}.` })
      await api<{ runs: Row[] }>("/api/relatorios/runs").then((result) => setRuns(result.runs)).catch(() => undefined)
    } catch (reason) {
      toast({ title: "Exportação não concluída", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  function openSaved(item: Row) {
    setBuilder({ module: item.module, reportId: item.reportId, periodKind: item.periodKind, startDate: item.startDate, endDate: item.endDate, filters: item.filters || {}, columns: item.columns?.length ? item.columns : defaultsFor(item.reportId).columns, groupBy: item.groupBy, sortKey: item.sortKey || reportById(item.reportId)!.sort.key, sortDir: (item.sortDir || reportById(item.reportId)!.sort.dir) as "asc" | "desc", showTotals: item.showTotals, format: item.format })
    setRun(null)
    setTab("gerar")
    setSaveForm({ id: item.id, name: item.name, authorizedUserIds: item.authorizedUserIds, frequency: item.frequency, weekday: item.weekday == null ? "1" : String(item.weekday), day: item.day == null ? "5" : String(item.day), active: item.active })
    toast({ title: `"${item.name}" carregado`, description: "Ajuste o que precisar e gere ou salve de novo." })
  }

  async function sendNow(item: Row) {
    setBusy(true)
    try {
      const result = await api<{ delivered: string[]; skipped: number }>(`/api/relatorios/saved/${item.id}`, { method: "POST" })
      toast({ title: "Relatório enviado", description: `${result.delivered.length} destinatário(s)${result.skipped ? ` · ${result.skipped} sem acesso ao módulo` : ""}.` })
      await load()
    } catch (reason) {
      toast({ title: "Envio não concluído", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: Row) {
    try {
      await api(`/api/relatorios/saved?id=${item.id}`, { method: "DELETE" })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível excluir", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function saveReport() {
    if (!builder || !saveForm) return
    setBusy(true)
    try {
      await api("/api/relatorios/saved", {
        method: "POST",
        body: JSON.stringify({ report: { id: saveForm.id || undefined, name: saveForm.name, module: builder.module, reportId: builder.reportId, periodKind: builder.periodKind, startDate: builder.startDate, endDate: builder.endDate, filters: builder.filters, columns: builder.columns, groupBy: builder.groupBy, sortKey: builder.sortKey, sortDir: builder.sortDir, showTotals: builder.showTotals, format: builder.format, authorizedUserIds: saveForm.authorizedUserIds, frequency: saveForm.frequency, weekday: Number(saveForm.weekday), day: Number(saveForm.day), active: saveForm.active } }),
      })
      toast({ title: "Relatório salvo" })
      setSaveForm(null)
      setSheetOpen(false)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const [sheetOpen, setSheetOpen] = useState(false)
  const eligibleUsers = useMemo(() => (meta?.users || []).filter((user) => builder && canAccessReport({ role: user.role, permissions: user.permissions }, builder.module)), [meta, builder])

  const shown = useMemo(() => {
    if (!run) return null
    let remaining = PREVIEW_LIMIT
    const groups = run.result.groups.map((group) => {
      const rows = group.rows.slice(0, Math.max(0, remaining))
      remaining -= rows.length
      return { ...group, rows }
    })
    return { groups, truncated: run.result.rowCount > PREVIEW_LIMIT }
  }, [run])

  const cell = (row: Row, column: ReportResult["columns"][number]) => formatCell(row[column.key], column.type)
  const align = (type: string) => (type === "text" || type === "date" ? "" : "text-right")

  return (
    <PageShell title="Relatórios" description="Relatórios gerenciais, financeiros, comerciais e operacionais. A exportação respeita as suas permissões e os filtros aplicados.">
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {builder && def && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="gerar">Gerar relatório</TabsTrigger><TabsTrigger value="salvos">Relatórios salvos{saved.length ? ` (${saved.length})` : ""}</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>

          <TabsContent value="gerar" className="space-y-4">
            <SectionCard title="Configuração" description={def.description}>
              <div className="grid gap-3 md:grid-cols-4">
                <Opts label="Módulo de origem *" value={builder.module} onChange={(value) => { const first = reportCatalog.find((item) => item.module === value); if (first) { setBuilder({ ...builder, module: value, reportId: first.id, ...defaultsFor(first.id) }); setRun(null) } }} items={modules.map((item) => ({ value: item.value, label: item.label }))} />
                <Opts label="Tipo de relatório *" value={builder.reportId} onChange={(value) => { if (value) { set({ reportId: value, ...defaultsFor(value) }); setRun(null) } }} items={reportsOfModule.map((item) => ({ value: item.id, label: item.name }))} />
                <Opts label="Período *" value={builder.periodKind} onChange={(value) => set({ periodKind: value || "Mês atual" })} items={periodKinds.map((value) => ({ value, label: value }))} />
                <Opts label="Formato *" value={builder.format} onChange={(value) => set({ format: (value || "PDF") as ReportFormat })} items={reportFormats.map((value) => ({ value, label: value }))} />
                {builder.periodKind === "Personalizado" && def.periodMode === "range" && <><TextField label="De" type="date" value={builder.startDate} onChange={(value) => set({ startDate: value })} /><TextField label="Até" type="date" value={builder.endDate} onChange={(value) => set({ endDate: value })} /></>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{def.periodMode === "snapshot" ? "Este relatório mostra a posição atual; o período não se aplica." : `Período aplicado sobre: ${def.periodHint.toLowerCase()}.`}</p>

              {def.filters.length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  {def.filters.map((filter) => filter.type === "select"
                    ? <Opts key={filter.key} label={filter.label} value={builder.filters[filter.key] || ""} onChange={(value) => set({ filters: { ...builder.filters, [filter.key]: value } })} items={(filter.options || []).map((value) => ({ value, label: value }))} placeholder="Todos" />
                    : <TextField key={filter.key} label={filter.label} type={filter.type === "number" ? "number" : "text"} value={builder.filters[filter.key] || ""} onChange={(value) => set({ filters: { ...builder.filters, [filter.key]: value } })} />)}
                </div>
              )}

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {def.groupBy.length > 0 && <Opts label="Agrupar por" value={builder.groupBy} onChange={(value) => set({ groupBy: value })} items={def.groupBy.map((key) => ({ value: key, label: def.columns.find((column) => column.key === key)?.label || key }))} placeholder="Sem agrupamento" />}
                <Opts label="Ordenar por" value={builder.sortKey} onChange={(value) => set({ sortKey: value || def.sort.key })} items={def.columns.map((column) => ({ value: column.key, label: column.label }))} />
                <Opts label="Sentido" value={builder.sortDir} onChange={(value) => set({ sortDir: (value || "asc") as "asc" | "desc" })} items={[{ value: "asc", label: "Crescente" }, { value: "desc", label: "Decrescente" }]} />
                <div className="flex items-end gap-2 pb-2"><Checkbox id="totals" checked={builder.showTotals} onCheckedChange={(value) => set({ showTotals: value === true })} /><Label htmlFor="totals">Indicadores e totalizadores</Label></div>
              </div>

              <div className="mt-4">
                <Label className="text-sm">Colunas</Label>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                  {def.columns.map((column) => (
                    <label key={column.key} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={builder.columns.includes(column.key)} onCheckedChange={(value) => set({ columns: value === true ? [...builder.columns, column.key] : builder.columns.filter((key) => key !== column.key) })} />
                      {column.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void generate()} disabled={busy || !builder.columns.length}><Play className="h-4 w-4" />Gerar</Button>
                <Button variant="outline" onClick={() => void exportReport()} disabled={busy || !builder.columns.length}><Download className="h-4 w-4" />Exportar ({builder.format})</Button>
                <Button variant="outline" onClick={() => { setSaveForm((current) => current || { id: "", name: def.name, authorizedUserIds: meta?.user.id ? [meta.user.id] : [], frequency: "Sob demanda", weekday: "1", day: "5", active: true }); setSheetOpen(true) }}><Save className="h-4 w-4" />{saveForm?.id ? "Atualizar relatório salvo" : "Salvar relatório"}</Button>
              </div>
            </SectionCard>

            {run && shown && (
              <SectionCard title={run.name} description={`${run.meta.periodLabel}${run.meta.filtersText ? ` · ${run.meta.filtersText}` : ""} · ${run.result.rowCount} registro(s)`}>
                {shown.truncated && <p className="mb-2 text-xs text-amber-600">Mostrando os primeiros {PREVIEW_LIMIT} registros; a exportação traz todos.</p>}
                <DataTable headers={run.result.columns.map((column) => column.label)} empty={!run.result.rowCount}>
                  {shown.groups.map((group) => (
                    <Fragment key={group.label || "all"}>
                      {run.result.grouped && <TableRow className="bg-muted/40"><TableCell colSpan={run.result.columns.length} className="font-medium">{group.label}</TableCell></TableRow>}
                      {group.rows.map((row, index) => <TableRow key={index}>{run.result.columns.map((column) => <TableCell key={column.key} className={align(column.type)}>{cell(row, column)}</TableCell>)}</TableRow>)}
                      {run.result.grouped && Object.keys(group.subtotals).length > 0 && <TableRow className="font-medium">{run.result.columns.map((column, index) => <TableCell key={column.key} className={align(column.type)}>{index === 0 ? `Subtotal ${group.label}` : column.key in group.subtotals ? formatCell(group.subtotals[column.key], column.type) : ""}</TableCell>)}</TableRow>}
                    </Fragment>
                  ))}
                  {Object.keys(run.result.totals).length > 0 && <TableRow className="border-t-2 font-semibold">{run.result.columns.map((column, index) => <TableCell key={column.key} className={align(column.type)}>{index === 0 ? "TOTAL" : column.key in run.result.totals ? formatCell(run.result.totals[column.key], column.type) : ""}</TableCell>)}</TableRow>}
                </DataTable>
              </SectionCard>
            )}
          </TabsContent>

          <TabsContent value="salvos">
            <SectionCard title="Relatórios salvos" description="Você vê os que criou e os em que foi autorizado. Os agendados são enviados por e-mail aos usuários autorizados.">
              <DataTable headers={["Nome", "Relatório", "Período", "Formato", "Frequência", "Próximo envio", "Autorizados", "Último envio", "Ações"]} empty={!saved.length}>
                {saved.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}{!item.active && <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}</TableCell>
                    <TableCell>{reportById(item.reportId)?.name}<div className="text-xs text-muted-foreground">{reportModules.find((module) => module.value === item.module)?.label}</div></TableCell>
                    <TableCell>{item.periodKind}</TableCell><TableCell>{item.format}</TableCell>
                    <TableCell>{item.frequency}{item.frequency === "Semanal" && item.weekday != null ? ` · ${weekdays[item.weekday]}` : ""}{item.frequency === "Mensal" && item.day ? ` · dia ${item.day}` : ""}</TableCell>
                    <TableCell>{day(item.nextRunDate)}</TableCell><TableCell className="max-w-[12rem] truncate" title={item.authorizedNames.join(", ")}>{item.authorizedNames.join(", ")}</TableCell><TableCell>{stamp(item.lastRunAt)}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openSaved(item)}>Abrir</Button>
                      <Button size="sm" variant="outline" onClick={() => void sendNow(item)} disabled={busy || !meta?.emailConfigured} title={meta?.emailConfigured ? "" : "E-mail não configurado no servidor"}><Send className="h-3.5 w-3.5" />Enviar agora</Button>
                      {(meta?.user.isAdmin || item.createdById === meta?.user.id) && <ConfirmInline label="Excluir" onConfirm={() => void remove(item)} />}
                    </div></TableCell>
                  </TableRow>
                ))}
              </DataTable>
              {!meta?.emailConfigured && <p className="mt-2 text-xs text-amber-600">Envio por e-mail desativado: defina RESEND_API_KEY no servidor para enviar e agendar relatórios.</p>}
            </SectionCard>
          </TabsContent>

          <TabsContent value="historico">
            <SectionCard title="Histórico de gerações e exportações" description={meta?.user.isAdmin ? "Todos os usuários." : "Suas gerações."}>
              <Button className="mb-3" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Atualizar</Button>
              <DataTable headers={["Data", "Relatório", "Origem", "Formato", "Período", "Registros", "Usuário", "Enviado para", "Situação"]} empty={!runs.length}>
                {runs.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{stamp(item.at)}</TableCell><TableCell>{item.reportName}</TableCell><TableCell>{item.origin}</TableCell><TableCell>{item.format || "-"}</TableCell>
                    <TableCell>{item.periodStart ? `${day(item.periodStart)} a ${day(item.periodEnd)}` : "-"}</TableCell><TableCell>{item.rowCount}</TableCell><TableCell>{item.userName}</TableCell>
                    <TableCell className="max-w-[14rem] truncate" title={item.deliveredTo.join(", ")}>{item.deliveredTo.join(", ") || "-"}</TableCell>
                    <TableCell><StatusBadge status={item.status === "OK" ? "Concluído" : "Falha"} />{item.error && <div className="text-xs text-destructive">{item.error}</div>}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{saveForm?.id ? "Atualizar relatório salvo" : "Salvar relatório"}</SheetTitle><SheetDescription>Guarda a configuração atual (filtros, colunas, agrupamento, formato) e define quem pode usá-lo e quando é enviado.</SheetDescription></SheetHeader>
          {saveForm && builder && (
            <div className="space-y-4 px-4 pb-6">
              <TextField label="Nome do relatório *" value={saveForm.name} onChange={(value) => setSaveForm({ ...saveForm, name: value })} />
              <div className="space-y-2">
                <Label>Usuários autorizados *</Label>
                <p className="text-xs text-muted-foreground">Só aparecem usuários com a permissão de Relatórios e a do módulo de origem.</p>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                  {eligibleUsers.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={saveForm.authorizedUserIds.includes(user.id)} onCheckedChange={(value) => setSaveForm({ ...saveForm, authorizedUserIds: value === true ? [...saveForm.authorizedUserIds, user.id] : saveForm.authorizedUserIds.filter((id) => id !== user.id) })} />
                      {user.name} <span className="text-xs text-muted-foreground">{user.email}</span>
                    </label>
                  ))}
                  {!eligibleUsers.length && <p className="text-sm text-muted-foreground">Nenhum usuário com acesso a este módulo.</p>}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Opts label="Frequência de geração" value={saveForm.frequency} onChange={(value) => setSaveForm({ ...saveForm, frequency: value || "Sob demanda" })} items={frequencies.map((value) => ({ value, label: value }))} />
                {saveForm.frequency === "Semanal" && <Opts label="Dia da semana" value={saveForm.weekday} onChange={(value) => setSaveForm({ ...saveForm, weekday: value || "1" })} items={weekdays.map((label, index) => ({ value: String(index), label }))} />}
                {saveForm.frequency === "Mensal" && <TextField label="Dia do mês" type="number" value={saveForm.day} onChange={(value) => setSaveForm({ ...saveForm, day: value })} />}
              </div>
              {saveForm.frequency !== "Sob demanda" && <p className="text-xs text-muted-foreground">O envio ocorre uma vez ao dia, de manhã, quando a data agendada chega. Use um período relativo (ex.: "Mês anterior"). {meta?.emailConfigured ? "" : "O envio por e-mail ainda não está configurado no servidor."}</p>}
              <div className="flex items-center gap-2"><Checkbox id="active" checked={saveForm.active} onCheckedChange={(value) => setSaveForm({ ...saveForm, active: value === true })} /><Label htmlFor="active">Agendamento ativo</Label></div>
              <Button onClick={() => void saveReport()} disabled={busy}><Save className="h-4 w-4" />Salvar</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  )
}
