"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Plus } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DataTable, MetricCard, SectionCard, SelectField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { TableCell, TableRow } from "@/components/ui/table"
import { buildReportFile } from "@/lib/report-export"
import type { ColumnDef, ReportResult } from "@/lib/reports"
import { MachineDetail } from "@/components/machines/machine-detail"
import { MachinesShell } from "@/components/machines/machines-pages"
import { brl, day, mApi, useMachines, type Overview, type Row } from "@/components/machines/machine-data"
import { PageLayout } from "@/components/page-layout"
import { costInPeriod, depreciation, effectiveDate, failureCount, illustrationLibrary, isHighMaintenanceCost, orderCost, orderLabel, statusMeta, sumMoney, unavailableHours, type MachineStatus } from "@/lib/machines"

const all = "todos"
const none = "nenhum"
const noAccess = (message: string) => <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{message}</p>

// ===================== Custos e depreciação =====================
export function CostsPage() {
  return <MachinesShell title="Custos e depreciação" description="Custo de aquisição, depreciação contábil, valor contábil líquido e custo de manutenção por máquina. Valor contábil não é valor de mercado.">{({ data }) => (data.caps.patrimony ? <CostsBody data={data} /> : noAccess("Você não tem permissão para ver os dados patrimoniais e financeiros das máquinas."))}</MachinesShell>
}

