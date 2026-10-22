"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Download, FileText, Gauge, History, Loader2, MessageSquareWarning, Pencil, Printer, QrCode, RefreshCw, ShieldAlert, Wrench } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageShell, SectionCard, SelectField, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { PageLayout } from "@/components/page-layout"
import { bookValueCurve, depreciation, dueState, effectiveDate, formatDuration, isHighMaintenanceCost, orderCost, orderLabel, statusMeta, sumMoney, documentTypes, type MachineStatus } from "@/lib/machines"
import { MachineArt, StatusPill } from "@/components/machines/machine-art"
import { brl, dateTime, day, fileUrl, hours, mApi, uploadMachineFile, useNow, type Caps, type Overview, type Row } from "@/components/machines/machine-data"
import { CompleteDialog, MeterDialog, OrderSheet, PlanSheet, ReportDialog, StatusDialog } from "@/components/machines/machine-dialogs"
import { MachineTabs } from "@/components/machines/machines-pages"
import { MachineFormSheet } from "@/components/machines/machine-form"
import { OrderActions, OrderBadge } from "@/components/machines/order-actions"
import { downloadLabel, printLabel } from "@/components/machines/label"

type Detail = { machine: Row; history: Row[]; readings: Row[]; orders: Row[]; documents: Row[]; plans: Row[]; locations: Row[]; qr: Row[]; settings: { dueSoonDays: number; highCostPercent: number }; caps: Caps; serverTime: string; today: string }
const none = "nenhum"

function useDetail(id: string) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    try { setDetail(await mApi<Detail>("detail", { query: { id } })); setError("") } catch (caught) { setError(caught instanceof Error ? caught.message : "Erro ao carregar.") }
  }, [id])
  useEffect(() => {
    void reload()
    const tick = () => { if (document.visibilityState === "visible") void reload() }
    const timer = window.setInterval(tick, 30000)
    document.addEventListener("visibilitychange", tick)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick) }
  }, [reload])
  // listas de apoio (setores, categorias, unidades) para o formulário de edição
  useEffect(() => { mApi<Overview>("data").then(setOverview).catch(() => undefined) }, [])
  return { detail, overview, error, reload }
}

