"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Building2, CheckCircle2, Clock3, ExternalLink, Grid3X3, RefreshCw } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertRow, PageShell } from "@/components/operations/shared"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type TileState = "idle" | "open" | "inProgress" | "finished"

type PanelData = {
  viewer: { role: string; clientScoped: boolean; clientId: string | null }
  selectedClient: { id: string; name: string } | null
  availableClients: Array<{ id: string; name: string }>
  availableOrders: Array<{ id: string; number: string; type: string; status: string; scheduledDate: string }>
  summary: Record<TileState, number> & { total: number }
  groups: Array<{
    name: string
    items: Array<{
      id: string
      name: string
      location: string
      floor: string
      state: TileState
      equipmentCount: number
      equipment: Array<{ id: string; label: string; capacity: string }>
      order: { id: string; number: string; type: string; status: string; scheduledDate: string } | null
      photoProgress: { completed: number; total: number }
    }>
  }>
  updatedAt: string
}

const emptyData: PanelData = {
  viewer: { role: "", clientScoped: false, clientId: null },
  selectedClient: null,
  availableClients: [],
  availableOrders: [],
  summary: { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0 },
  groups: [],
  updatedAt: "",
}

const stateMeta: Record<TileState, { label: string; className: string }> = {
  idle: { label: "Sem OS", className: "border-slate-200 bg-slate-100 text-slate-700" },
  open: { label: "Aberta", className: "border-blue-600 bg-blue-600 text-white" },
  inProgress: { label: "Em andamento", className: "border-orange-500 bg-orange-500 text-white" },
  finished: { label: "Finalizada", className: "border-emerald-600 bg-emerald-600 text-white" },
}

function formatDate(value = "") {
  if (!value) return ""
  const [year, month, day] = value.split("-")
  return year && month && day ? `${day}/${month}/${year}` : value
}

