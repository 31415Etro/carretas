"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  FileBarChart,
  ListChecks,
  MapPin,
  Plus,
  Timer,
  Wrench,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import { AlertRow, DataTable, MetricCard, PageShell, SectionCard, StatusBadge, useGo } from "@/components/operations/shared"
import { useAuth } from "@/lib/auth-context"

type DashboardData = {
  metrics: {
    openOrders: number
    inProgressOrders: number
    finishedOrders: number
    delayedOrders: number
    activeWorks: number
    environments: number
    points: number
    pausedOrders: number
    averageExecutionMinutes: number
    measuredExecutionOrders: number
  }
  orderCharts: {
    status: Array<{ name: string; value: number }>
    types: Array<{ name: string; value: number }>
    typeStatus: Array<{ type: string; aberta: number; andamento: number; finalizada: number; cancelada: number; total: number }>
    monthly: Array<{ month: string; abertas: number; andamento: number; finalizadas: number; canceladas: number; total: number }>
    dailyOperations: Array<{
      day: number
      pmocAbertas: number
      pmocAndamento: number
      pmocFinalizadas: number
      pmocCanceladas: number
      servicosAbertas: number
      servicosAndamento: number
      servicosFinalizadas: number
      servicosCanceladas: number
    }>
    executionTime: Array<{
      orderId: string
      orderNumber: string
      orderType: string
      startedAt: string
      finishedAt: string
      durationMinutes: number
    }>
  }
  todayServices: Array<{
    id: string
    orderNumber: string
    scheduledStartTime: string
    clientName: string
    workName: string
    serviceTypeName: string
    providerName: string
    status: string
  }>
  fieldTeams: Array<{
    id: string
    providerName: string
    orderNumber: string
    clientName: string
    location: string
    status: string
    updatedAt: string
  }>
  alerts: string[]
  executionPeriod: { start: string; end: string }
  viewer: { role: string; clientScoped: boolean; clientId: string | null; clientName: string | null }
  availableClients: Array<{ id: string; name: string }>
}

const emptyDashboard: DashboardData = {
  metrics: {
    openOrders: 0,
    inProgressOrders: 0,
    finishedOrders: 0,
    delayedOrders: 0,
    activeWorks: 0,
    environments: 0,
    points: 0,
    pausedOrders: 0,
    averageExecutionMinutes: 0,
    measuredExecutionOrders: 0,
  },
  orderCharts: {
    status: [],
    types: [],
    typeStatus: [],
    monthly: [],
    dailyOperations: [],
    executionTime: [],
  },
  todayServices: [],
  fieldTeams: [],
  alerts: [],
  executionPeriod: { start: "", end: "" },
  viewer: { role: "", clientScoped: false, clientId: null, clientName: null },
  availableClients: [],
}

const dashboardMonths = [
  ["01", "Janeiro"], ["02", "Fevereiro"], ["03", "Marco"], ["04", "Abril"],
  ["05", "Maio"], ["06", "Junho"], ["07", "Julho"], ["08", "Agosto"],
  ["09", "Setembro"], ["10", "Outubro"], ["11", "Novembro"], ["12", "Dezembro"],
]

function formatDateTime(value: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("pt-BR")
}

function formatDate(value: string) {
  if (!value) return "-"
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatDuration(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(Number(totalMinutes) || 0))
  const days = Math.floor(safeMinutes / 1440)
  const hours = Math.floor((safeMinutes % 1440) / 60)
  const minutes = safeMinutes % 60
  if (days) return `${days}d ${hours}h ${minutes}min`
  if (hours) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

function ChartFrame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <SectionCard title={title} description={description}>
      <div className="h-[300px] w-full">{children}</div>
    </SectionCard>
  )
}