/** `mobile`: ficha simplificada aberta pelo QR Code (sem dados patrimoniais, documentos nem planos). */
export function MachineDetail({ machineId, mobile = false }: { machineId: string; mobile?: boolean }) {
  const { detail, overview, error, reload } = useDetail(machineId)
  const now = useNow()
  const { toast } = useCrudFeedback()
  const [dialog, setDialog] = useState<"" | "status" | "report" | "meter" | "order" | "historic" | "edit" | "qr" | "admin" | "plan">("")
  const [statusPreset, setStatusPreset] = useState<MachineStatus | undefined>()
  const [completing, setCompleting] = useState<Row | null>(null)
  const [plan, setPlan] = useState<Row | null>(null)
  const [occurrence, setOccurrence] = useState<Row | null>(null)

  const body = (() => {
    if (error && !detail) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
    if (!detail) return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando a ficha…</div>
    const { machine, caps } = detail
    const status = machine.operationalStatus as MachineStatus
    const meta = statusMeta[status]
    const orders = detail.orders
    const open = orders.filter((order) => ["Aberta", "Aguardando aprovacao", "Em execucao", "Aguardando pecas", "Suspensa"].includes(order.status))
    const occurrences = open.filter((order) => order.origin === "Ocorrencia")
    const done = orders.filter((order) => order.status === "Concluida" && order.origin !== "Ocorrencia").sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))
    const nextPlan = detail.plans.filter((item) => item.active && (item.nextDueDate || item.nextDueHours != null)).sort((a, b) => String(a.nextDueDate || "9999").localeCompare(String(b.nextDueDate || "9999")))[0]
    const planState = nextPlan ? dueState({ dueDate: nextPlan.nextDueDate || null, dueHours: nextPlan.nextDueHours }, detail.today, machine.hourMeter, { soonDays: detail.settings.dueSoonDays, combineRule: nextPlan.combineRule }) : "Sem prazo"
    const inactive = machine.adminStatus !== "Ativo"
    const acquisitionTotal = sumMoney(machine.acquisitionValue, machine.freightCost, machine.installationCost, machine.otherCosts)
    const dep = caps.patrimony ? depreciation({ acquisitionValue: machine.acquisitionValue, freightCost: machine.freightCost, installationCost: machine.installationCost, otherCosts: machine.otherCosts, residualValue: machine.residualValue, usefulLifeMonths: Number(machine.usefulLifeMonths) || 0, startDate: machine.depreciationStartDate || machine.acquisitionDate, method: machine.depreciationMethod, adjustments: machine.depreciationAdjustments, asOf: detail.today }) : null
    const high = caps.patrimony && isHighMaintenanceCost(machine.totalMaintenanceCost || 0, acquisitionTotal, detail.settings.highCostPercent)
    const sectorLabel = overview?.sectors.find((sector) => sector.id === machine.sectorId)?.name || "Sem setor"
    const refresh = () => { void reload() }

    const actions = (
      <div className="flex flex-wrap gap-2">
        {caps.maintain && !inactive ? <Button onClick={() => { setStatusPreset(undefined); setDialog("status") }}><Wrench className="h-4 w-4" />Alterar status</Button> : null}
        {!inactive ? <Button variant={caps.maintain ? "outline" : "default"} onClick={() => setDialog("report")}><MessageSquareWarning className="h-4 w-4" />Reportar problema</Button> : null}
        {caps.maintain ? <Button variant="outline" onClick={() => { setOccurrence(null); setDialog("order") }}><Wrench className="h-4 w-4" />Registrar manutenção</Button> : null}
        {caps.maintain && !mobile ? <Button variant="outline" onClick={() => setDialog("historic")}><History className="h-4 w-4" />Registrar manutenção anterior</Button> : null}
        {caps.maintain && machine.usesHourMeter ? <Button variant="outline" onClick={() => setDialog("meter")}><Gauge className="h-4 w-4" />Atualizar horímetro</Button> : null}
        {!mobile && (caps.maintain || caps.patrimony) ? <Button variant="outline" onClick={() => setDialog("edit")}><Pencil className="h-4 w-4" />Editar cadastro</Button> : null}
        {caps.maintain && !mobile ? <Button variant="outline" onClick={() => setDialog("qr")}><QrCode className="h-4 w-4" />Etiqueta QR Code</Button> : null}
        {caps.maintain && !mobile ? <Button variant="ghost" onClick={() => setDialog("admin")}>{machine.adminStatus === "Ativo" ? "Inativar / baixar" : "Estado administrativo"}</Button> : null}
      </div>
    )

    const ordersTable = (list: Row[], limit?: number) => (
      list.length ? (
        <ul className="divide-y rounded-xl border">
          {list.slice(0, limit).map((order) => (
            <li key={order.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{order.orderNumber || (order.origin === "Historico" ? "Manutenção anterior" : "Ocorrência")}</b>
                <OrderBadge value={order.status} /><span className="text-xs text-muted-foreground">{orderLabel(order.maintenanceType)}</span>
                <span className="ml-auto text-xs text-muted-foreground">Executada em {day(effectiveDate(order) || null)} · lançada em {day(order.createdAt)}</span>
              </div>
              <p>{order.description}</p>
              {order.solution ? <p className="text-xs text-muted-foreground">Solução: {order.solution}</p> : null}
              {!mobile && (caps.maintain || caps.patrimony) && order.status === "Concluida" ? <p className="text-xs text-muted-foreground">Custo {brl(orderCost(order))} · parada {hours(order.downtimeHours)}{order.technician || order.externalCompany ? ` · ${[order.technician, order.externalCompany].filter(Boolean).join(" / ")}` : ""}</p> : null}
              {!mobile && order.parts?.length ? <p className="text-xs text-muted-foreground">Peças: {order.parts.map((part: Row) => `${part.quantity}× ${part.description}`).join(", ")}</p> : null}
              {open.includes(order) && order.origin === "Ocorrencia" && caps.maintain ? <Button size="sm" variant="outline" onClick={() => { setOccurrence(order); setDialog("order") }}>Abrir ordem</Button> : null}
              <OrderActions order={order} caps={caps} onChanged={refresh} onComplete={setCompleting} />
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum registro.</p>
    )

    const header = (
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <MachineArt illustration={machine.illustrationKey} photoUrl={fileUrl(machine.photoPath)} status={inactive ? "Nao informado" : status} alt={machine.name} />
          {inactive ? <p className="rounded-lg bg-slate-100 p-2 text-center text-sm font-semibold text-slate-700">{machine.adminStatus}{machine.retiredAt ? ` em ${day(machine.retiredAt)}` : ""}</p> : null}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3"><StatusPill status={status} pulse className="text-sm" />
            {status !== "Nao informado" ? <span className="text-sm text-muted-foreground">há {formatDuration(now - new Date(machine.statusSince).getTime())} (desde {dateTime(machine.statusSince)})</span> : <span className="text-sm text-muted-foreground">Ninguém informou o status ainda.</span>}</div>
          {status === "Parada" || status === "Em manutencao" ? <p className="text-sm" style={{ color: meta.text }}>Motivo: {machine.statusReason || "não informado"}</p> : null}
          {machine.safetyLocked ? <p className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800"><ShieldAlert className="h-4 w-4" />Bloqueada por segurança: {machine.safetyLockReason}. Só volta a operar com liberação autorizada.</p> : null}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Setor / local</dt><dd className="font-medium">{sectorLabel}{machine.locationDetail ? ` · ${machine.locationDetail}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Responsável</dt><dd className="font-medium">{machine.responsibleName || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Última manutenção</dt><dd className="font-medium">{day(machine.lastMaintenanceAt)}</dd></div>
            <div><dt className="text-muted-foreground">Próxima manutenção</dt><dd className={planState === "Vencida" ? "font-semibold text-red-600" : planState === "Proxima" ? "font-semibold text-amber-600" : "font-medium"}>{nextPlan ? `${nextPlan.name} · ${nextPlan.nextDueDate ? day(nextPlan.nextDueDate) : hours(nextPlan.nextDueHours)}${planState === "Vencida" ? " (vencida)" : ""}` : "Sem plano"}</dd></div>
            {machine.usesHourMeter ? <div><dt className="text-muted-foreground">Horímetro</dt><dd className="font-medium">{hours(machine.hourMeter)}</dd></div> : null}
            <div><dt className="text-muted-foreground">Ordens abertas</dt><dd className="font-medium">{open.filter((order) => order.origin === "Ordem").length} · ocorrências: {occurrences.length}</dd></div>
          </dl>
          {actions}
        </div>
      </div>
    )

    const timeline = (
      <ol className="space-y-2">
        {detail.history.slice(0, mobile ? 5 : 100).map((row) => (
          <li key={row.id} className="flex gap-3 rounded-lg border p-3 text-sm">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: statusMeta[row.toStatus as MachineStatus]?.color }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p><b>{statusMeta[row.toStatus as MachineStatus]?.label}</b> <span className="text-muted-foreground">{row.fromStatus ? `(antes: ${statusMeta[row.fromStatus as MachineStatus]?.short})` : ""}</span>{row.safetyLock ? <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-800">bloqueio de segurança</span> : null}{row.safetyRelease ? <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-900">liberação autorizada</span> : null}</p>
              <p className="text-xs text-muted-foreground">{dateTime(row.startedAt)} · {row.endedAt ? `durou ${formatDuration(new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime())}` : "status atual"} · por {row.changedBy || row.responsible || "—"}</p>
              <p className="text-xs">{row.reason}{row.notes ? ` — ${row.notes}` : ""}</p>
            </div>
          </li>
        ))}
        {!detail.history.length ? <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma alteração de status registrada.</p> : null}
      </ol>
    )

    const mainTabs = mobile ? (
      <div className="space-y-5">
        <SectionCard title="Ocorrências e ordens em aberto">{ordersTable(open, 5)}</SectionCard>
        <SectionCard title="Últimas manutenções">{ordersTable(done, 5)}</SectionCard>
        <SectionCard title="Últimas mudanças de status">{timeline}</SectionCard>
      </div>
    ) : (
      <Tabs defaultValue="resumo">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="resumo">Dados e planos</TabsTrigger>
          <TabsTrigger value="manutencao">Manutenções ({orders.length})</TabsTrigger>
          <TabsTrigger value="status">Histórico de status</TabsTrigger>
          {caps.patrimony ? <TabsTrigger value="patrimonio">Custos e patrimônio</TabsTrigger> : null}
          <TabsTrigger value="docs">Documentos ({detail.documents.length})</TabsTrigger>
          {machine.usesHourMeter ? <TabsTrigger value="horimetro">Horímetro</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="resumo" className="space-y-5">
          <SectionCard title="Dados técnicos">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[["Categoria", overview?.categories.find((item) => item.id === machine.categoryId)?.name], ["Tipo", machine.equipmentType], ["Fabricante", machine.manufacturer], ["Marca", machine.brand], ["Modelo", machine.model], ["Número de série", machine.serialNumber], ["Ano de fabricação", machine.manufactureYear], ["Cadastro em", day(machine.createdAt)], ["Descrição", machine.description]].map(([label, value]) => <div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>)}
            </dl>
          </SectionCard>
          <SectionCard title="Planos de manutenção preventiva" description="O próximo vencimento é recalculado quando a ordem do plano é concluída.">
            <div className="space-y-2">
              {detail.plans.filter((item) => item.active).map((item) => {
                const state = dueState({ dueDate: item.nextDueDate || null, dueHours: item.nextDueHours }, detail.today, machine.hourMeter, { soonDays: detail.settings.dueSoonDays, combineRule: item.combineRule })
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                    <b>{item.name}</b><span className="text-muted-foreground">{[item.intervalDays && `${item.intervalDays} dias`, item.intervalMonths && `${item.intervalMonths} meses`, item.intervalHours && `${item.intervalHours} h`, item.fixedDate && `em ${day(item.fixedDate)}`].filter(Boolean).join(" · ")}</span>
                    <span className={state === "Vencida" ? "font-semibold text-red-600" : state === "Proxima" ? "font-semibold text-amber-600" : "text-muted-foreground"}>{state === "Vencida" ? "Vencida" : state === "Proxima" ? "Próxima" : "Em dia"} · {item.nextDueDate ? day(item.nextDueDate) : item.nextDueHours != null ? hours(item.nextDueHours) : "sem prazo"}</span>
                    {caps.maintain ? <span className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => { setPlan(item); setDialog("plan") }}>Editar</Button><Button size="sm" onClick={async () => { try { await mApi("plan-order", { body: { item: { planId: item.id } } }); toast({ title: "Ordem aberta a partir do plano" }); refresh() } catch (caught) { toast({ title: "Não foi possível abrir a ordem", description: caught instanceof Error ? caught.message : "", variant: "destructive" }) } }}>Abrir ordem</Button></span> : null}
                  </div>
                )
              })}
              {!detail.plans.some((item) => item.active) ? <p className="text-sm text-muted-foreground">Nenhum plano ativo.</p> : null}
              {caps.maintain ? <Button variant="outline" size="sm" onClick={() => { setPlan(null); setDialog("plan") }}>Novo plano</Button> : null}
            </div>
          </SectionCard>
        </TabsContent>
        <TabsContent value="manutencao" className="space-y-3">
          <h3 className="text-sm font-semibold">Em aberto</h3>{ordersTable(open)}
          <h3 className="pt-2 text-sm font-semibold">Concluídas (pela data efetiva da execução)</h3>{ordersTable(done)}
        </TabsContent>
        <TabsContent value="status">{timeline}</TabsContent>
        {caps.patrimony && dep ? (
          <TabsContent value="patrimonio" className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[["Custo de aquisição", brl(acquisitionTotal)], ["Depreciação acumulada", brl(dep.accumulated)], ["Valor contábil líquido", brl(dep.bookValue)], ["Manutenção acumulada", brl(machine.totalMaintenanceCost)]].map(([label, value]) => <div key={label} className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></div>)}
            </div>
            {high ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Atenção: o custo de manutenção já passa de {detail.settings.highCostPercent}% do custo de aquisição. Avalie reparo × reposição{machine.replacementValue ? ` (reposição estimada ${brl(machine.replacementValue)})` : ""}.</p> : null}
            <p className="text-xs text-muted-foreground">Valor contábil (depreciação {machine.depreciationMethod === "Linear" ? "linear" : "desligada"}) não é valor de mercado. Mercado estimado: {machine.marketValue != null ? `${brl(machine.marketValue)} em ${day(machine.marketValueDate)}` : "não informado"}. Fornecedor: {machine.supplierName || "—"} · NF {machine.invoiceNumber || "—"}.</p>
            {dep.applicable ? (
              <div className="h-64 rounded-xl border p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bookValueCurve({ acquisitionValue: machine.acquisitionValue, freightCost: machine.freightCost, installationCost: machine.installationCost, otherCosts: machine.otherCosts, residualValue: machine.residualValue, usefulLifeMonths: Number(machine.usefulLifeMonths), startDate: machine.depreciationStartDate || machine.acquisitionDate, method: machine.depreciationMethod, adjustments: machine.depreciationAdjustments }, detail.today).map((point) => ({ ...point, label: day(point.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                    <Tooltip formatter={(value) => brl(Number(value))} /><Line type="monotone" dataKey="bookValue" name="Valor contábil" stroke="#1e3a8a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-sm text-muted-foreground">Informe valor, vida útil e início da depreciação no cadastro para ver a evolução do valor contábil.</p>}
          </TabsContent>
        ) : null}
        <TabsContent value="docs"><DocumentsPanel machineId={machine.id} documents={detail.documents} caps={caps} onChanged={refresh} /></TabsContent>
        {machine.usesHourMeter ? (
          <TabsContent value="horimetro">
            <ul className="divide-y rounded-xl border text-sm">{detail.readings.map((row) => <li key={row.id} className="flex flex-wrap gap-x-4 p-3"><b>{hours(row.reading)}</b><span className="text-muted-foreground">{dateTime(row.readAt)} · {row.readBy}</span>{row.isCorrection ? <span className="text-amber-700">correção: {row.note}</span> : null}</li>)}{!detail.readings.length ? <li className="p-4 text-center text-muted-foreground">Nenhuma leitura registrada.</li> : null}</ul>
          </TabsContent>
        ) : null}
      </Tabs>
    )

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          {!mobile ? <Button asChild variant="ghost" size="sm"><Link href="/maquinas/todas" prefetch={false}><ArrowLeft className="h-4 w-4" />Todas as máquinas</Link></Button> : null}
          <h2 className="text-xl font-semibold tracking-tight">{machine.name}</h2><span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm">{machine.code}</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={refresh} aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></Button>
        </div>
        {header}
        {mainTabs}
        <StatusDialog machine={machine} orders={orders} open={dialog === "status"} preset={statusPreset} onClose={() => setDialog("")} onSaved={refresh} />
        <ReportDialog machine={machine} open={dialog === "report"} onClose={() => setDialog("")} onSaved={refresh} />
        <MeterDialog machine={machine} open={dialog === "meter"} onClose={() => setDialog("")} onSaved={refresh} />
        <OrderSheet open={dialog === "order" || dialog === "historic"} kind={dialog === "historic" ? "Historico" : "Ordem"} machines={[machine]} machineId={machine.id} caps={caps} fromOccurrence={dialog === "order" ? occurrence : null} onClose={() => { setDialog(""); setOccurrence(null) }} onSaved={refresh} />
        <CompleteDialog order={completing} open={Boolean(completing)} onClose={() => setCompleting(null)} onDone={(release) => { refresh(); if (release) { toast({ title: "Ordem concluída", description: "A máquina continua em manutenção até alguém confirmar a liberação." }); setStatusPreset("Em operacao"); setDialog("status") } }} />
        <PlanSheet open={dialog === "plan"} plan={plan} machineId={machine.id} machines={[machine]} onClose={() => setDialog("")} onSaved={refresh} />
        {overview ? <MachineFormSheet open={dialog === "edit"} machine={machine} data={overview} onClose={() => setDialog("")} onSaved={refresh} /> : null}
        <QrDialog machine={machine} open={dialog === "qr"} onClose={() => setDialog("")} onChanged={refresh} history={detail.qr} />
        <AdminStatusDialog machine={machine} open={dialog === "admin"} onClose={() => setDialog("")} onSaved={refresh} />
      </div>
    )
  })()

  return mobile ? <PageLayout><div className="mx-auto w-full max-w-3xl">{body}</div></PageLayout> : <PageShell title="Ficha da máquina" description="Dados, status operacional, manutenção, custos e documentos."><MachineTabs />{body}</PageShell>
}

// ===== Documentos =====
function DocumentsPanel({ machineId, documents, caps, onChanged }: { machineId: string; documents: Row[]; caps: Caps; onChanged: () => void }) {
  const { toast } = useCrudFeedback()
  const [type, setType] = useState("Manual")
  const [description, setDescription] = useState("")
  const [restricted, setRestricted] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const can = caps.maintain || caps.patrimony
  const send = async () => {
    if (!file) return toast({ title: "Selecione um arquivo", variant: "destructive" })
    setBusy(true)
    try {
      const uploaded = await uploadMachineFile(file, machineId)
      await mApi("document", { body: { item: { machineId, docType: type, description, restricted, filePath: uploaded.path, fileName: uploaded.name } } })
      setFile(null); setDescription(""); toast({ title: "Documento anexado" }); onChanged()
    } catch (caught) { toast({ title: "Erro ao anexar", description: caught instanceof Error ? caught.message : "", variant: "destructive" }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-xl border text-sm">
        {documents.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center gap-2 p-3">
            <FileText className="h-4 w-4 text-muted-foreground" /><b>{doc.docType}</b><span className="text-muted-foreground">{doc.description || doc.fileName}</span>{doc.restricted ? <span className="rounded bg-slate-100 px-1.5 text-xs">restrito</span> : null}
            <a className="ml-auto text-primary underline" href={fileUrl(doc.filePath)} target="_blank" rel="noreferrer">Abrir</a>
            {can ? <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { await mApi("document", { method: "DELETE", query: { id: doc.id } }); onChanged() }}>Excluir</Button> : null}
          </li>
        ))}
        {!documents.length ? <li className="p-4 text-center text-muted-foreground">Nenhum documento.</li> : null}
      </ul>
      {can ? (
        <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <SelectField label="Tipo" value={type} onChange={setType} options={documentTypes.map((value) => ({ value, label: value }))} />
          <TextField label="Descrição" value={description} onChange={setDescription} />
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} className="text-sm sm:col-span-2" />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={restricted} onCheckedChange={(value) => setRestricted(value === true)} />Restrito (só quem vê dados patrimoniais)</label>
          <div className="sm:text-right"><Button onClick={send} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Anexar</Button></div>
        </div>
      ) : null}
    </div>
  )
}

