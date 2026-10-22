"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarClock, CircleHelp, Factory, LayoutGrid, Loader2, Map as MapIcon, OctagonX, Play, Plus, RefreshCw, Search, Wrench } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, MetricCard, PageShell, SectionCard, SelectField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { TableCell, TableRow } from "@/components/ui/table"
import { dueState, effectiveDate, orderCost, orderLabel, orderStatuses, orderTypes, statusMeta, sumMoney, isOpenOrder, type MachineStatus } from "@/lib/machines"
import { StatusPill } from "@/components/machines/machine-art"
import { brl, day, mApi, useMachines, useNow, hours, type Overview, type Row } from "@/components/machines/machine-data"
import { CompleteDialog, OrderSheet, PlanSheet, ReportDialog, StatusDialog } from "@/components/machines/machine-dialogs"
import { MachineFormSheet } from "@/components/machines/machine-form"
import { MachineCard, SectorMap, nextMaintenance } from "@/components/machines/machine-views"
import { OrderActions, OrderBadge } from "@/components/machines/order-actions"

const all = "todos"

const machineTabs = [
  { label: "Visão Geral", href: "/maquinas", need: "view" }, { label: "Todas as Máquinas", href: "/maquinas/todas", need: "view" }, { label: "Manutenções", href: "/maquinas/manutencoes", need: "view" },
  { label: "Manutenções Programadas", href: "/maquinas/programadas", need: "view" }, { label: "Histórico de Manutenções", href: "/maquinas/historico", need: "view" },
  { label: "Custos e Depreciação", href: "/maquinas/custos", need: "patrimony" }, { label: "Relatórios", href: "/maquinas/relatorios", need: "view" }, { label: "Configurações", href: "/maquinas/configuracoes", need: "maintain" },
] as const

