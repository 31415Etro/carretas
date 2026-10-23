"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Boxes, ClipboardList, Factory, Loader2, PackageCheck, RefreshCw, ShoppingCart, TimerOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ManualOrderSheet } from "@/components/production/manual-order-sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr, qty, SearchBox } from "@/components/catalog/catalog-fields"
import { mrpSituation, productionStatusLabel, productionTone } from "@/lib/sales"

type Order = {
  id: string; code: string; status: string; product_name: string; sku: string; quantity: number; produced_quantity: number; remaining: number; sales_order_id: string | null; order_number: string | null
  client_name: string | null; planned_end: string | null; priority: number; responsible: string | null; estimated_cost: number; actual_materials_cost: number; materials_missing: number; late: boolean
}
type Mrp = {
  material_id: string; sku: string; name: string; unit: string; required: number; reserved_for_orders: number; unreserved_need: number; physical: number; reserved_total: number; available: number; incoming: number
  shortage_now: number; shortage_projected: number; requested: number; to_request: number; supplier_name: string | null; lead_time_days: number | null; next_arrival: string | null; needed_by: string | null
  orders: Array<{ code: string }>; arrivals: Array<{ purchase_order: string; expected_date: string | null; quantity: number }>
}
type Request = { id: string; request_number: string; status: string; requested_by: string | null; created_at: string; production_order: string | null; items: Array<Record<string, any>>; orders: string[] }
type Dashboard = Record<string, any>
const SIZE = 25
const statusFilters: Array<[string, string]> = [["abertas", "Em andamento"], ["Aguardando materiais", "Aguardando materiais"], ["Pronta para producao", "Prontas"], ["Em producao", "Em produção"], ["Pausada", "Pausadas"], ["Aguardando inspecao", "Em inspeção"], ["Concluida", "Concluídas"], ["Cancelada", "Canceladas"], ["", "Todas"]]