function CostsBody({ data }: { data: Overview }) {
  const [start, setStart] = useState(`${data.today.slice(0, 4)}-01-01`)
  const [end, setEnd] = useState(data.today)
  const rows = data.machines.filter((machine) => machine.adminStatus !== "Baixado").map((machine) => {
    const orders = data.orders.filter((order) => order.machineId === machine.id)
    const dep = depreciation({ acquisitionValue: machine.acquisitionValue, freightCost: machine.freightCost, installationCost: machine.installationCost, otherCosts: machine.otherCosts, residualValue: machine.residualValue, usefulLifeMonths: Number(machine.usefulLifeMonths) || 0, startDate: machine.depreciationStartDate || machine.acquisitionDate, method: machine.depreciationMethod, adjustments: machine.depreciationAdjustments, asOf: data.today })
    const period = costInPeriod(orders, start, end)
    return { machine, dep, period, high: isHighMaintenanceCost(machine.totalMaintenanceCost || 0, dep.baseValue, data.settings.highCostPercent) }
  })
  const totals = {
    acquired: sumMoney(...rows.map((row) => row.dep.baseValue)), accumulated: sumMoney(...rows.map((row) => row.dep.accumulated)), book: sumMoney(...rows.map((row) => row.dep.bookValue)),
    maintenance: sumMoney(...rows.map((row) => row.machine.totalMaintenanceCost || 0)), period: sumMoney(...rows.map((row) => row.period)),
  }
  const top = [...rows].sort((a, b) => b.period - a.period).slice(0, 10).filter((row) => row.period > 0).map((row) => ({ name: row.machine.code, custo: row.period }))
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Patrimônio adquirido" value={brl(totals.acquired)} note="custo total de aquisição" icon={Plus} />
        <MetricCard title="Depreciação acumulada" value={brl(totals.accumulated)} note="contábil, linear" icon={Plus} />
        <MetricCard title="Valor contábil líquido" value={brl(totals.book)} note="não é valor de mercado" icon={Plus} />
        <MetricCard title="Manutenção acumulada" value={brl(totals.maintenance)} note="desde sempre (ordens concluídas)" icon={Plus} />
        <MetricCard title="Manutenção no período" value={brl(totals.period)} note={`${day(start)} a ${day(end)}`} icon={Plus} />
      </div>
      <div className="flex flex-wrap items-end gap-3"><div className="w-40"><TextField label="Período: de" type="date" value={start} onChange={setStart} /></div><div className="w-40"><TextField label="até" type="date" value={end} onChange={setEnd} /></div></div>
      {top.length ? <SectionCard title="Maiores custos de manutenção no período"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={top}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} /><Tooltip formatter={(value) => brl(Number(value))} /><Bar dataKey="custo" name="Manutenção" fill="#1e3a8a" /></BarChart></ResponsiveContainer></div></SectionCard> : null}
      <SectionCard title="Por máquina" description={`Alerta quando a manutenção acumulada passa de ${data.settings.highCostPercent}% do custo de aquisição (ajustável em Configurações).`}>
        <DataTable headers={["Máquina", "Aquisição", "Depreciação acum.", "Valor contábil", "Manutenção (total)", "% da aquisição", "No período", "Reposição est."]} empty={!rows.length}>
          {rows.map(({ machine, dep, period, high }) => (
            <TableRow key={machine.id}>
              <TableCell><Link className="font-medium text-primary hover:underline" href={`/maquinas/${machine.id}`} prefetch={false}>{machine.name}</Link><p className="font-mono text-xs text-muted-foreground">{machine.code}</p></TableCell>
              <TableCell className="tabular-nums">{brl(dep.baseValue)}</TableCell><TableCell className="tabular-nums">{dep.applicable ? brl(dep.accumulated) : "—"}</TableCell><TableCell className="tabular-nums">{brl(dep.bookValue)}</TableCell>
              <TableCell className="tabular-nums">{brl(machine.totalMaintenanceCost)}</TableCell>
              <TableCell className={high ? "font-semibold text-red-600" : ""}>{dep.baseValue > 0 ? `${((Number(machine.totalMaintenanceCost || 0) / dep.baseValue) * 100).toFixed(1)}%` : "—"}{high ? " ⚠ custo alto" : ""}</TableCell>
              <TableCell className="tabular-nums">{brl(period)}</TableCell><TableCell className="tabular-nums">{machine.replacementValue != null ? brl(machine.replacementValue) : "—"}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </>
  )
}

// ===================== Relatórios =====================
type History = Array<{ machineId: string; toStatus: string; startedAt: string; endedAt: string; reasonCode: string; reason: string }>
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`

export function ReportsPage() {
  return <MachinesShell title="Relatórios" description="Indicadores por período, setor, categoria, máquina, responsável e status, com exportação em PDF e Excel.">{({ data }) => <ReportsBody data={data} />}</MachinesShell>
}

function ReportsBody({ data }: { data: Overview }) {
  const { toast } = useCrudFeedback()
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(data.today)
  const [sector, setSector] = useState(all)
  const [category, setCategory] = useState(all)
  const [machineId, setMachineId] = useState(all)
  const [responsible, setResponsible] = useState(all)
  const [status, setStatus] = useState(all)
  const [kind, setKind] = useState("resumo")
  const [history, setHistory] = useState<History>([])
  const [loading, setLoading] = useState(false)
  const showCost = data.caps.maintain || data.caps.patrimony

  useEffect(() => {
    if (!start || !end || start > end) return
    setLoading(true)
    mApi<{ items: History }>("status-history", { query: { start, end } }).then((result) => setHistory(result.items)).catch(() => setHistory([])).finally(() => setLoading(false))
  }, [start, end])

  const machines = data.machines.filter((machine) => (sector === all || (machine.sectorId || "sem") === sector) && (category === all || (machine.categoryId || "sem") === category) && (machineId === all || machine.id === machineId)
    && (responsible === all || machine.responsibleName === responsible) && (status === all || machine.operationalStatus === status))
  const ids = new Set(machines.map((machine) => machine.id))
  const startIso = `${start}T00:00:00-03:00`
  const endIso = `${end}T23:59:59-03:00`
  const name = (id: string) => data.machines.find((machine) => machine.id === id)
  const responsibles = [...new Set(data.machines.map((machine) => String(machine.responsibleName || "")).filter(Boolean))].sort()

  const summary = machines.map((machine) => {
    const orders = data.orders.filter((order) => order.machineId === machine.id)
    const hist = history.filter((row) => row.machineId === machine.id)
    return {
      code: machine.code, name: machine.name, status: statusMeta[machine.operationalStatus as MachineStatus].label, unavailable: unavailableHours(hist, startIso, endIso), failures: failureCount(orders, start, end),
      stops: hist.filter((row) => row.toStatus === "Parada" && row.startedAt >= startIso).length, orders: orders.filter((order) => order.status === "Concluida" && order.origin !== "Ocorrencia" && effectiveDate(order) >= start && effectiveDate(order) <= end).length,
      cost: costInPeriod(orders, start, end),
    }
  })
  const changes = history.filter((row) => ids.has(row.machineId) && row.startedAt >= startIso && row.startedAt <= endIso).map((row) => ({ date: row.startedAt.slice(0, 10), machine: `${name(row.machineId)?.code} · ${name(row.machineId)?.name}`, status: statusMeta[row.toStatus as MachineStatus]?.label || row.toStatus, reason: row.reason, endedAt: row.endedAt ? row.endedAt.slice(0, 10) : "" }))
  const done = data.orders.filter((order) => ids.has(order.machineId) && order.status === "Concluida" && order.origin !== "Ocorrencia" && effectiveDate(order) >= start && effectiveDate(order) <= end).sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)))
    .map((order) => ({ date: effectiveDate(order), machine: `${name(order.machineId)?.code} · ${name(order.machineId)?.name}`, type: orderLabel(order.maintenanceType), description: order.description, technician: order.technician || order.externalCompany || order.responsible || "", cost: orderCost(order), downtime: Number(order.downtimeHours || 0) }))

  const col = (key: string, label: string, type: ColumnDef["type"], total?: ColumnDef["total"]): ColumnDef => ({ key, label, type, ...(total ? { total } : {}) })
  const result = useMemo<ReportResult>(() => {
    const build = (columns: ColumnDef[], rows: Row[]): ReportResult => {
      const totals: Record<string, number> = {}
      columns.filter((column) => column.total).forEach((column) => { totals[column.key] = rows.reduce((sum, row) => sum + Number(row[column.key] || 0), 0) })
      return { columns, groups: [{ label: "", rows, subtotals: {} }], totals, rowCount: rows.length, grouped: false }
    }
    if (kind === "status") return build([col("date", "Data", "date"), col("machine", "Máquina", "text"), col("status", "Novo status", "text"), col("reason", "Motivo", "text"), col("endedAt", "Até", "date")], changes)
    if (kind === "manutencoes") return build([col("date", "Executada em", "date"), col("machine", "Máquina", "text"), col("type", "Tipo", "text"), col("description", "Serviço", "text"), col("technician", "Responsável", "text"), ...(showCost ? [col("cost", "Custo", "money", "sum")] : []), col("downtime", "Parada (h)", "number", "sum")], done)
    return build([col("code", "Código", "text"), col("name", "Máquina", "text"), col("status", "Status atual", "text"), col("unavailable", "Indisponibilidade (h)", "number", "sum"), col("stops", "Paradas", "int", "sum"), col("failures", "Falhas (corretivas)", "int", "sum"), col("orders", "Manutenções", "int", "sum"), ...(showCost ? [col("cost", "Custo manutenção", "money", "sum")] : [])], summary)
  }, [kind, summary, changes, done, showCost]) // eslint-disable-line react-hooks/exhaustive-deps

  const titles: Record<string, string> = { resumo: "Resumo de máquinas: disponibilidade, falhas e custos", status: "Histórico de alterações operacionais", manutencoes: "Manutenções realizadas" }
  const exportAs = async (format: "PDF" | "Excel") => {
    try {
      const file = await buildReportFile(format, result, { title: titles[kind], periodLabel: `${day(start)} a ${day(end)}`, filtersText: "", companyName: "ND Carretas", generatedAt: new Date().toLocaleString("pt-BR") })
      const blob = new Blob([file.bytes as BlobPart], { type: file.mime })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob); link.download = `maquinas-${kind}-${start}_${end}.${file.extension}`; link.click(); URL.revokeObjectURL(link.href)
    } catch (caught) { toast({ title: "Erro ao exportar", description: caught instanceof Error ? caught.message : "", variant: "destructive" }) }
  }
  const totalUnavailable = summary.reduce((sum, row) => sum + row.unavailable, 0)

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56"><SelectField label="Relatório" value={kind} onChange={setKind} options={[{ value: "resumo", label: "Resumo por máquina" }, { value: "status", label: "Alterações de status" }, { value: "manutencoes", label: "Manutenções realizadas" }]} /></div>
        <div className="w-40"><TextField label="De" type="date" value={start} onChange={setStart} /></div><div className="w-40"><TextField label="Até" type="date" value={end} onChange={setEnd} /></div>
        <div className="w-40"><SelectField label="Setor" value={sector} onChange={setSector} options={[{ value: all, label: "Todos" }, ...data.sectors.map((item) => ({ value: item.id, label: item.name })), { value: "sem", label: "Sem setor" }]} /></div>
        <div className="w-40"><SelectField label="Categoria" value={category} onChange={setCategory} options={[{ value: all, label: "Todas" }, ...data.categories.map((item) => ({ value: item.id, label: item.name })), { value: "sem", label: "Sem categoria" }]} /></div>
        <div className="w-52"><SelectField label="Máquina" value={machineId} onChange={setMachineId} options={[{ value: all, label: "Todas" }, ...data.machines.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))]} /></div>
        <div className="w-40"><SelectField label="Responsável" value={responsible} onChange={setResponsible} options={[{ value: all, label: "Todos" }, ...responsibles.map((value) => ({ value, label: value }))]} /></div>
        <div className="w-40"><SelectField label="Status atual" value={status} onChange={setStatus} options={[{ value: all, label: "Todos" }, { value: "Em operacao", label: "Em operação" }, { value: "Em manutencao", label: "Em manutenção" }, { value: "Parada", label: "Parada" }, { value: "Nao informado", label: "Sem status" }]} /></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => exportAs("PDF")}><Download className="h-4 w-4" />PDF</Button><Button variant="outline" onClick={() => exportAs("Excel")}><Download className="h-4 w-4" />Excel</Button></div>
      </div>
      {start > end ? <p role="alert" className="text-sm text-red-700">A data inicial deve ser anterior à final.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Máquinas no filtro" value={machines.length} note="no relatório" icon={Plus} />
        <MetricCard title="Indisponibilidade" value={`${totalUnavailable.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`} note="paradas + manutenção" icon={Plus} />
        <MetricCard title="Falhas (corretivas)" value={summary.reduce((sum, row) => sum + row.failures, 0)} note="no período" icon={Plus} />
        {showCost ? <MetricCard title="Custo de manutenção" value={brl(summary.reduce((sum, row) => sum + row.cost, 0))} note="ordens concluídas no período" icon={Plus} /> : <MetricCard title="Manutenções" value={summary.reduce((sum, row) => sum + row.orders, 0)} note="concluídas no período" icon={Plus} />}
      </div>
      <SectionCard title={titles[kind]} description="Indisponibilidade = tempo em “Parada” ou “Em manutenção” segundo o histórico de status informado pelos manutentores.">
        {loading ? <div className="flex items-center gap-2 p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculando…</div> : (
          <DataTable headers={result.columns.map((column) => column.label)} empty={!result.rowCount}>
            {result.groups[0].rows.map((row, index) => <TableRow key={index}>{result.columns.map((column) => <TableCell key={column.key} className={column.type === "money" || column.type === "number" || column.type === "int" ? "tabular-nums" : ""}>{column.type === "money" ? brl(row[column.key]) : column.type === "date" ? day(row[column.key]) : column.type === "number" ? Number(row[column.key]).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : String(row[column.key] ?? "")}</TableCell>)}</TableRow>)}
          </DataTable>
        )}
      </SectionCard>
    </>
  )
}

// ===================== Configurações =====================
export function SettingsPage() {
  return <MachinesShell title="Configurações de máquinas" description="Setores, categorias, alertas e QR Code.">{({ data, reload }) => (data.caps.maintain ? <SettingsBody data={data} reload={reload} /> : noAccess("Somente o manutentor ou o administrador altera as configurações."))}</MachinesShell>
}

function SettingsBody({ data, reload }: { data: Overview; reload: () => void }) {
  const { toast } = useCrudFeedback()
  const [settings, setSettings] = useState({ ...data.settings })
  const [sectorName, setSectorName] = useState("")
  const [categoryName, setCategoryName] = useState("")
  const [categoryArt, setCategoryArt] = useState("generica")
  const [categoryKind, setCategoryKind] = useState("MAQ")
  const fail = (title: string) => (caught: unknown) => toast({ title, description: caught instanceof Error ? caught.message : "", variant: "destructive" })
  const saveSettings = () => mApi("settings", { body: { item: settings } }).then(() => { toast({ title: "Configurações salvas" }); reload() }).catch(fail("Não foi possível salvar"))
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard title="Alertas, QR Code e códigos">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Prefixo do código patrimonial" value={settings.codePrefix} onChange={(value) => setSettings({ ...settings, codePrefix: value.toUpperCase() })} />
          <TextField label="URL base do QR Code (https://…)" value={settings.qrBaseUrl} onChange={(value) => setSettings({ ...settings, qrBaseUrl: value })} placeholder="https://erp.suaempresa.com.br" />
          <TextField label="Avisar vencimento com (dias)" type="number" value={settings.dueSoonDays} onChange={(value) => setSettings({ ...settings, dueSoonDays: Number(value) })} />
          <TextField label="Alerta de custo alto (% da aquisição)" type="number" value={settings.highCostPercent} onChange={(value) => setSettings({ ...settings, highCostPercent: Number(value) })} />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm"><Checkbox checked={settings.autoCreateOrders} onCheckedChange={(value) => setSettings({ ...settings, autoCreateOrders: value === true })} />Permitir abertura automática de ordens pelos planos marcados como automáticos</label>
        <p className="mt-2 text-xs text-muted-foreground">O QR Code usa a URL base. Trocar a URL não invalida etiquetas já impressas (elas guardam só um identificador opaco); o prefixo vale apenas para códigos novos.</p>
        <Button className="mt-4" onClick={saveSettings}>Salvar configurações</Button>
      </SectionCard>

      <SectionCard title="Setores" description="Usados no mapa de máquinas. A planta da fábrica poderá usar estes setores no futuro.">
        <ul className="mb-3 divide-y rounded-lg border text-sm">{data.sectors.map((sector) => <li key={sector.id} className="flex items-center gap-2 p-2.5"><span className={sector.active ? "" : "text-muted-foreground line-through"}>{sector.name}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => mApi("sector", { body: { item: { id: sector.id, name: sector.name, sortOrder: sector.sortOrder, active: !sector.active } } }).then(reload).catch(fail("Erro"))}>{sector.active ? "Desativar" : "Reativar"}</Button></li>)}{!data.sectors.length ? <li className="p-3 text-muted-foreground">Nenhum setor. Ex.: Soldagem, Montagem, Corte, Pintura, Acabamento.</li> : null}</ul>
        <div className="flex items-end gap-2"><div className="flex-1"><TextField label="Novo setor" value={sectorName} onChange={setSectorName} /></div><Button onClick={() => mApi("sector", { body: { item: { name: sectorName, sortOrder: data.sectors.length } } }).then(() => { setSectorName(""); reload() }).catch(fail("Erro ao criar o setor"))}>Adicionar</Button></div>
      </SectionCard>

      <SectionCard title="Categorias" description="Definem a ilustração sugerida e o tipo de código (MAQ ou EQP).">
        <ul className="mb-3 divide-y rounded-lg border text-sm">{data.categories.map((category) => <li key={category.id} className="flex items-center gap-2 p-2.5"><span className={category.active ? "" : "text-muted-foreground line-through"}>{category.name}</span><span className="text-xs text-muted-foreground">{category.codeKind} · {illustrationLibrary.find((item) => item.key === category.illustrationKey)?.label}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => mApi("category", { body: { item: { ...category, active: !category.active } } }).then(reload).catch(fail("Erro"))}>{category.active ? "Desativar" : "Reativar"}</Button></li>)}{!data.categories.length ? <li className="p-3 text-muted-foreground">Nenhuma categoria.</li> : null}</ul>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Nova categoria" value={categoryName} onChange={setCategoryName} />
          <SelectField label="Ilustração" value={categoryArt} onChange={setCategoryArt} options={illustrationLibrary.map((item) => ({ value: item.key, label: item.label }))} />
          <SelectField label="Código" value={categoryKind} onChange={setCategoryKind} options={[{ value: "MAQ", label: "MAQ (máquina)" }, { value: "EQP", label: "EQP (equipamento)" }]} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => mApi("category", { body: { item: { name: categoryName, illustrationKey: categoryArt, codeKind: categoryKind } } }).then(() => { setCategoryName(""); reload() }).catch(fail("Erro ao criar a categoria"))}>Adicionar categoria</Button>
          <Button variant="outline" onClick={() => mApi<{ created: number }>("categories-seed", { body: {} }).then((result) => { toast({ title: `${result.created} categoria(s) criada(s)` }); reload() }).catch(fail("Erro"))}>Criar categorias padrão (a partir da biblioteca)</Button>
        </div>
      </SectionCard>

      <SectionCard title="Integrações">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><b className="text-foreground">Estoque:</b> as peças da ordem baixam o estoque uma única vez, ao concluir (movimentação “Consumo em OS”). Manutenção anterior nunca baixa sem autorização do administrador.</li>
          <li><b className="text-foreground">Financeiro e Compras:</b> a ordem guarda fornecedor e nota fiscal e tem campos para vincular conta a pagar e pedido de compra. A criação automática desses lançamentos ainda não está ligada (depende de regra de aprovação do financeiro).</li>
          <li><b className="text-foreground">Produção:</b> o ERP ainda não tem módulo de produção; a disponibilidade das máquinas já fica pronta para ele consumir.</li>
          <li><b className="text-foreground">Sensores / IoT:</b> não há. O status “Em operação” é informado por pessoa autorizada.</li>
        </ul>
      </SectionCard>
    </div>
  )
}

// ===================== QR Code (celular) =====================
export function QrLanding({ token }: { token: string }) {
  const [machineId, setMachineId] = useState("")
  const [error, setError] = useState("")
  useEffect(() => { mApi<{ machineId: string }>("resolve", { query: { token } }).then((result) => setMachineId(result.machineId)).catch((caught) => setError(caught instanceof Error ? caught.message : "QR Code inválido.")) }, [token])
  if (machineId) return <MachineDetail machineId={machineId} mobile />
  return <PageLayout><div className="mx-auto max-w-md p-6 text-center">{error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : <div className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Abrindo a máquina…</div>}</div></PageLayout>
}
