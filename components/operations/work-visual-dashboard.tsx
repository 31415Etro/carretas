"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Building2, CheckCircle2, ChevronDown, Clock3, ExternalLink, Grid3X3, ImageIcon, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertRow, PageShell } from "@/components/operations/shared"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type PointState = "idle" | "open" | "inProgress" | "finished"
type PointOrder = { id: string; number: string; status: string; state: PointState }
type WorkPoint = { id: string; name: string; number: number; state: PointState; orders: PointOrder[] }
type WorkEnvironment = { id: string; name: string; state: PointState; total: number; finished: number; photo: { url: string; description: string } | null; points: WorkPoint[] }
type WorkFinal = { id: string; name: string; state: PointState; total: number; finished: number; progress: number; environments: WorkEnvironment[] }
type WorkFloor = { id: string; name: string; level: string; total: number; finished: number; progress: number; finals: WorkFinal[] }
type WorkTower = { id: string; name: string; description: string; total: number; finished: number; progress: number; floors: WorkFloor[] }
type ServiceOrderOption = { id: string; number: string; status: string; scheduledDate: string | null; createdAt: string | null }
type DashboardData = {
  viewer: { role: string; clientScoped: boolean; clientId: string | null }
  clients: Array<{ id: string; name: string }>
  works: Array<{ id: string; clientId: string; clientName: string; name: string }>
  selectedWork: { id: string; clientId: string; clientName: string; name: string } | null
  serviceOrders: ServiceOrderOption[]
  selectedOrderIds: string[]
  summary: Record<PointState, number> & { total: number; progress: number }
  towers: WorkTower[]
  orderFloors?: Array<{ id: string; name: string; tower: string; total: number; finished: number; progress: number; orders: Array<{ id: string; number: string; state: PointState; status: string; description: string; date: string }> }>
  orderPoints?: Array<{ id: string; name: string; path: string; state: PointState; orders: PointOrder[] }>
  orderSummary?: { total: number; open: number; inProgress: number; finished: number; progress: number }
  updatedAt: string
}

const emptyData: DashboardData = {
  viewer: { role: "", clientScoped: false, clientId: null }, clients: [], works: [], selectedWork: null,
  serviceOrders: [], selectedOrderIds: [], summary: { total: 0, idle: 0, open: 0, inProgress: 0, finished: 0, progress: 0 }, towers: [], updatedAt: "",
}

const stateMeta: Record<PointState, { label: string; className: string; icon: typeof Building2 }> = {
  idle: { label: "Sem OS", className: "border-slate-200 bg-slate-100 text-slate-700", icon: Grid3X3 },
  open: { label: "Aberta", className: "border-blue-600 bg-blue-600 text-white", icon: Clock3 },
  inProgress: { label: "Em andamento", className: "border-orange-500 bg-orange-500 text-white", icon: RefreshCw },
  finished: { label: "Finalizada", className: "border-emerald-600 bg-emerald-600 text-white", icon: CheckCircle2 },
}