export function OperationsDashboardBackendPage() {
  const go = useGo()
  const { user } = useAuth()
  const clientView = user?.role === "client"
  const [data, setData] = useState<DashboardData>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const currentYear = String(new Date().getFullYear())
  const defaultExecutionStart = `${currentYear}-01-01`
  const defaultExecutionEnd = `${currentYear}-12-31`
  const [chartMonth, setChartMonth] = useState("todos")
  const [chartYear, setChartYear] = useState(currentYear)
  const [selectedClientId, setSelectedClientId] = useState("todos")
  const [executionStartDraft, setExecutionStartDraft] = useState(defaultExecutionStart)
  const [executionEndDraft, setExecutionEndDraft] = useState(defaultExecutionEnd)
  const [executionStart, setExecutionStart] = useState(defaultExecutionStart)
  const [executionEnd, setExecutionEnd] = useState(defaultExecutionEnd)
  const [selectedExecutionIds, setSelectedExecutionIds] = useState<string[]>([])
  const yearOptions = Array.from({ length: 7 }, (_, index) => String(Number(currentYear) + 1 - index))

  const loadDashboard = async (year = chartYear, month = chartMonth) => {
    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams({ year, month })
      params.set("executionStart", executionStart)
      params.set("executionEnd", executionEnd)
      if (!clientView && selectedClientId !== "todos") params.set("clientId", selectedClientId)
      const response = await fetch(`/api/operacional/dashboard?${params.toString()}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o dashboard.")
      setData(payload)
      setSelectedExecutionIds(payload.orderCharts?.executionTime?.map((order: { orderId: string }) => order.orderId) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o dashboard.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard(chartYear, chartMonth)
  }, [chartYear, chartMonth, selectedClientId, clientView, executionStart, executionEnd])

  const metrics = data.metrics
  const selectedExecutionOrders = useMemo(
    () => data.orderCharts.executionTime.filter((order) => selectedExecutionIds.includes(order.orderId)),
    [data.orderCharts.executionTime, selectedExecutionIds],
  )
  const selectedExecutionAverage = selectedExecutionOrders.length
    ? Math.round(selectedExecutionOrders.reduce((total, order) => total + order.durationMinutes, 0) / selectedExecutionOrders.length)
    : 0
  const selectedExecutionChart = selectedExecutionOrders.slice(0, 25).reverse()

  function applyExecutionPeriod() {
    if (!executionStartDraft || !executionEndDraft || executionStartDraft > executionEndDraft) {
      setError("Informe um período válido para analisar o tempo das OS.")
      return
    }
    setError("")
    setExecutionStart(executionStartDraft)
    setExecutionEnd(executionEndDraft)
  }

  function toggleExecutionOrder(orderId: string, checked: boolean) {
    setSelectedExecutionIds((current) => checked
      ? Array.from(new Set([...current, orderId]))
      : current.filter((id) => id !== orderId))
  }

  return (
    <PageShell
      title={clientView ? "Dashboard do Cliente" : "Dashboard Operacional"}
      description={clientView ? `Acompanhe as ordens PMOC e os serviços diversos${data.viewer.clientName ? ` de ${data.viewer.clientName}` : ""}.` : "Acompanhe clientes, ordens de serviço, estoque, frota e financeiro em tempo real."}
      actions={
        <>
          {!clientView ? <>
          <Button onClick={() => go("/ordens-servico")}>
            <Plus className="h-4 w-4" />
            Nova OS
          </Button>
          <Button variant="secondary" onClick={() => go("/clientes-obras")}>Novo Cliente</Button>
          <Button variant="secondary" onClick={() => go("/orcamento")}>Novo Orçamento</Button>
          </> : null}
        </>
      }
    >
      {error ? (
        <AlertRow>
          <div className="space-y-2">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => loadDashboard()}>Tentar novamente</Button>
          </div>
        </AlertRow>
      ) : null}

      <div className="flex flex-col gap-3 rounded-md border bg-background p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Periodo dos indicadores e graficos</p>
          <p className="text-xs text-muted-foreground">Filtra os cards e graficos por mes e ano.</p>
        </div>
        <div className={`grid gap-2 ${clientView ? "grid-cols-2 sm:w-[360px]" : "grid-cols-1 sm:w-[600px] sm:grid-cols-3"}`}>
          {!clientView ? <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent sortItems>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              {data.availableClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
            </SelectContent>
          </Select> : null}
          <Select value={chartMonth} onValueChange={setChartMonth}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Mes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {dashboardMonths.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={chartYear} onValueChange={setChartYear}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Ano" /></SelectTrigger>
            <SelectContent>{yearOptions.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="OS em aberto" value={loading ? "..." : metrics.openOrders} note="Criadas ou agendadas" icon={FileBarChart} onClick={clientView ? undefined : () => go("/ordens-servico?status=abertas")} />
        <MetricCard title="OS em andamento" value={loading ? "..." : metrics.inProgressOrders} note="Equipe executando" icon={Wrench} onClick={clientView ? undefined : () => go("/ordens-servico?status=andamento")} />
        <MetricCard title="OS finalizadas no periodo" value={loading ? "..." : metrics.finishedOrders} note="Concluidas no periodo selecionado" icon={CheckCircle2} onClick={clientView ? undefined : () => go("/ordens-servico?status=finalizada")} />
        <MetricCard title="OS atrasadas" value={loading ? "..." : metrics.delayedOrders} note="Prazo vencido" icon={AlertTriangle} onClick={clientView ? undefined : () => go("/ordens-servico?tab=atrasadas")} />
        <MetricCard title="Obras/Locais ativos" value={loading ? "..." : metrics.activeWorks} note="Cadastrados no periodo" icon={Building2} onClick={clientView ? undefined : () => go("/orcamento")} />
        <MetricCard title="Ambientes cadastrados" value={loading ? "..." : metrics.environments} note="Cadastrados no periodo" icon={MapPin} onClick={clientView ? undefined : () => go("/orcamento")} />
        <MetricCard title="Pontos cadastrados" value={loading ? "..." : metrics.points} note="Cadastrados no periodo" icon={ListChecks} onClick={clientView ? undefined : () => go("/orcamento")} />
        <MetricCard title="Serviços pausados" value={loading ? "..." : metrics.pausedOrders} note="Precisam de ação" icon={Clock3} onClick={clientView ? undefined : () => go("/ordens-servico?status=Pausada")} />
        <MetricCard
          title="Tempo médio de execução"
          value={loading ? "..." : formatDuration(selectedExecutionAverage)}
          note={`${selectedExecutionOrders.length} de ${data.orderCharts.executionTime.length} OS selecionadas`}
          icon={Timer}
        />
      </div>

      <SectionCard
        title="Tempo de execução por OS"
        description="Escolha o período e marque as OS que devem entrar no cálculo da média."
      >
        <div className="mb-4 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-[180px_180px_auto] sm:items-end">
            <label className="space-y-1 text-sm font-medium">
              <span>De</span>
              <Input type="date" value={executionStartDraft} onChange={(event) => setExecutionStartDraft(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>Até</span>
              <Input type="date" value={executionEndDraft} onChange={(event) => setExecutionEndDraft(event.target.value)} />
            </label>
            <Button onClick={applyExecutionPeriod}>Aplicar período</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data.orderCharts.executionTime.length}
              onClick={() => setSelectedExecutionIds(data.orderCharts.executionTime.map((order) => order.orderId))}
            >
              Selecionar todas
            </Button>
            <Button size="sm" variant="outline" disabled={!selectedExecutionIds.length} onClick={() => setSelectedExecutionIds([])}>
              Limpar seleção
            </Button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="border-r px-2 last:border-r-0">
            <p className="text-xs text-muted-foreground">Período analisado</p>
            <p className="font-semibold">{formatDate(executionStart)} até {formatDate(executionEnd)}</p>
          </div>
          <div className="border-r px-2 last:border-r-0">
            <p className="text-xs text-muted-foreground">OS selecionadas</p>
            <p className="font-semibold">{selectedExecutionOrders.length} de {data.orderCharts.executionTime.length}</p>
          </div>
          <div className="px-2">
            <p className="text-xs text-muted-foreground">Média selecionada</p>
            <p className="font-semibold">{formatDuration(selectedExecutionAverage)}</p>
          </div>
        </div>

        <div className="max-h-[440px] overflow-auto border-y [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background">
          <DataTable headers={["Selecionar", "OS", "Tipo", "Início", "Conclusão", "Tempo"]} empty={!loading && !data.orderCharts.executionTime.length}>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : data.orderCharts.executionTime.map((order) => (
              <TableRow key={order.orderId}>
                <TableCell>
                  <Checkbox
                    checked={selectedExecutionIds.includes(order.orderId)}
                    onCheckedChange={(checked) => toggleExecutionOrder(order.orderId, checked === true)}
                    aria-label={`Selecionar ${order.orderNumber}`}
                  />
                </TableCell>
                <TableCell>{order.orderNumber}</TableCell>
                <TableCell>{order.orderType}</TableCell>
                <TableCell>{formatDateTime(order.startedAt)}</TableCell>
                <TableCell>{formatDateTime(order.finishedAt)}</TableCell>
                <TableCell>{formatDuration(order.durationMinutes)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </div>

        {selectedExecutionChart.length ? (
          <div className="mt-5 border-t pt-4">
            <p className="mb-3 text-sm font-semibold">Comparativo das OS selecionadas</p>
            <div className="w-full" style={{ height: Math.max(300, selectedExecutionChart.length * 38) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedExecutionChart} layout="vertical" margin={{ left: 12, right: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" dataKey="durationMinutes" tickFormatter={(value) => formatDuration(Number(value))} />
                  <YAxis type="category" dataKey="orderNumber" width={110} />
                  <Tooltip formatter={(value) => [formatDuration(Number(value)), "Tempo de execução"]} />
                  <Bar dataKey="durationMinutes" name="Tempo de execução" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {selectedExecutionOrders.length > 25 ? (
              <p className="mt-2 text-xs text-muted-foreground">O gráfico exibe as 25 OS selecionadas mais recentes; a média considera todas as {selectedExecutionOrders.length} selecionadas.</p>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <ChartFrame
        title="OS PMOC e Servicos Diversos por dia do mes"
        description={`Execucao das OS PMOC e Servicos Diversos por dia (${chartMonth === "todos" ? `todos os meses de ${chartYear}` : `${dashboardMonths.find(([value]) => value === chartMonth)?.[1]} de ${chartYear}`}).`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.orderCharts.dailyOperations} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" interval={0} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} />
            <Tooltip labelFormatter={(day) => `Dia ${day}`} />
            <Legend />
            <Bar dataKey="pmocAbertas" name="PMOC - Abertas" stackId="pmoc" fill="#2563eb" />
            <Bar dataKey="pmocAndamento" name="PMOC - Em andamento" stackId="pmoc" fill="#f97316" />
            <Bar dataKey="pmocFinalizadas" name="PMOC - Finalizadas" stackId="pmoc" fill="#16a34a" />
            <Bar dataKey="pmocCanceladas" name="PMOC - Canceladas" stackId="pmoc" fill="#dc2626" />
            <Bar dataKey="servicosAbertas" name="Servicos - Abertas" stackId="servicos" fill="#60a5fa" />
            <Bar dataKey="servicosAndamento" name="Servicos - Em andamento" stackId="servicos" fill="#fb923c" />
            <Bar dataKey="servicosFinalizadas" name="Servicos - Finalizadas" stackId="servicos" fill="#4ade80" />
            <Bar dataKey="servicosCanceladas" name="Servicos - Canceladas" stackId="servicos" fill="#f87171" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame title="PMOC e Serviços Diversos por status" description={`Quantidade de OS no período selecionado (${chartMonth === "todos" ? "ano inteiro" : dashboardMonths.find(([value]) => value === chartMonth)?.[1]} de ${chartYear}).`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.orderCharts.typeStatus}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="type" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="aberta" name="Abertas" stackId="status" fill="#2563eb" />
              <Bar dataKey="andamento" name="Em andamento" stackId="status" fill="#f97316" />
              <Bar dataKey="finalizada" name="Finalizadas" stackId="status" fill="#16a34a" />
              <Bar dataKey="cancelada" name="Canceladas" stackId="status" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame title="OS por mes" description="Abertas, em andamento, finalizadas e canceladas no periodo selecionado.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.orderCharts.monthly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="abertas" name="Abertas" stackId="os" fill="#2563eb" />
              <Bar dataKey="andamento" name="Em andamento" stackId="os" fill="#f97316" />
              <Bar dataKey="finalizadas" name="Finalizadas" stackId="os" fill="#16a34a" />
              <Bar dataKey="canceladas" name="Canceladas" stackId="os" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Serviços de hoje" description="Agenda operacional do dia carregada direto do Supabase.">
          <DataTable headers={["Horário", "Cliente", "Obra", "Tipo", "Prestador", "Status", "Ações"]} empty={!loading && !data.todayServices.length}>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : data.todayServices.map((order) => (
              <TableRow key={order.id}>
                <TableCell>{order.scheduledStartTime}</TableCell>
                <TableCell>{order.clientName}</TableCell>
                <TableCell>{order.workName}</TableCell>
                <TableCell>{order.serviceTypeName}</TableCell>
                <TableCell>{order.providerName}</TableCell>
                <TableCell><StatusBadge status={order.status} /></TableCell>
                <TableCell>{clientView ? <span className="text-sm text-muted-foreground">Consulta</span> : <Button asChild size="sm" variant="outline"><Link href={`/ordens-servico/${order.id}`}>Ver OS</Link></Button>}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>

        {!clientView ? <SectionCard title="Equipes em campo" description="Última movimentação por prestador.">
          <DataTable headers={["Prestador", "OS atual", "Cliente", "Local", "Status", "Última atualização"]} empty={!loading && !data.fieldTeams.length}>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : data.fieldTeams.map((team) => (
              <TableRow key={team.id}>
                <TableCell>{team.providerName}</TableCell>
                <TableCell>{team.orderNumber}</TableCell>
                <TableCell>{team.clientName}</TableCell>
                <TableCell>{team.location}</TableCell>
                <TableCell><StatusBadge status={team.status} /></TableCell>
                <TableCell>{formatDateTime(team.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard> : null}
      </div>
    </PageShell>
  )
}
