"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Banknote, CheckCircle2, Factory, Loader2, PackageCheck, RefreshCw, Truck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { DocumentationSheet } from "@/components/documentation/documentation-sheet"
import { useAuth } from "@/lib/auth-context"
import { docStatusLabel, docStatusTone, releaseLabel } from "@/lib/vehicle-documentation"
import { entityHref } from "@/lib/entity-links"
import { fulfilment, productionStatusLabel, productionTone, salesActions, salesStatusLabel, salesTone, type SalesItemView } from "@/lib/sales"

type Item = SalesItemView & Record<string, any>
type Detail = {
  release?: { eligible: boolean; blockers: Array<{ code: string; message: string; waivable: boolean }> }; documentation?: { summary: Record<string, any>; items: Array<Record<string, any>> }; settings?: Record<string, any>
  order: Record<string, any>; require_payment: boolean; items: Item[]; production_orders: Array<Record<string, any>>; deliveries: Array<Record<string, any>>; events: Array<Record<string, any>>; availability: Array<Record<string, any>>
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)

export function SalesDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [reason, setReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [paymentNote, setPaymentNote] = useState("")
  const deliveryKey = useRef(newKey())
  const { user } = useAuth()
  const manager = user?.role === "admin" || user?.role === "manager"
  const [docId, setDocId] = useState<string | null>(null)
  const [exceptionReason, setExceptionReason] = useState("")
  const [revokeReason, setRevokeReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setDetail((await api<{ detail: Detail }>(`/api/vendas/${id}`)).detail) } catch (failure) { setError(failure instanceof Error ? failure.message : "Erro ao carregar o pedido.") } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function act(action: string, body: Record<string, unknown> = {}, success = "") {
    setBusy(action); setNotice("")
    try {
      const data = await api<{ detail: Detail; result: Record<string, any> }>(`/api/vendas/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) })
      setDetail(data.detail)
      const created = data.result?.production_orders_created?.length
      setNotice(data.result?.blocked ? "Pedido confirmado. A produção aguarda a confirmação do sinal/pagamento." : success || (created ? `${created} ordem(ns) de produção gerada(s).` : "Ação concluída."))
      if (action === "deliver") deliveryKey.current = newKey()
      setCancelling(false); setReason("")
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Ação não concluída.") } finally { setBusy("") }
  }

  if (!detail) {
    return (
      <PageShell title="Pedido de venda" description="Carregando..." actions={<Button variant="outline" asChild><Link href="/vendas"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : ""}</p>}
      </PageShell>
    )
  }
  const order = detail.order
  const actions = salesActions(order as { status: string; payment_confirmed_at?: string | null }, detail.require_payment, detail.items)
  const productItems = detail.items.filter((item) => item.line_type === "Produto")
  const totals = productItems.reduce((sum, item) => { const f = fulfilment(item); return { ordered: sum.ordered + f.quantity, ready: sum.ready + f.ready, delivered: sum.delivered + f.delivered, producing: sum.producing + f.inProduction } }, { ordered: 0, ready: 0, delivered: 0, producing: 0 })
  const changed = productItems.some((item) => item.structure_changed)

  return (
    <PageShell title={`Pedido ${order.order_number}`} description={`${order.client_name}${order.quote_number ? ` · orçamento ${order.quote_number} v${order.quote_version}` : ""} · ${order.payment_condition_name || "sem condição de pagamento"}`}
      actions={<>
        <Button variant="outline" asChild><Link href="/vendas"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        {actions.confirm ? <Button onClick={() => void act("confirm")} disabled={Boolean(busy)}>{busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirmar pedido</Button> : null}
        {actions.deliver ? <Button onClick={() => void act("deliver", { requestKey: deliveryKey.current }, "Entrega registrada: baixa dos acabados feita.")} disabled={Boolean(busy)}>{busy === "deliver" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}Entregar {qty(actions.readyUnits)} pronta(s)</Button> : null}
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${salesTone(order.status)}`}>{salesStatusLabel(order.status)}</span>
        {detail.require_payment ? <span className={`rounded px-2 py-0.5 text-xs ${order.payment_confirmed_at ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{order.payment_confirmed_at ? `Pagamento confirmado por ${order.payment_confirmed_by || "-"}` : "Exige sinal/pagamento para fabricar"}</span> : null}
      </div>
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
      {changed ? <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><TriangleAlert className="h-4 w-4 shrink-0" />A estrutura de fabricação de algum produto mudou desde o orçamento: a produção usa a estrutura vigente na confirmação (veja as versões na tabela).</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total do pedido" value={brl(order.total_amount)} note={`${detail.items.length} item(ns) · previsão ${dateBr(order.delivery_date)}`} icon={Banknote} />
        <MetricCard title="Prontas (reservadas)" value={qty(totals.ready)} note={`de ${qty(totals.ordered)} unidade(s) pedidas`} icon={PackageCheck} />
        <MetricCard title="Em fabricação" value={qty(totals.producing)} note={`${detail.production_orders.length} ordem(ns) de produção`} icon={Factory} />
        <MetricCard title="Entregues" value={qty(totals.delivered)} note="baixa efetiva do estoque de acabados" icon={Truck} />
      </div>

      {(actions.payment || actions.cancel) ? (
        <SectionCard title="Ações do pedido">
          <div className="flex flex-wrap items-end gap-3">
            {actions.payment ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Observação do pagamento/sinal</span><Input className="w-64" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Ex.: sinal de 30% recebido" /></label>
                <Button onClick={() => void act("payment", { note: paymentNote }, "Pagamento confirmado: produção liberada.")} disabled={Boolean(busy)}>{busy === "payment" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar sinal/pagamento e liberar produção</Button>
              </div>
            ) : null}
            {actions.cancel ? (cancelling ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Motivo do cancelamento *</span><Input className="w-72" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                <Button variant="destructive" onClick={() => void act("cancel", { reason }, "Pedido cancelado: reservas liberadas.")} disabled={Boolean(busy) || !reason.trim()}>Confirmar cancelamento</Button>
                <Button variant="outline" onClick={() => setCancelling(false)}>Voltar</Button>
              </div>
            ) : <Button variant="outline" onClick={() => setCancelling(true)}>Cancelar pedido</Button>) : null}
          </div>
        </SectionCard>
      ) : null}

      {detail.release ? (
        <SectionCard title="Documentação veicular e liberação da produção" description="A fabricação física só começa quando todas as condições abaixo estão atendidas. A liberação é calculada pelo sistema, não é um campo editável.">
          <p className={`mb-3 flex items-start gap-2 rounded-md border p-3 text-sm ${detail.release.eligible ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>{releaseLabel(detail.release)}</p>
          {detail.documentation && detail.documentation.items.length ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {detail.documentation.items.map((doc) => (
                <button key={doc.id} type="button" onClick={() => setDocId(doc.id)} className="rounded-md border p-3 text-left text-sm hover:bg-muted/40">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">Unidade {doc.unit_number}/{doc.units_in_item}</span><span className={`rounded px-2 py-0.5 text-xs font-medium ${docStatusTone(doc.status)}`}>{docStatusLabel(doc.status)}</span></span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">{doc.vin || "chassi a informar"}{doc.protocol ? ` · ${doc.protocol}` : ""}</span>
                </button>
              ))}
            </div>
          ) : <p className="mb-3 text-sm text-muted-foreground">{detail.release.blockers.some((blocker) => blocker.code === "documentacao") ? "A documentação das unidades ainda não foi iniciada." : "Nenhum item deste pedido exige documentação veicular."}</p>}
          <div className="flex flex-wrap items-end gap-3">
            {detail.release.blockers.some((blocker) => blocker.code === "autorizacao") ? <Button disabled={Boolean(busy)} onClick={() => void act("authorize", {}, "Produção autorizada.")}>{busy === "authorize" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Autorizar a produção</Button> : null}
            {detail.settings?.require_operational_authorization && !detail.release.blockers.some((blocker) => blocker.code === "autorizacao") && !["Entregue", "Cancelado"].includes(order.status) ? (
              <div className="flex items-end gap-2"><Input className="w-56" placeholder="Motivo para revogar" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /><Button variant="outline" disabled={Boolean(busy) || !revokeReason.trim()} onClick={() => void act("revoke_authorization", { reason: revokeReason }, "Autorização revogada: produção bloqueada.")}>Revogar autorização</Button></div>
            ) : null}
            {manager && detail.release.blockers.some((blocker) => blocker.code === "pagamento" && blocker.waivable) ? (
              <div className="flex items-end gap-2"><Input className="w-72" placeholder="Justificativa da exceção comercial (mín. 10)" value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} /><Button variant="outline" disabled={Boolean(busy) || exceptionReason.trim().length < 10} onClick={() => void act("release_exception", { reason: exceptionReason }, "Exceção comercial registrada e auditada.")}>Dispensar sinal (exceção)</Button></div>
            ) : null}
            {(!detail.documentation || detail.documentation.items.length === 0) && ["Confirmado", "Aguardando producao", "Em producao", "Parcialmente disponivel", "Pronto para entrega"].includes(order.status) ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("generate_documentation", {}, "Documentação iniciada.")}>Iniciar documentação das unidades</Button> : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Documentação veicular é requisito legal e não pode ser dispensada. Só a exigência comercial (sinal) admite exceção, e apenas se a empresa tiver a regra formal ligada, com justificativa e auditoria.</p>
          <DocumentationSheet id={docId} onClose={() => setDocId(null)} onChanged={() => void load()} />
        </SectionCard>
      ) : null}

      <SectionCard title="Itens e atendimento" description="Pronta = unidade reservada ao pedido (do estoque ou produzida). Entregue = já saiu do estoque. A mesma unidade nunca conta nos dois lugares.">
        <DataTable headers={["Item", "SKU", "Qtd.", "Preço", "Do estoque", "A fabricar", "Prontas", "Em fabricação", "Entregues", "Pendente", "Estrutura"]} empty={!detail.items.length}>
          {detail.items.map((item) => {
            const f = fulfilment(item)
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.description}{item.make_to_order ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">sob encomenda</span> : null}</TableCell>
                <TableCell className="font-mono text-xs">{item.sku || "-"}</TableCell>
                <TableCell className="text-right">{qty(item.quantity)} {item.unit}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(item.unit_price)}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" && item.planned ? qty(item.quantity_from_stock) : "-"}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" && item.planned ? qty(item.quantity_to_produce) : "-"}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" ? qty(f.ready) : "-"}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" ? qty(f.inProduction) : "-"}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" ? qty(f.delivered) : "-"}</TableCell>
                <TableCell className="text-right">{item.line_type === "Produto" ? qty(f.pending) : "-"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{item.bom_version ? `v${item.bom_version}` : item.quoted_bom_version ? `orç. v${item.quoted_bom_version}` : "-"}{item.structure_changed ? " ⚠" : ""}</TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>

      {detail.availability.length ? (
        <SectionCard title="Estoque de acabados x fabricação (pré-visualização)" description="O que acontecerá ao confirmar: nada é reservado nem fabricado antes da confirmação.">
          <DataTable headers={["Item", "Acabados disponíveis", "Será reservado", "Será fabricado", "Estrutura vigente"]}>
            {detail.availability.map((row) => (
              <TableRow key={row.item_id}>
                <TableCell>{row.description} <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></TableCell>
                <TableCell className="text-right">{qty(row.available_finished)}</TableCell>
                <TableCell className="text-right">{qty(row.would_reserve)}</TableCell>
                <TableCell className={`text-right ${Number(row.would_produce) > 0 && !row.has_structure ? "font-medium text-destructive" : ""}`}>{qty(row.would_produce)}</TableCell>
                <TableCell>{row.has_structure ? `v${row.active_bom_version}${row.structure_changed ? " (mudou desde o orçamento)" : ""}` : <span className="text-destructive">sem estrutura ativa</span>}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Ordens de produção">
          <DataTable headers={["Ordem", "Produto", "Situação", "Produzido", "Previsão"]} empty={!detail.production_orders.length}>
            {detail.production_orders.map((po) => (
              <TableRow key={po.id}>
                <TableCell><Link className="font-mono text-xs text-primary underline-offset-2 hover:underline" href={entityHref("productionOrder", po.id) || "#"}>{po.code}</Link></TableCell>
                <TableCell>{po.product}</TableCell>
                <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${productionTone(po.status)}`}>{productionStatusLabel(po.status, Number(po.produced_quantity), Number(po.quantity))}</span></TableCell>
                <TableCell className="text-right">{qty(po.produced_quantity)} / {qty(po.quantity)}</TableCell>
                <TableCell>{dateBr(po.planned_end)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
        <SectionCard title="Entregas">
          <DataTable headers={["Quando", "Itens", "Por"]} empty={!detail.deliveries.length}>
            {detail.deliveries.map((delivery) => (
              <TableRow key={delivery.id}><TableCell>{dateBr(delivery.created_at)}</TableCell><TableCell>{(delivery.items || []).map((line: Record<string, any>) => `${qty(line.quantity)} × ${line.description}`).join("; ")}</TableCell><TableCell>{delivery.delivered_by || "-"}</TableCell></TableRow>
            ))}
          </DataTable>
        </SectionCard>
      </div>

      <SectionCard title="Histórico">
        <DataTable headers={["Quando", "Evento", "Detalhe", "Responsável"]} empty={!detail.events.length} stickyHeader viewportClassName="max-h-[40vh]">
          {detail.events.map((event, index) => <TableRow key={index}><TableCell className="whitespace-nowrap">{dateBr(event.created_at)}</TableCell><TableCell>{event.event}</TableCell><TableCell>{event.description}</TableCell><TableCell>{event.actor || "-"}</TableCell></TableRow>)}
        </DataTable>
      </SectionCard>
    </PageShell>
  )
}