export function WorkVisualDashboard({ initialClientId = "", initialWorkId = "", initialOrderIds = [] }: { initialClientId?: string; initialWorkId?: string; initialOrderIds?: string[] }) {
  const [clientId, setClientId] = useState(initialClientId)
  const [workId, setWorkId] = useState(initialWorkId)
  const [orderIds, setOrderIds] = useState<string[]>(initialOrderIds)
  const [status, setStatus] = useState<PointState | "all">("all")
  const [data, setData] = useState<DashboardData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const selectionRef = useRef({ clientId, workId, orderIds })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef(0)
  selectionRef.current = { clientId, workId, orderIds }

  const load = useCallback(async (selection = selectionRef.current, silent = false) => {
    const requestId = ++requestRef.current
    silent ? setRefreshing(true) : setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (selection.clientId) params.set("clientId", selection.clientId)
      if (selection.workId) params.set("workId", selection.workId)
      if (selection.orderIds.length) params.set("orderIds", selection.orderIds.join(","))
      const response = await fetch(`/api/operacional/work-dashboard?${params}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (requestId !== requestRef.current) return
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel carregar o Dashboard de Obra.")
      setData(payload)
      if (!selection.clientId && payload.viewer?.clientId) setClientId(payload.viewer.clientId)
      const nextWorkId = payload.selectedWork?.id || ""
      if (selection.workId !== nextWorkId) setWorkId(nextWorkId)
      if (selection.orderIds.join(",") !== (payload.selectedOrderIds || []).join(",")) setOrderIds(payload.selectedOrderIds || [])
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(cause instanceof Error ? cause.message : "Nao foi possivel carregar o Dashboard de Obra.")
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => { load({ clientId, workId, orderIds }) }, [clientId, workId, orderIds, load])
  useEffect(() => {
    if (!workId) return
    const refreshSoon = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => load(selectionRef.current, true), 350)
    }
    const supabase = createBrowserSupabaseClient()
    const channel = supabase.channel(`work-dashboard-${workId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_orders", filter: `work_id=eq.${workId}` }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_order_files" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "environment_photos" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_points" }, refreshSoon)
      .subscribe()
    const fallback = window.setInterval(() => load(selectionRef.current, true), 15000)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      window.clearInterval(fallback)
      supabase.removeChannel(channel)
    }
  }, [workId, load])

  const workOptions = useMemo(() => data.works.filter((work) => !clientId || work.clientId === clientId), [data.works, clientId])
  const visibleTowers = useMemo(() => data.towers.map((tower) => ({
    ...tower,
    floors: tower.floors.map((floor) => ({
      ...floor,
      finals: floor.finals.filter((final) => status === "all" || final.environments.some((environment) => environment.points.some((point) => point.state === status))),
    })).filter((floor) => floor.finals.length),
  })).filter((tower) => tower.floors.length), [data.towers, status])

  function changeClient(value: string) {
    requestRef.current += 1
    setClientId(value)
    setWorkId("")
    setOrderIds([])
  }

  function changeWork(value: string) {
    const work = data.works.find((item) => item.id === value)
    if (work?.clientId && work.clientId !== clientId) setClientId(work.clientId)
    setWorkId(value)
    setOrderIds([])
  }

  function toggleOrder(orderId: string, checked: boolean) {
    setOrderIds((current) => checked ? Array.from(new Set([...current, orderId])) : current.filter((id) => id !== orderId))
  }

  return (
    <PageShell title="Dashboard de Obra" description="Gestao a vista da execucao por cliente, obra, torre, pavimento, final, ambiente e ponto."
      actions={<><Button asChild variant="outline"><Link href="/dashboard">Voltar ao Dashboard</Link></Button><Button size="icon" variant="outline" title="Atualizar agora" disabled={!workId || refreshing} onClick={() => load(selectionRef.current, true)}><RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /></Button></>}>
      {error ? <AlertRow>{error}</AlertRow> : null}

      <section className="grid gap-3 border-y py-4 md:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(240px,1.2fr)_minmax(280px,1.4fr)_auto] xl:items-end">
        <div className="space-y-2"><label className="text-sm font-semibold">Cliente</label>{data.viewer.clientScoped ? <div className="flex h-10 items-center rounded-md border px-3 text-sm font-medium">{data.clients[0]?.name || "Cliente vinculado"}</div> : <Select value={clientId || undefined} onValueChange={changeClient}><SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger><SelectContent sortItems>{data.clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select>}</div>
        <div className="space-y-2"><label className="text-sm font-semibold">Obra/Projeto do orcamento</label><Select value={workId || undefined} onValueChange={changeWork} disabled={!workOptions.length}><SelectTrigger><SelectValue placeholder="Selecione a obra" /></SelectTrigger><SelectContent sortItems>{workOptions.map((work) => <SelectItem key={work.id} value={work.id}>{work.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2">
          <label className="text-sm font-semibold">Ordens de servico da obra</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="h-10 w-full justify-between px-3 font-normal" disabled={!clientId || !workId || !data.serviceOrders.length}>
                <span className="truncate">{!clientId ? "Selecione o cliente" : !workId ? "Selecione a obra" : !data.serviceOrders.length ? "Nenhuma OS de obra" : orderIds.length ? `${orderIds.length} OS selecionada${orderIds.length > 1 ? "s" : ""}` : "Todas as OS de obra"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(92vw,430px)] p-0">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm font-semibold">Filtrar OS</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOrderIds([])}>Exibir todas</Button>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {data.serviceOrders.map((order) => {
                  const checked = orderIds.includes(order.id)
                  const date = order.scheduledDate || order.createdAt
                  return <label key={order.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
                    <Checkbox checked={checked} onCheckedChange={(value) => toggleOrder(order.id, value === true)} aria-label={`Selecionar ${order.number}`} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{order.number}</span><span className="block text-xs text-muted-foreground">{date ? new Date(`${date}`.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "Sem data"} | {order.status}</span></span>
                  </label>
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">{data.updatedAt ? `Atualizado ${new Date(data.updatedAt).toLocaleTimeString("pt-BR")}` : "Aguardando selecao"}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Pontos da obra" value={data.summary.total} icon={Building2} />
        <Metric label="Sem OS" value={data.summary.idle} icon={Grid3X3} tone="text-slate-500" />
        <Metric label="Abertos" value={data.summary.open} icon={Clock3} tone="text-blue-600" />
        <Metric label="Em andamento" value={data.summary.inProgress} icon={RefreshCw} tone="text-orange-500" />
        <Metric label="Finalizados" value={data.summary.finished} icon={CheckCircle2} tone="text-emerald-600" />
      </div>

      <section className="flex flex-col gap-3 border-y py-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-sm font-semibold">Evolucao geral da obra</p><p className="text-2xl font-bold">{data.summary.progress}%</p></div>
        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted lg:max-w-xl"><div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${data.summary.progress}%` }} /></div>
        <div className="flex flex-wrap gap-2">{(["all", "idle", "open", "inProgress", "finished"] as const).map((value) => {
          const Icon = value === "all" ? Building2 : stateMeta[value].icon
          return <Button key={value} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}><Icon className="h-4 w-4" />{value === "all" ? "Todos" : stateMeta[value].label}</Button>
        })}</div>
      </section>

      {workId && !loading && data.orderSummary ? <section className="space-y-4 border-y py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Avanco das OS por ponto</h2><span className="text-sm">{data.orderSummary.finished} de {data.orderSummary.total} OS concluidas ({data.orderSummary.progress}%)</span></div>
        <div className="h-2 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-label="Conclusao das OS do projeto" aria-valuenow={data.orderSummary.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-emerald-600" style={{ width: `${data.orderSummary.progress}%` }} /></div>
        <div className="flex flex-wrap gap-5 text-sm"><span>Abertas: {data.orderSummary.open}</span><span>Em andamento: {data.orderSummary.inProgress}</span><span>Concluidas: {data.orderSummary.finished}</span></div>
        {(data.orderPoints || []).map((point) => {
          const orders = point.orders.filter((order) => status === "all" || order.state === status)
          if (!orders.length) return null
          return <section key={point.id} className="space-y-3 border-t pt-4">
            <div><h3 className="font-semibold">{point.name}</h3><p className="text-xs text-muted-foreground">{point.path}</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{orders.map((order) => <Link key={order.id} href={`/ordens-servico/${order.id}`} className={cn("min-w-0 space-y-2 rounded-md border p-4", stateMeta[order.state].className)}>
              <div className="flex items-center justify-between gap-2"><strong>{order.number}</strong><ExternalLink className="h-4 w-4 shrink-0" /></div>
              <p className="text-sm font-semibold">{stateMeta[order.state].label}</p><p className="break-words text-xs">{order.status}</p>
            </Link>)}</div>
          </section>
        })}
        {!data.orderSummary.total ? <p className="py-4 text-sm text-muted-foreground">Nenhuma OS de obra vinculada.</p> : null}
      </section> : null}
      {!workId ? <Empty text="Selecione um cliente e uma obra para montar as torres." /> : loading ? <div className="h-96 animate-pulse rounded-md bg-muted" /> : !visibleTowers.length ? <Empty text="Esta obra ainda nao possui pontos para o filtro selecionado." /> : <div className="space-y-8">{visibleTowers.map((tower) => <TowerView key={tower.id} tower={tower} />)}</div>}
    </PageShell>
  )
}

function Metric({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: number; icon: typeof Building2; tone?: string }) {
  return <div className="flex min-h-20 items-center justify-between border-y px-3 py-3"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div><Icon className={cn("h-5 w-5", tone)} /></div>
}

function Empty({ text }: { text: string }) { return <div className="border-y py-20 text-center text-sm text-muted-foreground">{text}</div> }

function TowerView({ tower }: { tower: WorkTower }) {
  const finalNames = Array.from(new Set(tower.floors.flatMap((floor) => floor.finals.map((final) => final.name))))
  return <section className="overflow-hidden rounded-md border bg-background shadow-sm">
    <header className="flex flex-col gap-3 border-b bg-slate-950 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between"><div><p className="text-lg font-bold">{tower.name}</p><p className="text-xs text-slate-300">{tower.finished} de {tower.total} pontos finalizados</p></div><div className="flex items-center gap-3"><div className="h-2 w-40 overflow-hidden rounded-sm bg-white/20"><div className="h-full bg-emerald-400" style={{ width: `${tower.progress}%` }} /></div><strong>{tower.progress}%</strong></div></header>
    <div className="overflow-x-auto">
      <div className="min-w-max p-4">
        <div className="grid gap-1" style={{ gridTemplateColumns: `150px repeat(${Math.max(1, finalNames.length)}, minmax(220px, 1fr)) 100px` }}>
          <div className="px-2 py-2 text-xs font-semibold text-muted-foreground">Pavimento</div>{finalNames.map((name) => <div key={name} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">{name}</div>)}<div className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">Evolucao</div>
          {tower.floors.map((floor) => <FloorRow key={floor.id} floor={floor} finalNames={finalNames} />)}
        </div>
      </div>
    </div>
  </section>
}

function FloorRow({ floor, finalNames }: { floor: WorkFloor; finalNames: string[] }) {
  const byName = new Map(floor.finals.map((final) => [final.name, final]))
  return <>
    <div className="flex min-h-24 flex-col justify-center border-y border-l bg-slate-900 px-3 text-white"><strong className="text-sm">{floor.name}</strong>{floor.level ? <span className="text-xs text-slate-300">Nivel {floor.level}</span> : null}</div>
    {finalNames.map((name) => { const final = byName.get(name); return final ? <FinalCell key={`${floor.id}-${name}`} final={final} /> : <div key={`${floor.id}-${name}`} className="min-h-24 border bg-slate-50" /> })}
    <div className="flex min-h-24 flex-col items-center justify-center border-y border-r bg-slate-50"><strong>{floor.progress}%</strong><span className="text-[10px] text-muted-foreground">{floor.finished}/{floor.total}</span></div>
  </>
}

function FinalCell({ final }: { final: WorkFinal }) {
  const meta = stateMeta[final.state]
  const FinalStateIcon = meta.icon
  const previewEnvironment = final.environments[0]
  return <details className={cn("group min-h-24 border transition-colors", meta.className)}>
    <summary className="flex min-h-28 cursor-pointer list-none flex-col justify-between p-3 marker:hidden">
      <div className="flex min-w-0 items-center gap-2">
        {previewEnvironment?.photo ? <img src={previewEnvironment.photo.url} alt={`Ambiente ${previewEnvironment.name}`} className="h-12 w-14 shrink-0 rounded-sm border border-white/40 bg-white object-contain" loading="lazy" /> : <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-sm border border-current/20 bg-white/20"><ImageIcon className="h-5 w-5" /></span>}
        <div className="min-w-0"><p className="break-words text-xs font-bold">{previewEnvironment?.name || "Ambiente"}</p><p className="mt-1 flex items-center gap-1.5 text-[11px]"><FinalStateIcon className="h-3.5 w-3.5 shrink-0" />{meta.label}</p>{final.environments.length > 1 ? <p className="mt-1 text-[10px] opacity-80">+{final.environments.length - 1} ambiente(s)</p> : null}</div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs"><span>{final.finished}/{final.total} pontos</span><strong>{final.progress}%</strong></div>
    </summary>
    <div className="border-t bg-background p-3 text-foreground">{final.environments.map((environment) => <EnvironmentProgress key={environment.id} environment={environment} />)}</div>
  </details>
}

function EnvironmentProgress({ environment }: { environment: WorkEnvironment }) {
  const meta = stateMeta[environment.state]
  const StateIcon = meta.icon
  return <article className="border-b py-3 last:border-0">
    <div className="flex min-w-0 gap-3">
      {environment.photo ? (
        <a href={environment.photo.url} target="_blank" rel="noreferrer" className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-50" title={environment.photo.description || `Foto do ambiente ${environment.name}`}>
          <img src={environment.photo.url} alt={`Ambiente ${environment.name}`} className="h-full w-full object-contain" loading="lazy" />
        </a>
      ) : (
        <div className="flex h-20 w-24 shrink-0 flex-col items-center justify-center rounded-md border bg-slate-50 text-slate-400" title="Ambiente sem foto cadastrada">
          <ImageIcon className="h-5 w-5" />
          <span className="mt-1 text-[9px]">Sem foto</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs font-bold">{environment.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><StateIcon className="h-3.5 w-3.5 shrink-0" />{meta.label}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{environment.finished}/{environment.total} pontos finalizados</p>
      </div>
    </div>
    <div className="mt-3 space-y-2">{environment.points.map((point) => {
      const PointStateIcon = stateMeta[point.state].icon
      return <div key={point.id} className="text-[11px]"><span className="flex min-w-0 items-center gap-2"><PointStateIcon className={cn("h-3.5 w-3.5 shrink-0", point.state === "idle" ? "text-slate-400" : point.state === "open" ? "text-blue-600" : point.state === "inProgress" ? "text-orange-500" : "text-emerald-600")} /><span className="truncate" title={point.name}>{point.name}</span></span>{point.orders.length ? <div className="ml-5 mt-1 flex flex-wrap gap-x-3 gap-y-1">{point.orders.map((order) => <Link key={order.id} className="font-semibold text-primary hover:underline" href={`/ordens-servico/${order.id}`}>{order.number}<ExternalLink className="ml-1 inline h-3 w-3" /></Link>)}</div> : <span className="ml-5 text-muted-foreground">Sem OS</span>}</div>
    })}</div>
  </article>
}