/** Abas do módulo (uma única entrada no menu lateral; cada aba é uma subpágina). */
export function MachineTabs() {
  const pathname = usePathname() || ""
  const [caps, setCaps] = useState<Record<string, boolean>>({ view: true, patrimony: true, maintain: true })
  useEffect(() => { mApi<Overview>("data").then((result) => setCaps(result.caps as any)).catch(() => undefined) }, [])
  return (
    <nav aria-label="Seções de máquinas" className="-mt-2 flex gap-1 overflow-x-auto border-b">
      {machineTabs.filter((tab) => caps[tab.need]).map((tab) => {
        const active = tab.href === "/maquinas" ? pathname === tab.href : pathname.startsWith(tab.href)
        return <Link key={tab.href} href={tab.href} prefetch={false} aria-current={active ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>
      })}
    </nav>
  )
}

/** Casca comum: carrega dados, mostra estado de carregamento/erro e entrega o painel já sincronizado. */
export function MachinesShell({ title, description, actions, children }: { title: string; description: string; actions?: (ctx: { data: Overview; reload: () => void }) => React.ReactNode; children: (ctx: { data: Overview; reload: () => void; now: number }) => React.ReactNode }) {
  const { data, error, loading, reload } = useMachines()
  const now = useNow()
  const refresh = () => { void reload(true) }
  return (
    <PageShell title={title} description={description} actions={data ? <>{actions?.({ data, reload: refresh })}<Button variant="outline" size="icon" onClick={() => reload()} aria-label="Atualizar" title="Atualizar"><RefreshCw className="h-4 w-4" /></Button></> : undefined}>
      <MachineTabs />
      {error && !data ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      {loading && !data ? <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando máquinas…</div> : null}
      {data ? children({ data, reload: refresh, now }) : null}
    </PageShell>
  )
}

function useMachineFilters(data: Overview) {
  const [query, setQuery] = useState("")
  const [sector, setSector] = useState(all)
  const [category, setCategory] = useState(all)
  const [status, setStatus] = useState(all)
  const [responsible, setResponsible] = useState(all)
  const responsibles = useMemo(() => [...new Set(data.machines.map((machine) => String(machine.responsibleName || "")).filter(Boolean))].sort(), [data.machines])
  const text = query.trim().toLowerCase()
  const filtered = useMemo(() => data.machines.filter((machine) => {
    if (sector !== all && (machine.sectorId || "sem") !== sector) return false
    if (category !== all && (machine.categoryId || "sem") !== category) return false
    if (responsible !== all && machine.responsibleName !== responsible) return false
    if (status === "inativas") return machine.adminStatus !== "Ativo"
    if (status !== all && (machine.adminStatus !== "Ativo" || machine.operationalStatus !== status)) return false
    if (status === all && machine.adminStatus === "Baixado") return false
    return !text || [machine.name, machine.code, machine.model, machine.manufacturer, machine.serialNumber, machine.brand].some((value) => String(value || "").toLowerCase().includes(text))
  }), [data.machines, sector, category, status, responsible, text])
  const bar = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-52 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por nome, código, modelo ou série" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar máquinas" /></div>
      <div className="w-44"><SelectField label="Setor" value={sector} onChange={setSector} options={[{ value: all, label: "Todos" }, ...data.sectors.map((item) => ({ value: item.id, label: item.name })), { value: "sem", label: "Sem setor" }]} /></div>
      <div className="w-44"><SelectField label="Categoria" value={category} onChange={setCategory} options={[{ value: all, label: "Todas" }, ...data.categories.map((item) => ({ value: item.id, label: item.name })), { value: "sem", label: "Sem categoria" }]} /></div>
      <div className="w-44"><SelectField label="Status" value={status} onChange={setStatus} options={[{ value: all, label: "Todos" }, { value: "Em operacao", label: "Em operação" }, { value: "Em manutencao", label: "Em manutenção" }, { value: "Parada", label: "Parada" }, { value: "Nao informado", label: "Sem status" }, { value: "inativas", label: "Inativas / baixadas" }]} /></div>
      <div className="w-44"><SelectField label="Responsável" value={responsible} onChange={setResponsible} options={[{ value: all, label: "Todos" }, ...responsibles.map((name) => ({ value: name, label: name }))]} /></div>
    </div>
  )
  return { filtered, bar }
}

const canRegister = (data: Overview) => data.caps.maintain || data.caps.patrimony

// ===================== Visão Geral =====================
export function OverviewPage() {
  return (
    <MachinesShell title="Máquinas e equipamentos" description="Quem está trabalhando, em manutenção ou parado agora, com a cor do status no próprio desenho da máquina." actions={({ data, reload }) => <NewMachineButton data={data} reload={reload} />}>
      {({ data, reload, now }) => <OverviewBody data={data} reload={reload} now={now} />}
    </MachinesShell>
  )
}

function NewMachineButton({ data, reload }: { data: Overview; reload: () => void }) {
  const [open, setOpen] = useState(false)
  if (!canRegister(data)) return null
  return <><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nova máquina</Button><MachineFormSheet open={open} machine={null} data={data} onClose={() => setOpen(false)} onSaved={reload} /></>
}

function OverviewBody({ data, reload, now }: { data: Overview; reload: () => void; now: number }) {
  const [view, setView] = useState<"cards" | "mapa">("cards")
  const [reporting, setReporting] = useState<Row | null>(null)
  const { filtered, bar } = useMachineFilters(data)
  const active = data.machines.filter((machine) => machine.adminStatus === "Ativo")
  const count = (status: MachineStatus) => active.filter((machine) => machine.operationalStatus === status).length
  const plansState = data.plans.filter((plan) => plan.active).map((plan) => {
    const machine = data.machines.find((item) => item.id === plan.machineId)
    return machine && machine.adminStatus === "Ativo" ? dueState({ dueDate: plan.nextDueDate || null, dueHours: plan.nextDueHours }, data.today, machine.hourMeter, { soonDays: data.settings.dueSoonDays, combineRule: plan.combineRule }) : "Sem prazo"
  })
  const overdue = plansState.filter((state) => state === "Vencida").length
  const soon = plansState.filter((state) => state === "Proxima").length
  const occurrences = data.orders.filter((order) => order.origin === "Ocorrencia" && order.status === "Aberta").length
  const costView = data.caps.maintain || data.caps.patrimony
  const month = data.today.slice(0, 7)
  const monthCost = sumMoney(...data.orders.filter((order) => order.status === "Concluida" && order.origin !== "Ocorrencia" && effectiveDate(order).startsWith(month)).map((order) => orderCost(order)))
  const donut = (["Em operacao", "Em manutencao", "Parada", "Nao informado"] as MachineStatus[]).map((status) => ({ name: statusMeta[status].label, value: count(status), color: statusMeta[status].color })).filter((item) => item.value)
  const bySector = data.sectors.map((sector) => ({ name: sector.name, ...Object.fromEntries((["Em operacao", "Em manutencao", "Parada"] as MachineStatus[]).map((status) => [status, active.filter((machine) => machine.sectorId === sector.id && machine.operationalStatus === status).length])) })).filter((row: Row) => row["Em operacao"] + row["Em manutencao"] + row.Parada > 0)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Em operação" value={count("Em operacao")} note={`de ${active.length} máquinas ativas`} icon={Play} />
        <MetricCard title="Em manutenção" value={count("Em manutencao")} note="indisponíveis para produção" icon={Wrench} />
        <MetricCard title="Paradas" value={count("Parada")} note="motivo no card de cada máquina" icon={OctagonX} />
        <MetricCard title="Sem status informado" value={count("Nao informado")} note="ninguém informou ainda" icon={CircleHelp} />
        <MetricCard title="Manutenções vencidas" value={overdue} note={`${soon} próximas (${data.settings.dueSoonDays} dias)`} icon={AlertTriangle} />
        <MetricCard title="Ocorrências abertas" value={occurrences} note="problemas reportados pela fábrica" icon={CalendarClock} />
        <MetricCard title="Ordens em aberto" value={data.orders.filter((order) => order.origin === "Ordem" && isOpenOrder(order.status)).length} note="OM não concluídas" icon={Factory} />
        {costView ? <MetricCard title="Manutenção no mês" value={brl(monthCost)} note="ordens concluídas no mês" icon={Wrench} /> : <MetricCard title="Total de máquinas" value={data.machines.length} note="cadastradas" icon={LayoutGrid} />}
      </div>

      {data.machines.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Situação da fábrica">
            <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>{donut.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>
          </SectionCard>
          <SectionCard title="Por setor">
            {bySector.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={bySector}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="Em operacao" name="Em operação" stackId="a" fill={statusMeta["Em operacao"].color} /><Bar dataKey="Em manutencao" name="Em manutenção" stackId="a" fill={statusMeta["Em manutencao"].color} /><Bar dataKey="Parada" name="Parada" stackId="a" fill={statusMeta.Parada.color} /></BarChart></ResponsiveContainer></div> : <p className="p-6 text-sm text-muted-foreground">Defina o setor das máquinas para ver este gráfico.</p>}
          </SectionCard>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Forma de visualização">
            <Button size="sm" variant={view === "cards" ? "default" : "ghost"} onClick={() => setView("cards")}><LayoutGrid className="h-4 w-4" />Cards</Button>
            <Button size="sm" variant={view === "mapa" ? "default" : "ghost"} onClick={() => setView("mapa")}><MapIcon className="h-4 w-4" />Mapa de máquinas</Button>
          </div>
          <p className="text-xs text-muted-foreground">O status é informado por pessoas autorizadas (sem sensores) e atualiza sozinho a cada 30 s.</p>
        </div>
        {bar}
        {!data.machines.length ? (
          <div className="rounded-2xl border border-dashed p-10 text-center"><Factory className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">Nenhuma máquina cadastrada ainda</p><p className="text-sm text-muted-foreground">{canRegister(data) ? "Use “Nova máquina” para cadastrar a primeira; o código e o QR Code saem automaticamente." : "Peça ao manutentor para cadastrar as máquinas."}</p></div>
        ) : !filtered.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma máquina com esses filtros.</p> : view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map((machine) => <MachineCard key={machine.id} data={data} machine={machine} now={now} onReport={setReporting} canReport />)}</div>
        ) : <SectorMap data={data} machines={filtered} now={now} onReport={setReporting} canReport />}
      </div>
      <ReportDialog machine={reporting} open={Boolean(reporting)} onClose={() => setReporting(null)} onSaved={reload} />
    </>
  )
}