export function ProductionPage() {
  const router = useRouter()
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("abertas")
  const [page, setPage] = useState(1)
  const [mrp, setMrp] = useState<Mrp[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [newOrder, setNewOrder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const [list, planning, pending] = await Promise.all([
        api<{ items: Order[]; total: number; dashboard: Dashboard }>(`/api/producao?${new URLSearchParams({ q: query, status, pagina: String(page), tamanho: String(SIZE), painel: "1" })}`),
        api<{ items: Mrp[] }>("/api/producao/mrp"),
        api<{ items: Request[] }>("/api/producao/solicitacoes"),
      ])
      setOrders(list.items); setTotal(list.total); setDashboard(list.dashboard); setMrp(planning.items); setRequests(pending.items)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a produção.") } finally { setLoading(false) }
  }, [query, status, page])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])

  async function generate() {
    setBusy("generate"); setNotice("")
    try { await api("/api/producao/solicitacoes", { method: "POST" }); setNotice("Solicitação de compra gerada com as faltas consolidadas. Ela não emite pedido ao fornecedor: precisa ser aprovada."); await load() } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Não foi possível gerar a solicitação.") } finally { setBusy("") }
  }
  async function setRequestStatus(id: string, next: string) {
    setBusy(id); setNotice("")
    try { await api("/api/producao/solicitacoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: next }) }); await load() } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Ação não concluída.") } finally { setBusy("") }
  }

  const d = dashboard || {}
  const pages = Math.max(1, Math.ceil(total / SIZE))
  const toRequest = mrp.filter((row) => Number(row.to_request) > 0).length
  const cost = d.cost_completed || { orders: 0, estimated: 0, actual: 0 }

  return (
    <PageShell title="Produção" description="Ordens de produção, falta de materiais e solicitações de compra."
      actions={<><Button onClick={() => setNewOrder(true)}>Nova ordem de produção</Button><Button variant="outline" asChild><Link href="/estoque?aba=movimentacoes">Estoque</Link></Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button></>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Ordens em andamento" value={Number(d.orders_in_progress || 0)} note={`${Number(d.orders_open || 0)} abertas`} icon={Factory} />
        <MetricCard title="Ordens atrasadas" value={Number(d.orders_late || 0)} note="previsão vencida e ainda abertas" icon={TimerOff} />
        <MetricCard title="Materiais faltantes" value={Number(d.materials_short || 0)} note={`${Number(d.materials_short_now || 0)} sem saldo agora (projetado considera compras)`} icon={AlertTriangle} />
      </div>

      <Tabs defaultValue="ordens">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="ordens">Ordens de produção ({total})</TabsTrigger>
          <TabsTrigger value="mrp">Planejamento de materiais ({mrp.length})</TabsTrigger>
          <TabsTrigger value="solicitacoes">Solicitações de compra ({requests.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ordens" className="mt-4">
          <SectionCard title="Ordens de produção">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Buscar por ordem, produto, pedido ou cliente" />
              <select value={status} aria-label="Situação" className="h-9 rounded-md border bg-background px-3 text-sm" onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
                {statusFilters.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
              </select>
            </div>
            <DataTable headers={["Ordem", "Produto", "Pedido / cliente", "Situação", "Produzido", "Previsão"]} empty={!orders.length && !loading}>
              {orders.map((order) => (
                <TableRow key={order.id} className="cursor-pointer" onClick={() => router.push(`/producao/${order.id}`)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{order.code}</TableCell>
                  <TableCell className="font-medium">{order.product_name} <span className="font-mono text-xs text-muted-foreground">{order.sku}</span></TableCell>
                  <TableCell>{order.order_number || "-"}<span className="block text-xs text-muted-foreground">{order.client_name || ""}</span></TableCell>
                  <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${productionTone(order.status)}`}>{productionStatusLabel(order.status, Number(order.produced_quantity), Number(order.quantity))}</span></TableCell>
                  <TableCell className="text-right">{qty(order.produced_quantity)} / {qty(order.quantity)}</TableCell>
                  <TableCell className={`whitespace-nowrap ${order.late ? "font-medium text-destructive" : ""}`}>{dateBr(order.planned_end)}{order.late ? " (atrasada)" : ""}</TableCell>
                </TableRow>
              ))}
            </DataTable>
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">{total} ordem(ns) · página {page} de {pages}</span>
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Próxima</Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="mrp" className="mt-4">
          <SectionCard title="Necessidade consolidada de materiais (MRP)" description="O que as ordens abertas precisam, o que há em estoque e o que falta comprar.">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Button onClick={() => void generate()} disabled={busy === "generate" || toRequest === 0}>{busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Gerar solicitação de compra ({toRequest} material(is))</Button>
              <span className="text-xs text-muted-foreground">Junta as faltas de todas as ordens. Não emite pedido ao fornecedor.</span>
            </div>
            {notice ? <p className="mb-3 rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
            <DataTable headers={["Material", "Necessário", "Disponível", "Falta", "Já solicitado", "Situação"]} empty={!mrp.length && !loading}>
              {mrp.map((row) => {
                const situation = mrpSituation(row)
                return (
                  <TableRow key={row.material_id}>
                    <TableCell><Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/materias-primas/${row.material_id}`}>{row.name}</Link><span className="block font-mono text-xs text-muted-foreground">{row.sku} · {(row.orders || []).map((order) => order.code).join(", ")}</span></TableCell>
                    <TableCell className="text-right">{qty(row.required)} {row.unit}</TableCell>
                    <TableCell className="text-right">{qty(row.available)}</TableCell>
                    <TableCell className={`text-right ${Number(row.shortage_now) > 0 ? "font-medium text-destructive" : ""}`}>{Number(row.shortage_now) > 0 ? qty(row.shortage_now) : "-"}</TableCell>
                    <TableCell className="text-right">{Number(row.requested) ? qty(row.requested) : "-"}</TableCell>
                    <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${situation.tone}`}>{situation.label}</span></TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="solicitacoes" className="mt-4">
          <SectionCard title="Solicitações de compra" description="Necessidades para aprovação humana. Aprovar não emite pedido ao fornecedor: o pedido de compra segue o fluxo de Compras.">
            {notice ? <p className="mb-3 rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
            <DataTable headers={["Solicitação", "Situação", "Ordens", "Itens", "Criada", "Ações"]} empty={!requests.length && !loading}>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{request.request_number}</TableCell>
                  <TableCell>{request.status}</TableCell>
                  <TableCell className="text-xs">{(request.orders || []).join(", ") || request.production_order || "-"}</TableCell>
                  <TableCell className="text-xs">{request.items.map((item) => `${qty(item.quantity)} ${item.unit} ${item.name}${item.supplier ? ` (${item.supplier})` : ""}`).join("; ")}</TableCell>
                  <TableCell>{dateBr(request.created_at)}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    {request.status === "Pendente" ? <Button size="sm" disabled={busy === request.id} onClick={() => void setRequestStatus(request.id, "Aprovada")}>Aprovar</Button> : null}
                    {["Pendente", "Aprovada"].includes(request.status) ? <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void setRequestStatus(request.id, request.status === "Pendente" ? "Rejeitada" : "Cancelada")}>{request.status === "Pendente" ? "Rejeitar" : "Cancelar"}</Button> : null}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>
    <ManualOrderSheet open={newOrder} onOpenChange={setNewOrder} onCreated={(result) => { setNotice(`Ordem ${result.code} criada sem pedido de venda${result.documentation_created ? ` e ${result.documentation_created} documentação(ões) veicular(es) aberta(s)` : ""}. As tarefas já estão na esteira.`); void load() }} />
    </PageShell>
  )
}
