"use client"

import Link from "next/link"
import { AlertTriangle, Clock, Gauge, MessageSquareWarning, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { dueState, formatDuration, isOpenOrder, statusMeta, type MachineStatus } from "@/lib/machines"
import { MachineArt, StatusPill } from "@/components/machines/machine-art"
import { day, fileUrl, hours, type Overview, type Row } from "@/components/machines/machine-data"

/** Próxima manutenção prevista: o plano ativo que vence primeiro (por data; por horímetro quando não houver data). */
export function nextMaintenance(data: Overview, machine: Row) {
  const plans = data.plans.filter((plan) => plan.machineId === machine.id && plan.active)
  const dated = plans.filter((plan) => plan.nextDueDate).sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)))[0]
  const hourly = plans.filter((plan) => plan.nextDueHours != null).sort((a, b) => a.nextDueHours - b.nextDueHours)[0]
  const state = (plan?: Row) => (plan ? dueState({ dueDate: plan.nextDueDate || null, dueHours: plan.nextDueHours }, data.today, machine.hourMeter, { soonDays: data.settings.dueSoonDays, combineRule: plan.combineRule }) : "Sem prazo")
  return { plan: dated || hourly, date: dated?.nextDueDate || "", hours: hourly?.nextDueHours ?? null, state: state(dated || hourly), hourlyState: state(hourly) }
}

export const machineOpenOrder = (data: Overview, machine: Row) => data.orders.filter((order) => order.machineId === machine.id && isOpenOrder(order.status) && order.origin === "Ordem")
  .sort((a, b) => (a.status === "Em execucao" ? -1 : 0) - (b.status === "Em execucao" ? -1 : 0))[0]

const sectorName = (data: Overview, id: string) => data.sectors.find((sector) => sector.id === id)?.name || "Sem setor"

export function MachineCard({ data, machine, now, onReport, canReport }: { data: Overview; machine: Row; now: number; onReport: (machine: Row) => void; canReport: boolean }) {
  const status = machine.operationalStatus as MachineStatus
  const meta = statusMeta[status]
  const next = nextMaintenance(data, machine)
  const order = status === "Em manutencao" ? machineOpenOrder(data, machine) : undefined
  const inactive = machine.adminStatus !== "Ativo"
  const elapsed = formatDuration(now - new Date(machine.statusSince).getTime())
  return (
    <article className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md", inactive && "opacity-70")} style={{ borderColor: `${meta.color}55` }}>
      <MachineArt illustration={machine.illustrationKey} photoUrl={fileUrl(machine.photoPath)} status={inactive ? "Nao informado" : status} alt={machine.name} compact />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold leading-tight" title={machine.name}>{machine.name}</h3>
          {machine.safetyLocked ? <span title={`Bloqueada por segurança: ${machine.safetyLockReason}`} className="shrink-0 text-red-600"><ShieldAlert className="h-4 w-4" aria-label="Bloqueada por segurança" /></span> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground"><span className="font-mono">{machine.code}</span> · {sectorName(data, machine.sectorId)}</p>
        {inactive ? <p className="mt-1 text-xs font-semibold text-slate-600">{machine.adminStatus}</p> : <div className="mt-2"><StatusPill status={status} pulse /></div>}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="col-span-2 flex items-center gap-1 text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden />
          {status === "Nao informado" ? "Status ainda não informado" : <span>{meta.short} há <b className="text-foreground">{elapsed}</b></span>}
        </div>
        {status === "Parada" ? <div className="col-span-2 rounded-md bg-red-50 px-2 py-1 text-red-800">Motivo: {machine.statusReason || "não informado"} · desde {day(machine.statusSince)}</div> : null}
        {order ? <div className="col-span-2 rounded-md bg-amber-50 px-2 py-1 text-amber-900">Ordem {order.orderNumber} · {order.description}</div> : null}
        {status === "Em operacao" && machine.responsibleName ? <div className="col-span-2 text-muted-foreground">Responsável: <b className="text-foreground">{machine.responsibleName}</b></div> : null}
        <div><dt className="text-muted-foreground">Última manutenção</dt><dd className="font-medium">{day(machine.lastMaintenanceAt)}</dd></div>
        <div>
          <dt className="text-muted-foreground">Próxima</dt>
          <dd className={cn("flex items-center gap-1 font-medium", next.state === "Vencida" && "text-red-600", next.state === "Proxima" && "text-amber-600")}>
            {next.state === "Vencida" ? <AlertTriangle className="h-3 w-3" aria-label="Vencida" /> : null}
            {next.date ? day(next.date) : next.hours != null ? hours(next.hours) : "—"}
          </dd>
        </div>
        {machine.usesHourMeter ? <div className="col-span-2 flex items-center gap-1 text-muted-foreground"><Gauge className="h-3.5 w-3.5" aria-hidden />Horímetro: <b className="text-foreground">{hours(machine.hourMeter)}</b></div> : null}
      </dl>
      <div className="mt-auto flex gap-2">
        <Button asChild size="sm" className="flex-1"><Link href={`/maquinas/${machine.id}`} prefetch={false}>Ver máquina</Link></Button>
        {canReport && !inactive ? <Button size="sm" variant="outline" onClick={() => onReport(machine)} title="Registrar ocorrência"><MessageSquareWarning className="h-4 w-4" /><span className="sr-only">Registrar ocorrência</span></Button> : null}
      </div>
    </article>
  )
}

/** Mapa de Máquinas: grade organizada por setor (a estrutura já aceita `map_layout` por setor para a futura planta). */
export function SectorMap({ data, machines, now, onReport, canReport }: { data: Overview; machines: Row[]; now: number; onReport: (machine: Row) => void; canReport: boolean }) {
  const groups = new Map<string, Row[]>()
  for (const machine of machines) groups.set(machine.sectorId || "", [...(groups.get(machine.sectorId || "") || []), machine])
  const ordered = [...data.sectors.filter((sector) => sector.active !== false).map((sector) => ({ id: sector.id as string, name: sector.name as string })), { id: "", name: "Sem setor" }].filter((group) => groups.has(group.id))
  if (!ordered.length) return null
  return (
    <div className="space-y-6">
      {ordered.map((group) => {
        const list = groups.get(group.id)!
        const counts = (status: MachineStatus) => list.filter((machine) => machine.operationalStatus === status && machine.adminStatus === "Ativo").length
        return (
          <section key={group.id || "none"} aria-label={`Setor ${group.name}`} className="rounded-2xl border bg-slate-50/60 p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{group.name} <span className="font-normal text-muted-foreground">· {list.length} máquina(s)</span></h3>
              <div className="flex gap-2 text-xs">
                {(["Em operacao", "Em manutencao", "Parada"] as MachineStatus[]).map((status) => (
                  <span key={status} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold" style={{ background: statusMeta[status].soft, color: statusMeta[status].text }}>{counts(status)} {statusMeta[status].short.toLowerCase()}</span>
                ))}
              </div>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((machine) => <MachineCard key={machine.id} data={data} machine={machine} now={now} onReport={onReport} canReport={canReport} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