// ===================== Todas as máquinas =====================
export function AllMachinesPage() {
  return <MachinesShell title="Todas as máquinas" description="Cadastro completo: busca, filtros, edição e acesso à ficha de cada máquina." actions={({ data, reload }) => <NewMachineButton data={data} reload={reload} />}>{({ data, reload, now }) => <AllBody data={data} reload={reload} now={now} />}</MachinesShell>
}

function AllBody({ data, reload }: { data: Overview; reload: () => void; now: number }) {
  const { filtered, bar } = useMachineFilters(data)
  const [editing, setEditing] = useState<Row | null>(null)
  const [statusFor, setStatusFor] = useState<Row | null>(null)
  const sector = (id: string) => data.sectors.find((item) => item.id === id)?.name || "—"
  const category = (id: string) => data.categories.find((item) => item.id === id)?.name || "—"
  return (
    <>
      {bar}
      <SectionCard title={`${filtered.length} máquina(s)`}>
        <DataTable headers={["Código", "Máquina", "Categoria", "Setor", "Status", "Última manutenção", "Próxima", "Ações"]} empty={!filtered.length}>
          {filtered.map((machine) => {
            const next = nextMaintenance(data, machine)
            return (
              <TableRow key={machine.id}>
                <TableCell className="font-mono text-xs">{machine.code}</TableCell>
                <TableCell><Link className="font-medium text-primary hover:underline" href={`/maquinas/${machine.id}`} prefetch={false}>{machine.name}</Link><p className="text-xs text-muted-foreground">{[machine.manufacturer, machine.model].filter(Boolean).join(" ")}</p></TableCell>
                <TableCell>{category(machine.categoryId)}</TableCell><TableCell>{sector(machine.sectorId)}</TableCell>
                <TableCell>{machine.adminStatus !== "Ativo" ? <span className="text-sm font-semibold text-slate-600">{machine.adminStatus}</span> : <StatusPill status={machine.operationalStatus} />}</TableCell>
                <TableCell>{day(machine.lastMaintenanceAt)}</TableCell>
                <TableCell className={next.state === "Vencida" ? "font-semibold text-red-600" : ""}>{next.date ? day(next.date) : next.hours != null ? hours(next.hours) : "—"}</TableCell>
                <TableCell><div className="flex gap-1.5"><Button asChild size="sm" variant="outline"><Link href={`/maquinas/${machine.id}`} prefetch={false}>Ver</Link></Button>{data.caps.maintain && machine.adminStatus === "Ativo" ? <Button size="sm" variant="outline" onClick={() => setStatusFor(machine)}>Status</Button> : null}{canRegister(data) ? <Button size="sm" variant="ghost" onClick={() => setEditing(machine)}>Editar</Button> : null}</div></TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>
      <MachineFormSheet open={Boolean(editing)} machine={editing} data={data} onClose={() => setEditing(null)} onSaved={reload} />
      <StatusDialog machine={statusFor} orders={data.orders} open={Boolean(statusFor)} onClose={() => setStatusFor(null)} onSaved={reload} />
    </>
  )
}

// ===================== Manutenções (ordens e ocorrências) =====================
export function OrdersPage() {
  return <MachinesShell title="Manutenções" description="Ordens de manutenção (OM) e problemas reportados pela fábrica." actions={({ data, reload }) => <OrderCreate data={data} reload={reload} />}>{({ data, reload }) => <OrdersBody data={data} reload={reload} />}</MachinesShell>
}

function OrderCreate({ data, reload }: { data: Overview; reload: () => void }) {
  const [open, setOpen] = useState(false)
  if (!data.caps.maintain) return null
  return <><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nova ordem</Button><OrderSheet open={open} kind="Ordem" machines={data.machines.filter((machine) => machine.adminStatus === "Ativo")} caps={data.caps} onClose={() => setOpen(false)} onSaved={reload} /></>
}

function OrdersBody({ data, reload }: { data: Overview; reload: () => void }) {
  const [state, setState] = useState("abertas")
  const [type, setType] = useState(all)
  const [machine, setMachine] = useState(all)
  const [completing, setCompleting] = useState<Row | null>(null)
  const [release, setRelease] = useState<Row | null>(null)
  const [occurrence, setOccurrence] = useState<Row | null>(null)
  const { toast } = useCrudFeedback()
  const byId = (id: string) => data.machines.find((item) => item.id === id)
  const list = data.orders.filter((order) => order.origin !== "Historico").filter((order) => (state === "abertas" ? isOpenOrder(order.status) && order.origin === "Ordem" : state === "ocorrencias" ? order.origin === "Ocorrencia" && order.status === "Aberta" : state === all ? true : order.status === state))
    .filter((order) => (type === all || order.maintenanceType === type) && (machine === all || order.machineId === machine))
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48"><SelectField label="Mostrar" value={state} onChange={setState} options={[{ value: "abertas", label: "Ordens em aberto" }, { value: "ocorrencias", label: "Ocorrências abertas" }, ...orderStatuses.map((value) => ({ value, label: orderLabel(value) })), { value: all, label: "Tudo" }]} /></div>
        <div className="w-44"><SelectField label="Tipo" value={type} onChange={setType} options={[{ value: all, label: "Todos" }, ...orderTypes.map((value) => ({ value, label: orderLabel(value) }))]} /></div>
        <div className="w-64"><SelectField label="Máquina" value={machine} onChange={setMachine} options={[{ value: all, label: "Todas" }, ...data.machines.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))]} /></div>
      </div>
      <SectionCard title={`${list.length} registro(s)`}>
        <DataTable headers={["Número", "Máquina", "Tipo", "Prioridade", "Status", "Descrição", "Prazo", "Ações"]} empty={!list.length}>
          {list.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs">{order.orderNumber || "Ocorrência"}</TableCell>
              <TableCell><Link className="text-primary hover:underline" href={`/maquinas/${order.machineId}`} prefetch={false}>{byId(order.machineId)?.name || "—"}</Link></TableCell>
              <TableCell>{orderLabel(order.maintenanceType)}</TableCell><TableCell><OrderBadge value={order.priority} /></TableCell><TableCell><OrderBadge value={order.status} /></TableCell>
              <TableCell className="max-w-xs"><p className="truncate" title={order.description}>{order.description}</p>{order.blocksOperation ? <span className="text-xs text-red-600">impede o uso</span> : null}</TableCell>
              <TableCell>{day(order.dueDate)}</TableCell>
              <TableCell>
                {order.origin === "Ocorrencia" ? (data.caps.maintain ? <Button size="sm" variant="outline" onClick={() => setOccurrence(order)}>Abrir ordem</Button> : null) : <OrderActions order={order} caps={data.caps} onChanged={reload} onComplete={setCompleting} />}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
      <OrderSheet open={Boolean(occurrence)} kind="Ordem" machines={data.machines} machineId={occurrence?.machineId} caps={data.caps} fromOccurrence={occurrence} onClose={() => setOccurrence(null)} onSaved={reload} />
      <CompleteDialog order={completing} open={Boolean(completing)} onClose={() => setCompleting(null)} onDone={(suggested, machineId) => { reload(); if (suggested) { toast({ title: "Ordem concluída", description: "A máquina segue em manutenção até a liberação ser confirmada." }); setRelease(byId(machineId) || null) } }} />
      <StatusDialog machine={release} orders={data.orders} open={Boolean(release)} preset="Em operacao" onClose={() => setRelease(null)} onSaved={reload} />
    </>
  )
}

// ===================== Manutenções programadas =====================
export function PlansPage() {
  return <MachinesShell title="Manutenções programadas" description="Planos preventivos por máquina: dias, meses, horas de operação ou data específica." actions={({ data, reload }) => <PlanCreate data={data} reload={reload} />}>{({ data, reload }) => <PlansBody data={data} reload={reload} />}</MachinesShell>
}

function PlanCreate({ data, reload }: { data: Overview; reload: () => void }) {
  const [open, setOpen] = useState(false)
  if (!data.caps.maintain) return null
  return <><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Novo plano</Button><PlanSheet open={open} plan={null} machines={data.machines.filter((machine) => machine.adminStatus === "Ativo")} onClose={() => setOpen(false)} onSaved={reload} /></>
}

function PlansBody({ data, reload }: { data: Overview; reload: () => void }) {
  const { toast } = useCrudFeedback()
  const [filter, setFilter] = useState(all)
  const [editing, setEditing] = useState<Row | null>(null)
  const rows = data.plans.filter((plan) => plan.active).map((plan) => {
    const machine = data.machines.find((item) => item.id === plan.machineId)
    const state = machine ? dueState({ dueDate: plan.nextDueDate || null, dueHours: plan.nextDueHours }, data.today, machine.hourMeter, { soonDays: data.settings.dueSoonDays, combineRule: plan.combineRule }) : "Sem prazo"
    const open = data.orders.find((order) => order.planId === plan.id && isOpenOrder(order.status))
    return { plan, machine, state, open }
  }).filter((row) => row.machine && row.machine.adminStatus === "Ativo" && (filter === all || row.state === filter))
    .sort((a, b) => String(a.plan.nextDueDate || "9999").localeCompare(String(b.plan.nextDueDate || "9999")))
  const tone = (state: string) => (state === "Vencida" ? "text-red-600 font-semibold" : state === "Proxima" ? "text-amber-600 font-semibold" : "text-muted-foreground")
  return (
    <>
      <div className="w-56"><SelectField label="Situação" value={filter} onChange={setFilter} options={[{ value: all, label: "Todas" }, { value: "Vencida", label: "Vencidas" }, { value: "Proxima", label: "Próximas" }, { value: "Em dia", label: "Em dia" }]} /></div>
      <SectionCard title={`${rows.length} plano(s)`} description="Não é criada ordem duplicada: enquanto houver uma ordem aberta do plano, ele não gera outra.">
        <DataTable headers={["Máquina", "Plano", "Regra", "Última execução", "Próximo vencimento", "Situação", "Ordem", "Ações"]} empty={!rows.length}>
          {rows.map(({ plan, machine, state, open }) => (
            <TableRow key={plan.id}>
              <TableCell><Link className="text-primary hover:underline" href={`/maquinas/${machine!.id}`} prefetch={false}>{machine!.name}</Link></TableCell>
              <TableCell>{plan.name}{plan.autoCreateOrder ? <span className="ml-1 text-xs text-muted-foreground">(automático)</span> : null}</TableCell>
              <TableCell className="text-xs">{[plan.intervalDays && `${plan.intervalDays} dias`, plan.intervalMonths && `${plan.intervalMonths} meses`, plan.intervalHours && `${plan.intervalHours} h`, plan.fixedDate && `em ${day(plan.fixedDate)}`].filter(Boolean).join(" · ")}</TableCell>
              <TableCell>{day(plan.lastDoneDate)}</TableCell>
              <TableCell className={tone(state)}>{plan.nextDueDate ? day(plan.nextDueDate) : "—"}{plan.nextDueHours != null ? ` · ${hours(plan.nextDueHours)}` : ""}</TableCell>
              <TableCell className={tone(state)}>{state === "Vencida" ? "Vencida" : state === "Proxima" ? "Próxima" : state === "Em dia" ? "Em dia" : "Sem prazo"}</TableCell>
              <TableCell className="font-mono text-xs">{open?.orderNumber || "—"}</TableCell>
              <TableCell>{data.caps.maintain ? <div className="flex gap-1.5"><Button size="sm" variant="outline" disabled={Boolean(open)} onClick={async () => { try { await mApi("plan-order", { body: { item: { planId: plan.id } } }); toast({ title: "Ordem aberta" }); reload() } catch (caught) { toast({ title: "Não foi possível abrir a ordem", description: caught instanceof Error ? caught.message : "", variant: "destructive" }) } }}>Abrir ordem</Button><Button size="sm" variant="ghost" onClick={() => setEditing(plan)}>Editar</Button></div> : null}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
      <PlanSheet open={Boolean(editing)} plan={editing} machines={data.machines} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}

// ===================== Histórico =====================
export function HistoryPage() {
  return <MachinesShell title="Histórico de manutenções" description="Tudo o que foi feito, em ordem cronológica pela data real da execução (inclusive antes de a máquina entrar no sistema)." actions={({ data, reload }) => <HistoricCreate data={data} reload={reload} />}>{({ data }) => <HistoryBody data={data} />}</MachinesShell>
}

function HistoricCreate({ data, reload }: { data: Overview; reload: () => void }) {
  const [open, setOpen] = useState(false)
  if (!data.caps.maintain) return null
  return <><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Registrar manutenção anterior</Button><OrderSheet open={open} kind="Historico" machines={data.machines} caps={data.caps} onClose={() => setOpen(false)} onSaved={reload} /></>
}

function HistoryBody({ data }: { data: Overview }) {
  const [machine, setMachine] = useState(all)
  const [type, setType] = useState(all)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const showCost = data.caps.maintain || data.caps.patrimony
  const list = data.orders.filter((order) => order.status === "Concluida" && order.origin !== "Ocorrencia" && (machine === all || order.machineId === machine) && (type === all || order.maintenanceType === type) && (!start || effectiveDate(order) >= start) && (!end || effectiveDate(order) <= end))
    .sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64"><SelectField label="Máquina" value={machine} onChange={setMachine} options={[{ value: all, label: "Todas" }, ...data.machines.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))]} /></div>
        <div className="w-44"><SelectField label="Tipo" value={type} onChange={setType} options={[{ value: all, label: "Todos" }, ...orderTypes.map((value) => ({ value, label: orderLabel(value) }))]} /></div>
        <div className="w-40"><TextField label="De" type="date" value={start} onChange={setStart} /></div>
        <div className="w-40"><TextField label="Até" type="date" value={end} onChange={setEnd} /></div>
      </div>
      <SectionCard title={`${list.length} manutenção(ões)`}>
        <DataTable headers={["Executada em", "Lançada em", "Máquina", "Tipo", "Origem", "Serviço", "Responsável", ...(showCost ? ["Custo"] : []), "Parada"]} empty={!list.length}>
          {list.map((order) => {
            const machineRow = data.machines.find((item) => item.id === order.machineId)
            return (
              <TableRow key={order.id}>
                <TableCell>{day(effectiveDate(order))}</TableCell><TableCell className="text-muted-foreground">{day(order.createdAt)}</TableCell>
                <TableCell><Link className="text-primary hover:underline" href={`/maquinas/${order.machineId}`} prefetch={false}>{machineRow?.name || "—"}</Link></TableCell>
                <TableCell>{orderLabel(order.maintenanceType)}</TableCell><TableCell className="text-xs">{order.origin === "Historico" ? "Anterior ao cadastro" : order.orderNumber}</TableCell>
                <TableCell className="max-w-xs"><p className="truncate" title={order.description}>{order.description}</p></TableCell>
                <TableCell>{order.technician || order.externalCompany || order.responsible || "—"}</TableCell>
                {showCost ? <TableCell className="tabular-nums">{brl(orderCost(order))}</TableCell> : null}
                <TableCell>{hours(order.downtimeHours)}</TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>
    </>
  )
}
