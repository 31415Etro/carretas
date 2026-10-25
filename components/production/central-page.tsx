"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, ShoppingCart, Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { ProductionPage } from "@/components/production/production-page"
import { ShopBoardPage, UnitDialog, statusLabel, statusTone } from "@/components/shop-floor/shop-board-page"
import { TrailerDrawingView } from "@/components/configurator/trailer-drawing-view"
import { useAuth } from "@/lib/auth-context"
import { EmbeddedPageContext } from "@/lib/embedded-page"

type Row = Record<string, any>
type Area = "ordem" | "esteira" | "tarefas"
const areas: Area[] = ["ordem", "esteira", "tarefas"]
const qty = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
const dateBr = (value?: string | null) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const stamp = (value?: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
const minutes = (value: number) => (value >= 60 ? `${Math.floor(value / 60)}h${String(value % 60).padStart(2, "0")}` : `${value} min`)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}
const manage = (body: Record<string, unknown>) => api<Row>("/api/chao-de-fabrica/gestor", { method: "POST", body: JSON.stringify(body) })

/** Central de Produção: uma página só (lista de carretas + ORDEM E MATERIAIS, ESTEIRA e TAREFAS da carreta escolhida), tudo dos mesmos registros. */
export function CentralProductionPage() {
  const { user } = useAuth()
  const canTablet = !user || user.role === "admin" || (user.permissions as readonly string[] | undefined)?.includes("chao_fabrica")
  const [overview, setOverview] = useState<Row | null>(null)
  const [orders, setOrders] = useState<Map<string, Row>>(new Map())
  const [pendencies, setPendencies] = useState<Row | null>(null)
  const [shortages, setShortages] = useState(0)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("todas")
  const [selected, setSelected] = useState<{ orderId: string; unit: number } | null>(null)
  const [area, setArea] = useState<Area>("ordem")
  const [tick, setTick] = useState(0)
  const [notice, setNotice] = useState("")
  const [planning, setPlanning] = useState(false)
  const restored = useRef(false)

  const load = useCallback(async () => {
    try {
      const [board, list, pend, mrp] = await Promise.all([
        api<Row>("/api/chao-de-fabrica/gestor"),
        api<{ items: Row[] }>("/api/producao?tamanho=200").catch(() => ({ items: [] })),
        api<{ pendencies: Row }>("/api/producao/pendencias").catch(() => null),
        api<{ items?: Row[]; rows?: Row[] }>("/api/producao/mrp").catch(() => null),
      ])
      setOverview(board)
      setOrders(new Map((list.items || []).map((row) => [String(row.id), row])))
      setPendencies(pend?.pendencies || null)
      const rows = mrp?.items || mrp?.rows || []
      setShortages(rows.filter((row) => Number(row.shortage_now ?? row.shortageNow ?? 0) > 0).length)
      setError("")
      setTick((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a Central de Produção.") }
  }, [])
  // atualização contínua: a Central, a esteira e as tarefas leem os mesmos registros e se renovam sozinhas
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer) }, [load])

  const units: Row[] = useMemo(() => (overview?.board?.units as Row[]) || [], [overview])
  // volta para a carreta/área da URL ao atualizar a página
  useEffect(() => {
    if (!overview || restored.current) return
    restored.current = true
    const params = new URLSearchParams(window.location.search)
    const wantedArea = params.get("area") as Area | null
    if (wantedArea && areas.includes(wantedArea)) setArea(wantedArea)
    const order = params.get("ordem"), unit = Number(params.get("unidade") || 1)
    if (order && units.some((item) => item.order_id === order && item.unit_number === unit)) setSelected({ orderId: order, unit })
    else if (units.length) setSelected({ orderId: units[0].order_id, unit: units[0].unit_number })
  }, [overview, units])
  function choose(next: { orderId: string; unit: number } | null, nextArea: Area = area) {
    setSelected(next); setArea(nextArea)
    const url = new URL(window.location.href)
    if (next) { url.searchParams.set("ordem", next.orderId); url.searchParams.set("unidade", String(next.unit)) }
    url.searchParams.set("area", nextArea)
    window.history.replaceState(null, "", url.toString())
  }

  const shown = units.filter((unit) => {
    const order = orders.get(String(unit.order_id)) || {}
    const text = [unit.order_code, unit.product, unit.model, unit.vin, order.order_number, order.client_name].join(" ").toLowerCase()
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false
    if (filter === "andamento") return !unit.finished
    if (filter === "paradas") return ["Pausada", "Bloqueada", "Com pendencia"].includes(unit.current_status)
    if (filter === "atrasadas") return Boolean(unit.late)
    if (filter === "prontas") return Boolean(unit.finished)
    return true
  })
  const current = selected ? units.find((unit) => unit.order_id === selected.orderId && unit.unit_number === selected.unit) || null : null
  const board = overview?.board
  const pendencyCount = pendencies ? (pendencies.orders_without_composition?.length || 0) + (pendencies.items_without_structure?.length || 0) : 0

  async function act(body: Record<string, unknown>, success: string) {
    setNotice("")
    try { await manage(body); setNotice(success); await load() } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Ação não concluída.") }
  }

  return (
    <PageShell title="Central de Produção" description="Do pedido à carreta pronta, tudo em uma página: ordem e materiais, esteira e tarefas, com os mesmos dados."
      actions={<>
        <Button variant="outline" onClick={() => setPlanning(true)}><ShoppingCart className="h-4 w-4" />Planejamento geral de materiais</Button>
        {canTablet ? <Button variant="outline" asChild><a href="/producao/tablet" target="_blank" rel="noreferrer"><Tablet className="h-4 w-4" />Modo Tablet<ExternalLink className="h-3 w-3" /></a></Button> : null}
        <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Atualizar</Button>
      </>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm" role="status">{notice}</p> : null}
      {!overview && !error ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</p> : null}

      {board ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Carretas em produção" value={units.filter((unit) => !unit.finished).length} note={`${units.filter((unit) => unit.finished).length} pronta(s)`} icon={CheckCircle2} />
          <MetricCard title="Atrasadas" value={board.late_count} note="acima do prazo da etapa" icon={AlertTriangle} />
          <MetricCard title="Paradas" value={board.stopped.length} note="pausadas ou com pendência" icon={AlertTriangle} />
          <MetricCard title="Materiais faltantes" value={shortages} note="no planejamento das ordens abertas" icon={ShoppingCart} />
        </div>
      ) : null}

      {pendencyCount > 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>{pendencyCount} pendência(s) de vínculo:</b> {pendencies?.orders_without_composition?.length ? `${pendencies.orders_without_composition.length} ordem(ns) sem kits/matérias-primas (abra a carreta para reconciliar)` : ""}{pendencies?.orders_without_composition?.length && pendencies?.items_without_structure?.length ? "; " : ""}{pendencies?.items_without_structure?.length ? `${pendencies.items_without_structure.length} item(ns) vendido(s) sem estrutura de fabricação (${[...new Set((pendencies.items_without_structure as Row[]).map((row) => row.product))].join(", ")}): vincule os kits em Estoque > Produtos finais` : ""}.</span></p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Pedido, produto, chassi ou cliente" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[["todas", "Todas"], ["andamento", "Em andamento"], ["paradas", "Paradas"], ["atrasadas", "Atrasadas"], ["prontas", "Prontas"]].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1 ${filter === value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          <ul className="max-h-[68vh] space-y-2 overflow-y-auto pr-1" aria-label="Carretas">
            {shown.map((unit) => {
              const active = selected?.orderId === unit.order_id && selected?.unit === unit.unit_number
              const order = orders.get(String(unit.order_id)) || {}
              return (
                <li key={`${unit.order_id}-${unit.unit_number}`}>
                  <button type="button" onClick={() => choose({ orderId: unit.order_id, unit: unit.unit_number })} className={`w-full rounded-lg border p-3 text-left text-sm transition ${active ? "border-primary bg-primary/5" : "bg-card hover:border-primary/50"} ${unit.late ? "border-l-4 border-l-red-500" : ""}`}>
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{unit.order_code} · carreta {unit.unit_number}</span>{unit.finished ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">pronta</span> : <span className={`rounded px-1.5 py-0.5 text-[11px] ${statusTone[unit.current_status] || "bg-slate-100"}`}>{statusLabel[unit.current_status] || unit.current_status}</span>}</div>
                    <div className="text-muted-foreground">{unit.product}{unit.model ? ` · ${unit.model}` : ""}</div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-xs"><span className="font-mono">{unit.vin || "chassi a informar"}</span><span>{order.order_number ? `Pedido ${order.order_number}` : "sem pedido"}</span></div>
                    {!unit.finished ? <div className="mt-1 text-xs"><b>{unit.current_name}</b>{unit.working?.length ? ` · ${unit.working.join(", ")}` : unit.assigned ? ` · ${unit.assigned}` : " · sem responsável"}</div> : null}
                    <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${unit.total_tasks ? Math.round((unit.done_tasks / unit.total_tasks) * 100) : 0}%` }} /></div>
                  </button>
                </li>
              )
            })}
            {!shown.length && overview ? <li className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{units.length ? "Nenhuma carreta neste filtro." : "Ainda não há carretas em produção. Elas aparecem aqui quando um pedido de venda é gerado."}</li> : null}
          </ul>
        </aside>

        <section className="min-w-0">
          {current && selected ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{current.order_code} · carreta {current.unit_number}{current.total_tasks ? ` · ${current.done_tasks}/${current.total_tasks} etapas` : ""}</h2>
                    <p className="text-sm text-muted-foreground">{current.product}{current.model ? ` · ${current.model}` : ""} · {orders.get(String(current.order_id))?.client_name || "sem cliente"} · chassi <span className="font-mono">{current.vin || "a informar"}</span> · prazo {dateBr(current.planned_end)}</p>
                  </div>
                  {!current.finished ? <Button onClick={() => void act({ action: "advance", orderId: current.order_id, unit: current.unit_number }, `Etapa "${current.current_name}" concluída.`)}>Concluir etapa e avançar<ChevronRight className="h-4 w-4" /></Button> : <span className="rounded bg-emerald-100 px-2 py-1 text-sm text-emerald-800">Carreta pronta: entrou no estoque de acabados</span>}
                </div>
              </div>
              <Tabs value={area} onValueChange={(value) => choose(selected, value as Area)}>
                <TabsList><TabsTrigger value="ordem">Ordem e materiais</TabsTrigger><TabsTrigger value="esteira">Esteira</TabsTrigger><TabsTrigger value="tarefas">Tarefas</TabsTrigger></TabsList>
                <TabsContent value="ordem" className="mt-4"><OrderMaterials orderId={selected.orderId} refreshKey={tick} onChanged={() => void load()} canRelink={user?.role === "admin" || user?.role === "manager"} /></TabsContent>
                <TabsContent value="esteira" className="mt-4"><Pipeline orderId={selected.orderId} unit={selected.unit} refreshKey={tick} workers={overview?.workers || []} onAct={act} board={board} /></TabsContent>
                <TabsContent value="tarefas" className="mt-4"><Tasks unit={current} orderId={selected.orderId} refreshKey={tick} workers={overview?.workers || []} onChanged={() => void load()} /></TabsContent>
              </Tabs>
            </div>
          ) : overview ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Escolha uma carreta na lista para ver a ordem, os materiais, a esteira e as tarefas.</div> : null}
        </section>
      </div>

      <Sheet open={planning} onOpenChange={setPlanning}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-6xl">
          <SheetHeader><SheetTitle>Planejamento geral de materiais</SheetTitle><SheetDescription>Necessidades de todas as ordens abertas, estoque, reservas e solicitações de compra (cada demanda mantém a ordem de origem).</SheetDescription></SheetHeader>
          <div className="px-4 pb-6"><EmbeddedPageContext.Provider value><ProductionPage /></EmbeddedPageContext.Provider></div>
        </SheetContent>
      </Sheet>
    </PageShell>
  )
}

// ---------------------------------------------------------------- ORDEM E MATERIAIS

function OrderMaterials({ orderId, refreshKey, onChanged, canRelink }: { orderId: string; refreshKey: number; onChanged: () => void; canRelink: boolean }) {
  const [central, setCentral] = useState<Row | null>(null)
  const [detail, setDetail] = useState<Row | null>(null)
  const [error, setError] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  useEffect(() => {
    let alive = true
    Promise.all([api<Row>(`/api/producao/${orderId}/central`), api<{ detail: Row }>(`/api/producao/${orderId}`)]).then(([extras, full]) => { if (alive) { setCentral(extras); setDetail(full.detail); setError("") } }).catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Erro ao carregar a ordem."))
    return () => { alive = false }
  }, [orderId, refreshKey])
  if (error) return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
  if (!central || !detail) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</p>

  const cfg = central.configuration as Row | null
  const params: Row = cfg?.params || {}
  const plan: Row[] = detail.plan || []
  const materials: Row[] = detail.materials || []
  const shortages = plan.filter((row) => Number(row.shortage) > 0)
  const noComposition = central.kits.length === 0 || materials.length === 0
  const requests: Row[] = detail.purchase_requests || []

  async function relink() {
    setBusy(true); setMessage("")
    try { await api("/api/producao/pendencias", { method: "POST", body: JSON.stringify({ orderId, reason }) }); setMessage("Composição reconciliada e registrada na auditoria da ordem."); setReason(""); onChanged() } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Não foi possível reconciliar.") } finally { setBusy(false) }
  }
  async function requestPurchase() {
    setBusy(true); setMessage("")
    try { await api(`/api/producao/${orderId}`, { method: "POST", body: JSON.stringify({ action: "purchase_request" }) }); setMessage("Solicitação de compra gerada: ela aparece em Compras."); onChanged() } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Não foi possível gerar a solicitação.") } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Identificação" description={central.hasSnapshot ? `Snapshot técnico congelado na confirmação do pedido (${stamp(central.snapshotTakenAt)}): a composição não muda se o catálogo mudar.` : "Composição congelada na criação da ordem."}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[["Cliente", central.client || "-"], ["Pedido de venda", central.salesOrder?.number || "-"], ["Ordem de produção", central.order.code], ["Produto", `${central.product.name}${central.product.sku ? ` (${central.product.sku})` : ""}`],
            ["Estrutura de fabricação", central.bomVersion ? `v${central.bomVersion}` : "-"], ["Quantidade", `${qty(central.order.produced)} de ${qty(central.order.quantity)} produzida(s)`], ["Previsão", dateBr(central.order.plannedEnd)], ["Situação", central.order.status]].map(([label, value]) => (
            <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>
          ))}
        </dl>
        {cfg ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <dl className="space-y-1 text-sm">
              <div className="font-medium">{cfg.summary}</div>
              <div><span className="text-muted-foreground">Medidas: </span>{["comprimento", "largura", "altura"].filter((key) => params[key]).map((key) => `${key} ${params[key]}`).join(" · ") || "-"}</div>
              <div><span className="text-muted-foreground">Acabamento: </span>{(cfg.finish || []).join(", ") || "-"}</div>
              <div><span className="text-muted-foreground">Acessórios: </span>{(cfg.accessories || []).join(", ") || "-"}</div>
              <div className="text-xs text-muted-foreground">Revisão de engenharia {cfg.revision_label || "-"} · estrutura v{cfg.bom_version ?? "-"}</div>
            </dl>
            {params.comprimento ? <TrailerDrawingView product={central.product.name} params={params} grade={cfg.drawing_spec?.grade === "validado" && cfg.homologated ? "validado" : "ilustrativo"} revision={cfg.revision_label} geometry={cfg.drawing_spec?.geometry} finish={(cfg.finish || [])[0]} accessories={cfg.accessories || []} /> : null}
          </div>
        ) : <p className="mt-3 text-xs text-muted-foreground">Produto padrão (sem medidas personalizadas): o desenho e as medidas vêm da ficha do produto.</p>}
      </SectionCard>

      {noComposition ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Esta ordem não recebeu os kits/matérias-primas do produto vendido.</b> Nada foi inventado: a reconciliação usa a estrutura que a própria ordem já registra (v{central.bomVersion ?? "?"}), com motivo e auditoria.</span></p>
          {canRelink ? (
            <div className="mt-2 flex flex-wrap items-end gap-2"><Input className="max-w-md" placeholder="Motivo da reconciliação (mín. 10 caracteres)" value={reason} onChange={(event) => setReason(event.target.value)} /><Button size="sm" disabled={busy || reason.trim().length < 10} onClick={() => void relink()}>Reconciliar composição</Button></div>
          ) : <p className="mt-1 text-xs">Só administrador ou gerente reconcilia. Peça a um deles.</p>}
          {message ? <p className="mt-2 text-xs">{message}</p> : null}
        </div>
      ) : null}

      <SectionCard title="Kits do produto" description="Kits recebidos da venda, com a versão e a quantidade congeladas. Clique para ver a composição.">
        <div className="space-y-2">
          {central.kits.map((kit: Row) => (
            <details key={kit.kitId} className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">{kit.name} <span className="font-mono text-xs text-muted-foreground">{kit.sku}</span> · versão {kit.version ?? "-"} · {qty(kit.quantity)} kit(s) · {kit.components.length} matéria(s)-prima(s)</summary>
              <DataTable headers={["Matéria-prima", "SKU", "Quantidade por kit", "Un.", "Perda"]} empty={!kit.components.length}>
                {kit.components.map((comp: Row) => <TableRow key={comp.materialId}><TableCell>{comp.name}</TableCell><TableCell className="font-mono text-xs">{comp.sku}</TableCell><TableCell className="text-right">{qty(comp.quantity)}</TableCell><TableCell>{comp.unit}</TableCell><TableCell className="text-right">{comp.lossPercent ? `${comp.lossPercent}%` : "-"}</TableCell></TableRow>)}
              </DataTable>
            </details>
          ))}
          {!central.kits.length ? <p className="text-sm text-muted-foreground">Nenhum kit nesta ordem.</p> : null}
        </div>
      </SectionCard>

      <SectionCard title="Matérias-primas e abastecimento" description="Calculado da composição congelada da ordem. Faltante = o que não está disponível nem reservado para esta ordem.">
        <DataTable headers={["Matéria-prima", "SKU", "Kit", "Necessária", "Disponível", "Reservada", "Consumida", "Faltante", "Un."]} empty={!materials.length}>
          {materials.map((material) => {
            const line = plan.find((row) => row.material_id === material.material_id)
            const missing = Number(line?.shortage || 0)
            return (
              <TableRow key={material.id}>
                <TableCell className="font-medium">{material.name}</TableCell><TableCell className="font-mono text-xs">{material.sku}</TableCell><TableCell>{material.kit}</TableCell>
                <TableCell className="text-right">{qty(material.required)}</TableCell><TableCell className="text-right">{qty(line?.available_free)}</TableCell><TableCell className="text-right">{qty(material.reserved)}</TableCell><TableCell className="text-right">{qty(material.consumed)}</TableCell>
                <TableCell className={`text-right ${missing > 0 ? "font-semibold text-destructive" : ""}`}>{qty(missing)}</TableCell><TableCell>{material.unit}</TableCell>
              </TableRow>
            )
          })}
        </DataTable>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span>{shortages.length ? <b className="text-destructive">{shortages.length} material(is) em falta</b> : "Abastecimento completo para esta ordem."}</span>
          {shortages.length ? <Button size="sm" onClick={() => void requestPurchase()} disabled={busy}><ShoppingCart className="h-4 w-4" />Gerar solicitação de compra</Button> : null}
          {requests.map((request) => <Link key={request.id} href="/compras" className="rounded border px-2 py-0.5 text-xs hover:bg-muted">{request.request_number} · {request.status}</Link>)}
          {message && !noComposition ? <span className="text-xs text-muted-foreground">{message}</span> : null}
        </div>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------- ESTEIRA

function Pipeline({ orderId, unit, refreshKey, workers, onAct, board }: { orderId: string; unit: number; refreshKey: number; workers: Row[]; onAct: (body: Record<string, unknown>, success: string) => Promise<void>; board: Row | undefined }) {
  const [central, setCentral] = useState<Row | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => { let alive = true; api<Row>(`/api/producao/${orderId}/central`).then((data) => alive && setCentral(data)).catch(() => undefined); return () => { alive = false } }, [orderId, refreshKey])
  const row: Row | undefined = central?.units?.find((item: Row) => item.unit === unit)
  return (
    <div className="space-y-3">
      {row ? (
        <SectionCard title={`Carreta ${unit}: etapas`} description="Etapa atual, responsável, situação, início, término e tempo. Concluir a etapa libera a próxima.">
          <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {(row.tasks as Row[]).map((task) => {
              const isCurrent = row.current?.id === task.id
              return (
                <li key={task.id} className={`rounded-lg border p-3 text-sm ${isCurrent ? "border-primary bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2"><span className="font-medium">{task.step}</span><span className={`rounded px-1.5 py-0.5 text-[11px] ${statusTone[task.status] || "bg-slate-100"}`}>{statusLabel[task.status] || task.status}</span></div>
                  <div className="mt-1 text-xs text-muted-foreground">{task.working.length ? `Trabalhando: ${task.working.join(", ")}` : task.responsible ? `Resp.: ${task.responsible}` : "Sem responsável"}</div>
                  <div className="text-xs text-muted-foreground">Início {stamp(task.startedAt)} · fim {stamp(task.finishedAt)}{task.elapsedMinutes ? ` · ${minutes(task.elapsedMinutes)}` : ""}</div>
                  {task.blockedReason || task.pendingReason ? <div className="mt-1 text-xs text-red-700">{task.blockedReason || task.pendingReason}</div> : null}
                  {isCurrent ? <div className="mt-2 space-y-1">
                    <select aria-label="Responsável" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value="" onChange={(event) => event.target.value && void onAct({ action: "reassign", taskId: task.id, workerId: event.target.value }, "Responsável definido.")}><option value="">Definir responsável</option>{workers.filter((worker) => worker.active).map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>
                    <Button size="sm" className="h-8 w-full text-xs" onClick={() => void onAct({ action: "advance", orderId, unit }, `Etapa "${task.step}" concluída.`)}>Concluir etapa e avançar</Button>
                  </div> : null}
                </li>
              )
            })}
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">{row.next ? <>Próxima tarefa: <b>{row.next.step}</b>.</> : row.current ? "Esta é a última etapa." : "Todas as etapas concluídas."}</p>
        </SectionCard>
      ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando as etapas...</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />Mostrar a esteira de todas as carretas ({board?.units?.length ?? 0})</label>
      {all ? <EmbeddedPageContext.Provider value><ShopBoardPage /></EmbeddedPageContext.Provider> : null}
    </div>
  )
}

// ---------------------------------------------------------------- TAREFAS

function Tasks({ unit, orderId, refreshKey, workers, onChanged }: { unit: Row; orderId: string; refreshKey: number; workers: Row[]; onChanged: () => void }) {
  const [central, setCentral] = useState<Row | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { let alive = true; api<Row>(`/api/producao/${orderId}/central`).then((data) => alive && setCentral(data)).catch(() => undefined); return () => { alive = false } }, [orderId, refreshKey])
  const row: Row | undefined = central?.units?.find((item: Row) => item.unit === unit.unit_number)
  return (
    <div className="space-y-3">
      <SectionCard title={`Tarefas da carreta ${unit.unit_number}`} description="As mesmas tarefas que o colaborador vê no Modo Tablet: o que ele inicia, pausa, retoma e finaliza aparece aqui na hora.">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Designar, bloquear e cancelar tarefas</Button>
          <Button size="sm" variant="outline" asChild><a href="/producao/tablet" target="_blank" rel="noreferrer"><Tablet className="h-4 w-4" />Abrir o Modo Tablet</a></Button>
        </div>
        <DataTable headers={["Etapa", "Responsável", "Situação", "Início", "Término", "Tempo", "Pendências"]} empty={!row?.tasks?.length}>
          {(row?.tasks || []).map((task: Row) => (
            <TableRow key={task.id}>
              <TableCell className="font-medium">{task.step}{row?.current?.id === task.id ? <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">atual</span> : null}</TableCell>
              <TableCell>{task.working.length ? task.working.join(", ") : task.responsible || "-"}</TableCell>
              <TableCell><span className={`rounded px-1.5 py-0.5 text-xs ${statusTone[task.status] || "bg-slate-100"}`}>{statusLabel[task.status] || task.status}</span></TableCell>
              <TableCell className="whitespace-nowrap">{stamp(task.startedAt)}</TableCell><TableCell className="whitespace-nowrap">{stamp(task.finishedAt)}</TableCell><TableCell>{task.elapsedMinutes ? minutes(task.elapsedMinutes) : "-"}</TableCell>
              <TableCell className="max-w-xs text-xs">{task.blockedReason || task.pendingReason || "-"}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
      {open ? <UnitDialog unit={unit} workers={workers} onClose={() => { setOpen(false); onChanged() }} onAct={async (body, success) => { try { await manage(body); onChanged(); return success } catch { return null } }} /> : null}
    </div>
  )
}