// ===== Etiqueta / QR Code =====
function QrDialog({ machine, open, onClose, onChanged, history }: { machine: Row; open: boolean; onClose: () => void; onChanged: () => void; history: Row[] }) {
  const { toast } = useCrudFeedback()
  const [info, setInfo] = useState<{ code: string; name: string; url: string; printCount: number } | null>(null)
  const [img, setImg] = useState("")
  const [error, setError] = useState("")
  const [reason, setReason] = useState("")
  const [confirm, setConfirm] = useState(false)
  const load = useCallback(async () => {
    setError("")
    try { const result = await mApi<{ code: string; name: string; url: string; printCount: number }>("qr", { query: { id: machine.id } }); setInfo(result); setImg(await QRCode.toDataURL(result.url, { margin: 1, width: 260 })) } catch (caught) { setError(caught instanceof Error ? caught.message : "Erro.") }
  }, [machine.id])
  useEffect(() => { if (open) { setConfirm(false); setReason(""); void load() } }, [open, load])
  const emit = async (mode: "print" | "pdf") => {
    if (!info) return
    try { await (mode === "print" ? printLabel(info) : downloadLabel(info)); await mApi("qr-printed", { body: { item: { machineId: machine.id } } }); await load() } catch (caught) { toast({ title: "Erro ao gerar a etiqueta", description: caught instanceof Error ? caught.message : "", variant: "destructive" }) }
  }
  const reissue = async () => {
    try { await mApi("qr-reissue", { body: { item: { machineId: machine.id, reason } } }); toast({ title: "QR Code reemitido", description: "A etiqueta antiga deixou de funcionar. Imprima a nova." }); setConfirm(false); setReason(""); await load(); onChanged() } catch (caught) { setError(caught instanceof Error ? caught.message : "Erro.") }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Etiqueta de {machine.code}</DialogTitle><DialogDescription>Segunda via usa o mesmo código e o mesmo QR Code. O QR abre a ficha da máquina (exige login).</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {info ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={img} alt={`QR Code de ${machine.code}`} className="h-44 w-44" /> : null}
            <p className="break-all text-center text-xs text-muted-foreground">{info.url}</p>
            <p className="text-xs text-muted-foreground">Impressões: {info.printCount} · QRs anteriores revogados: {history.filter((row) => !row.active).length}</p>
            <div className="flex gap-2"><Button onClick={() => emit("print")}><Printer className="h-4 w-4" />Imprimir etiqueta</Button><Button variant="outline" onClick={() => emit("pdf")}><Download className="h-4 w-4" />Baixar PDF</Button></div>
          </div>
        ) : !error ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}
        <div className="space-y-2 border-t pt-3">
          {!confirm ? <Button variant="ghost" className="text-red-600" onClick={() => setConfirm(true)}>Revogar e reemitir QR Code</Button> : (
            <>
              <TextAreaField label="Motivo da revogação (etiqueta perdida, exposta, etc.)" value={reason} onChange={setReason} rows={2} />
              <div className="flex gap-2"><Button variant="destructive" disabled={!reason.trim()} onClick={reissue}>Confirmar revogação</Button><Button variant="outline" onClick={() => setConfirm(false)}>Voltar</Button></div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===== Estado administrativo =====
function AdminStatusDialog({ machine, open, onClose, onSaved }: { machine: Row; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCrudFeedback()
  const [status, setStatus] = useState("Inativo")
  const [reason, setReason] = useState("")
  const [date, setDate] = useState("")
  const [error, setError] = useState("")
  useEffect(() => { if (open) { setStatus(machine.adminStatus === "Ativo" ? "Inativo" : "Ativo"); setReason(""); setDate(new Date().toISOString().slice(0, 10)); setError("") } }, [open, machine.adminStatus])
  const submit = async () => {
    try { await mApi("admin-status", { body: { item: { id: machine.id, adminStatus: status, reason, retiredAt: date } } }); toast({ title: `Máquina ${status.toLowerCase()}` }); onSaved(); onClose() } catch (caught) { setError(caught instanceof Error ? caught.message : "Erro.") }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Estado administrativo</DialogTitle><DialogDescription>Separado do status operacional. O código patrimonial de máquina baixada nunca é reutilizado e a baixa não pode ser desfeita.</DialogDescription></DialogHeader>
        <SelectField label="Novo estado" value={status} onChange={setStatus} options={[{ value: "Ativo", label: "Ativo" }, { value: "Inativo", label: "Inativo" }, { value: "Baixado", label: "Baixado (definitivo)" }].filter((item) => item.value !== machine.adminStatus)} />
        {status === "Baixado" ? <><TextField label="Data da baixa" type="date" value={date} onChange={setDate} /><TextAreaField label="Motivo da baixa" value={reason} onChange={setReason} rows={2} /></> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button variant={status === "Baixado" ? "destructive" : "default"} onClick={submit}>Confirmar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