export function ClientEnvironmentPanel({ initialClientId = "" }: { initialClientId?: string }) {
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [statusFilter, setStatusFilter] = useState<TileState | "all">("all")
  const [orderFilter, setOrderFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [data, setData] = useState<PanelData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const selectedClientRef = useRef(selectedClientId)
  const orderFilterRef = useRef(orderFilter)
  const dateFromRef = useRef(dateFrom)
  const dateToRef = useRef(dateTo)
  const visibleOrderIdsRef = useRef(new Set<string>())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  selectedClientRef.current = selectedClientId
  orderFilterRef.current = orderFilter
  dateFromRef.current = dateFrom
  dateToRef.current = dateTo
  visibleOrderIdsRef.current = new Set(data.groups.flatMap((group) => group.items.map((item) => item.order?.id).filter(Boolean) as string[]))

  const filteredGroups = useMemo(() => data.groups
    .map((group) => ({
      ...group,
      items: statusFilter === "all" ? group.items : group.items.filter((item) => item.state === statusFilter),
    }))
    .filter((group) => group.items.length > 0), [data.groups, statusFilter])

  const chartData = useMemo(() => [
    { name: "Total", value: data.summary.total, color: "#475569" },
    { name: "Abertas", value: data.summary.open, color: "#2563eb" },
    { name: "Em andamento", value: data.summary.inProgress, color: "#f97316" },
    { name: "Concluidas", value: data.summary.finished, color: "#059669" },
  ], [data.summary])

  const loadPanel = useCallback(async (clientId = selectedClientRef.current, silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (clientId) params.set("clientId", clientId)
      if (orderFilterRef.current !== "all") params.set("orderId", orderFilterRef.current)
      if (dateFromRef.current) params.set("dateFrom", dateFromRef.current)
      if (dateToRef.current) params.set("dateTo", dateToRef.current)
      const response = await fetch(`/api/operacional/environment-panel?${params.toString()}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar o painel.")
      setData(payload)
      if (!clientId && payload.viewer?.clientId) setSelectedClientId(payload.viewer.clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel carregar o painel.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadPanel(selectedClientId)
  }, [selectedClientId, orderFilter, dateFrom, dateTo, loadPanel])

  useEffect(() => {
    const clientId = data.viewer.clientScoped ? data.viewer.clientId : selectedClientId
    if (!clientId) return

    const refreshSoon = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => loadPanel(clientId, true), 400)
    }
    const refreshVisibleFile = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const orderId = String(payload.new?.service_order_id || payload.old?.service_order_id || "")
      if (!orderId || visibleOrderIdsRef.current.has(orderId)) refreshSoon()
    }
    const supabase = createBrowserSupabaseClient()
    const channel = supabase
      .channel(`environment-panel-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_orders", filter: `client_id=eq.${clientId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_environments", filter: `client_id=eq.${clientId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_equipment", filter: `client_id=eq.${clientId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_order_files" }, refreshVisibleFile)
      .subscribe()
    const fallback = window.setInterval(() => loadPanel(clientId, true), 15000)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadPanel(clientId, true)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      window.clearInterval(fallback)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      supabase.removeChannel(channel)
    }
  }, [data.viewer.clientId, data.viewer.clientScoped, selectedClientId, loadPanel])

  return (
    <PageShell
      title="Painel de Ambientes e Equipamentos"
      description="Acompanhe cada ambiente do cliente e a conclusao das evidencias diretamente nas OS."
      actions={<Button asChild variant="outline"><Link href="/dashboard">Voltar ao Dashboard</Link></Button>}
    >
      {error ? <AlertRow><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => loadPanel(selectedClientId)}>Tentar novamente</Button></div></AlertRow> : null}

      <section className="flex flex-col gap-4 border-y py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2 lg:w-[520px]">
          <label className="text-sm font-semibold">Cliente</label>
          {data.viewer.clientScoped ? (
            <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{data.selectedClient?.name || "Cliente vinculado"}</div>
          ) : (
            <Select value={selectedClientId || undefined} onValueChange={(value) => {
              setOrderFilter("all")
              setSelectedClientId(value)
            }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
              <SelectContent sortItems>
                {data.availableClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{data.updatedAt ? `Atualizado ${new Date(data.updatedAt).toLocaleTimeString("pt-BR")}` : "Aguardando cliente"}</span>
          <Button size="icon" variant="ghost" title="Atualizar agora" disabled={!selectedClientId || refreshing} onClick={() => loadPanel(selectedClientId, true)}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryItem label="Ambientes" value={data.summary.total} icon={Building2} className="text-slate-700" />
        <SummaryItem label="Sem OS" value={data.summary.idle} icon={Grid3X3} className="text-slate-500" />
        <SummaryItem label="Abertas" value={data.summary.open} icon={Clock3} className="text-blue-600" />
        <SummaryItem label="Em andamento" value={data.summary.inProgress} icon={RefreshCw} className="text-orange-500" />
        <SummaryItem label="Finalizadas" value={data.summary.finished} icon={CheckCircle2} className="text-emerald-600" />
      </div>

      <div className="flex flex-col gap-4 border-y py-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold">Filtrar por status</p>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar ambientes por status">
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              Todos <span className="ml-1 opacity-75">{data.summary.total}</span>
            </Button>
            {(Object.keys(stateMeta) as TileState[]).map((state) => (
              <Button key={state} size="sm" variant={statusFilter === state ? "default" : "outline"} aria-pressed={statusFilter === state} onClick={() => setStatusFilter(state)}>
                <span className={cn("h-2.5 w-2.5 rounded-sm", stateMeta[state].className)} />
                {stateMeta[state].label}
                <span className="ml-1 opacity-75">{data.summary[state]}</span>
              </Button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(240px,1fr)_160px_160px] xl:w-[720px]">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Ordem de servico</label>
            <Select value={orderFilter} onValueChange={setOrderFilter} disabled={!selectedClientId && !data.viewer.clientScoped}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Todas as OS" /></SelectTrigger>
              <SelectContent sortItems>
                <SelectItem value="all">Todas as OS</SelectItem>
                {data.availableOrders.map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.number} - {order.type}{order.scheduledDate ? ` - ${formatDate(order.scheduledDate)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label htmlFor="environment-date-from" className="text-sm font-semibold">Data inicial</label>
            <input id="environment-date-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <label htmlFor="environment-date-to" className="text-sm font-semibold">Data final</label>
            <input id="environment-date-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <section className="space-y-3 border-y py-4" aria-labelledby="environment-status-chart-title">
        <div>
          <h2 id="environment-status-chart-title" className="text-base font-semibold">Ambientes por status</h2>
          <p className="text-sm text-muted-foreground">Resultado atualizado conforme o cliente, a OS e o periodo selecionados.</p>
        </div>
        <div className="h-[300px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" interval={0} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} width={42} />
              <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} formatter={(value) => [Number(value), "Ambientes"]} />
              <Bar dataKey="value" name="Ambientes" radius={[4, 4, 0, 0]} maxBarSize={120}>
                {chartData.map((item) => <Cell key={item.name} fill={item.color} />)}
                <LabelList dataKey="value" position="top" className="fill-foreground text-xs font-semibold" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {!selectedClientId && !data.viewer.clientScoped ? (
        <div className="border-y py-16 text-center text-sm text-muted-foreground">Selecione um cliente para visualizar os apartamentos, ambientes e equipamentos.</div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 18 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : !data.groups.length ? (
        <div className="border-y py-16 text-center text-sm text-muted-foreground">
          {orderFilter !== "all" || dateFrom || dateTo ? "Nenhum ambiente encontrado para a OS ou periodo selecionado." : "Nenhum ambiente cadastrado para este cliente."}
        </div>
      ) : !filteredGroups.length ? (
        <div className="border-y py-16 text-center text-sm text-muted-foreground">Nenhum ambiente encontrado neste status.</div>
      ) : (
        <div className="space-y-7">
          {filteredGroups.map((group) => (
            <section key={group.name} className="space-y-3">
              <div className="flex items-center gap-3 border-b pb-2">
                <h2 className="text-base font-semibold">{group.name}</h2>
                <span className="text-xs text-muted-foreground">{group.items.length} {group.items.length === 1 ? "ambiente" : "ambientes"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
                {group.items.map((tile) => <EnvironmentTile key={tile.id} tile={tile} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function SummaryItem({ label, value, icon: Icon, className }: { label: string; value: number; icon: typeof Building2; className: string }) {
  return (
    <div className="flex min-h-20 items-center justify-between border-y px-3 py-3">
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
      <Icon className={cn("h-5 w-5", className)} />
    </div>
  )
}

function EnvironmentTile({ tile }: { tile: PanelData["groups"][number]["items"][number] }) {
  const meta = stateMeta[tile.state]
  const equipmentTitle = tile.equipment.map((item) => `${item.label}${item.capacity ? ` (${item.capacity})` : ""}`).join("\n")
  return (
    <article
      className={cn("flex min-h-32 flex-col justify-between rounded-md border p-3 shadow-sm transition-colors", meta.className)}
      title={equipmentTitle || "Nenhum equipamento cadastrado"}
    >
      <div className="min-w-0">
        <p className="break-words text-sm font-bold leading-tight">{tile.name}</p>
        {tile.location ? <p className={cn("mt-1 text-xs", tile.state === "idle" ? "text-slate-500" : "text-white/80")}>{tile.location}</p> : null}
      </div>
      <div className="mt-3 space-y-1 text-[11px] leading-tight">
        <p>{tile.equipmentCount} {tile.equipmentCount === 1 ? "equipamento" : "equipamentos"}</p>
        {tile.equipment.slice(0, 2).map((equipment) => (
          <p key={equipment.id} className="truncate" title={equipment.label}>{equipment.label}</p>
        ))}
        {tile.equipment.length > 2 ? <p>+{tile.equipment.length - 2} equipamentos</p> : null}
        {tile.order ? (
          <>
            <p className="font-semibold">{meta.label} · {tile.order.number}</p>
            <p>{tile.order.type}{tile.order.scheduledDate ? ` · ${formatDate(tile.order.scheduledDate)}` : ""}</p>
            {tile.photoProgress.total > 1 ? <p>Fotos finais: {tile.photoProgress.completed}/{tile.photoProgress.total}</p> : null}
            <Button asChild size="sm" variant="ghost" className={cn("mt-1 h-6 w-full justify-start px-0 text-[11px]", tile.state !== "idle" && "text-white hover:bg-white/10 hover:text-white")}>
              <Link href={`/ordens-servico/${tile.order.id}`}>Ver OS <ExternalLink className="ml-1 h-3 w-3" /></Link>
            </Button>
          </>
        ) : <p className="font-semibold">Sem PMOC ou servico vinculado</p>}
      </div>
    </article>
  )
}
