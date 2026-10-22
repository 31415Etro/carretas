"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Banknote, Boxes, CheckCircle2, Factory, Loader2, Pause, Play, RefreshCw, ShoppingCart, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { entityHref } from "@/lib/entity-links"
import { releaseLabel } from "@/lib/vehicle-documentation"
import { positiveNumber, productionActions, productionStatusLabel, productionTone } from "@/lib/sales"

type Detail = {
  release?: { eligible: boolean; blockers: Array<{ code: string; message: string; waivable: boolean }> }
  order: Record<string, any>; progress: { planned: number; started: number; produced: number; remaining: number }; kits: Array<Record<string, any>>; materials: Array<Record<string, any>>
  plan: Array<Record<string, any>>; consumptions: Array<Record<string, any>>; receipts: Array<Record<string, any>>; events: Array<Record<string, any>>; costs: Record<string, any>; purchase_requests: Array<Record<string, any>>
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)
const costLabel: Record<string, string> = { materiais: "Materiais", mao_de_obra: "Mão de obra", indiretos: "Indiretos", outros: "Outros" }

export function ProductionDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [reason, setReason] = useState("")
  const [mode, setMode] = useState<"" | "pause" | "cancel">("")
  const [materialId, setMaterialId] = useState("")
  const [consumeQty, setConsumeQty] = useState("")
  const [consumeKind, setConsumeKind] = useState("Consumo")
  const [lotQty, setLotQty] = useState("")
  const [autoConsume, setAutoConsume] = useState(false)
  const consumeKey = useRef(newKey())
  const lotKey = useRef(newKey())

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setDetail((await api<{ detail: Detail }>(`/api/producao/${id}`)).detail) } catch (failure) { setError(failure instanceof Error ? failure.message : "Erro ao carregar a ordem.") } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function act(action: string, body: Record<string, unknown> = {}, success = "Ação concluída.", onDone?: () => void) {
    setBusy(action); setNotice("")
    try {
      const data = await api<{ detail: Detail }>(`/api/producao/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) })
      setDetail(data.detail); setNotice(success); setMode(""); setReason(""); onDone?.()
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Ação não concluída.") } finally { setBusy("") }
  }

  if (!detail) {
    return (
      <PageShell title="Ordem de produção" description="Carregando..." actions={<Button variant="outline" asChild><Link href="/producao"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : ""}</p>}
      </PageShell>
    )
  }
  const order = detail.order
  const allowed = productionActions({ status: order.status, quantity: Number(order.quantity), produced_quantity: Number(order.produced_quantity) })
  const materialsInOrder = Array.from(new Map(detail.materials.map((m) => [m.material_id, m])).values())
  const lot = positiveNumber(lotQty)
  const costs = detail.costs
  const blocked = Boolean(detail.release && !detail.release.eligible)

  return (
    <PageShell title={`Ordem ${order.code}`} description={`${order.product_name} (${order.sku}) · estrutura v${order.bom_version}${order.order_number ? ` · pedido ${order.order_number}` : ""}${order.client_name ? ` · ${order.client_name}` : ""}`}
      actions={<>
        <Button variant="outline" asChild><Link href="/producao"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        {order.sales_order_id ? <Button variant="outline" asChild><Link href={entityHref("salesOrder", order.sales_order_id) || "#"}>Ver pedido</Link></Button> : null}
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${productionTone(order.status)}`}>{productionStatusLabel(order.status, Number(order.produced_quantity), Number(order.quantity))}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Prioridade {order.priority}</span>
        {order.responsible ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Resp.: {order.responsible}</span> : null}
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Estrutura e kits congelados na criação</span>
      </div>
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Planejado" value={qty(detail.progress.planned)} note={`início ${dateBr(order.planned_start)} · previsão ${dateBr(order.planned_end)}`} icon={Factory} />
        <MetricCard title="Iniciadas" value={qty(detail.progress.started)} note="com material apontado (ou já concluídas)" icon={Play} />
        <MetricCard title="Concluídas" value={qty(detail.progress.produced)} note={`restam ${qty(detail.progress.remaining)}`} icon={CheckCircle2} />
        <MetricCard title="Custo estimado" value={brl(costs.estimated_total)} note={`realizado: materiais ${brl(costs.consumed_materials)}`} icon={Banknote} />
      </div>

      {blocked ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Ordem bloqueada: aguardando liberação.</strong> {releaseLabel(detail.release)} O planejamento e a reserva de materiais continuam permitidos; iniciar, consumir material e concluir unidades só depois da liberação. {order.sales_order_id ? <Link className="underline" href={`/vendas/${order.sales_order_id}`}>Ver pedido e documentação</Link> : null}</span></p>
      ) : null}
      <SectionCard title="Ações da produção">
        <div className="flex flex-wrap items-center gap-2">
          {allowed.reserve ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("reserve", {}, "Reserva atualizada com o saldo livre da empresa.")}>{busy === "reserve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}Reservar materiais</Button> : null}
          {detail.plan.some((row) => Number(row.shortage) > 0) ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("purchase_request", {}, "Solicitação de compra gerada para as faltas desta ordem.")}><ShoppingCart className="h-4 w-4" />Gerar solicitação de compra</Button> : null}
          {allowed.start ? <Button disabled={Boolean(busy) || blocked} onClick={() => void act("status", { to: "start" }, "Produção iniciada.")}><Play className="h-4 w-4" />Iniciar produção</Button> : null}
          {allowed.inspection ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("status", { to: "inspection" }, "Ordem enviada para inspeção.")}>Enviar para inspeção</Button> : null}
          {allowed.backToProduction ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("status", { to: "back_to_production" }, "Inspeção aprovada: de volta à produção.")}>Inspeção concluída</Button> : null}
          {allowed.resume ? <Button disabled={Boolean(busy)} onClick={() => void act("status", { to: "resume" }, "Produção retomada.")}><Play className="h-4 w-4" />Retomar</Button> : null}
          {allowed.pause ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => setMode("pause")}><Pause className="h-4 w-4" />Pausar</Button> : null}
          {allowed.cancel ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => setMode("cancel")}>Cancelar ordem</Button> : null}
        </div>
        {mode ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Motivo *</span><Input className="w-72" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <Button variant={mode === "cancel" ? "destructive" : "default"} disabled={Boolean(busy) || !reason.trim()} onClick={() => void (mode === "pause" ? act("status", { to: "pause", reason }, "Produção pausada.") : act("cancel", { reason }, "Ordem cancelada: reservas liberadas."))}>Confirmar</Button>
            <Button variant="outline" onClick={() => setMode("")}>Voltar</Button>
          </div>
        ) : null}
        {allowed.consume ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-3">
              <h4 className="mb-2 text-sm font-medium">Apontar consumo de material</h4>
              <div className="flex flex-wrap items-end gap-2">
                <select aria-label="Material" className="h-9 rounded-md border bg-background px-2 text-sm" value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
                  <option value="">Material...</option>
                  {materialsInOrder.map((material) => <option key={material.material_id} value={material.material_id}>{material.name} ({material.unit})</option>)}
                </select>
                <Input className="w-28" inputMode="decimal" placeholder="Quantidade" aria-label="Quantidade consumida" value={consumeQty} onChange={(event) => setConsumeQty(event.target.value)} />
                <select aria-label="Tipo" className="h-9 rounded-md border bg-background px-2 text-sm" value={consumeKind} onChange={(event) => setConsumeKind(event.target.value)}><option>Consumo</option><option>Perda</option><option>Retrabalho</option><option>Adicional</option></select>
                <Button disabled={Boolean(busy) || blocked || !materialId || Number.isNaN(positiveNumber(consumeQty))} onClick={() => void act("consume", { materialId, quantity: positiveNumber(consumeQty), kind: consumeKind, requestKey: consumeKey.current }, "Consumo registrado e baixado do estoque.", () => { consumeKey.current = newKey(); setConsumeQty("") })}>{busy === "consume" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Registrar consumo</Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">A baixa usa o custo do momento e não se repete se o clique for duplicado. A quantidade é na unidade do material.</p>
            </div>
            {allowed.complete ? (
              <div className="rounded-md border p-3">
                <h4 className="mb-2 text-sm font-medium">Concluir unidades (total ou parcial)</h4>
                <div className="flex flex-wrap items-end gap-2">
                  <Input className="w-28" inputMode="decimal" placeholder={`até ${qty(allowed.remaining)}`} aria-label="Unidades concluídas" value={lotQty} onChange={(event) => setLotQty(event.target.value)} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={autoConsume} onChange={(event) => setAutoConsume(event.target.checked)} />Apontar automaticamente o material previsto que faltar</label>
                  <Button disabled={Boolean(busy) || blocked || Number.isNaN(lot) || lot > allowed.remaining} onClick={() => void act("complete", { quantity: lot, autoConsume, requestKey: lotKey.current }, "Unidades concluídas: entrada no estoque de acabados e reservadas ao pedido.", () => { lotKey.current = newKey(); setLotQty("") })}>{busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Concluir lote</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">O acabado só entra no estoque agora, com o custo do material efetivamente consumido; a conclusão não se repete.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <Tabs defaultValue="materiais">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="materiais">Materiais ({detail.materials.length})</TabsTrigger>
          <TabsTrigger value="kits">Kits ({detail.kits.length})</TabsTrigger>
          <TabsTrigger value="consumos">Consumos ({detail.consumptions.length})</TabsTrigger>
          <TabsTrigger value="lotes">Lotes concluídos ({detail.receipts.length})</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
          <TabsTrigger value="historico">Histórico ({detail.events.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="materiais" className="mt-4 space-y-4">
          <SectionCard title="Materiais da ordem (composição congelada)" description="Por kit de origem: previsto com perdas e conversões, reservado e consumido.">
            <DataTable headers={["Material", "Kit de origem", "Previsto", "Reservado", "Consumido", "Falta consumir", "Custo estimado"]} empty={!detail.materials.length}>
              {detail.materials.map((material) => (
                <TableRow key={material.id}>
                  <TableCell><Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/materias-primas/${material.material_id}`}>{material.name}</Link> <span className="font-mono text-xs text-muted-foreground">{material.sku}</span></TableCell>
                  <TableCell>{material.kit}</TableCell>
                  <TableCell className="text-right">{qty(material.required, 4)} {material.unit}</TableCell>
                  <TableCell className="text-right">{qty(material.reserved, 4)}</TableCell>
                  <TableCell className="text-right">{qty(material.consumed, 4)}</TableCell>
                  <TableCell className="text-right">{qty(material.remaining, 4)}</TableCell>
                  <TableCell className="text-right">{brl(material.cost_estimated)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
          <SectionCard title="Planejamento da ordem" description="Falta = previsto − consumido − reservado − saldo livre − compras a receber.">
            <DataTable headers={["Material", "Previsto", "Reservado p/ a ordem", "Livre na empresa", "A receber", "Falta"]} empty={!detail.plan.length}>
              {detail.plan.map((row) => (
                <TableRow key={row.material_id}>
                  <TableCell>{row.name}</TableCell><TableCell className="text-right">{qty(row.required, 4)} {row.unit}</TableCell><TableCell className="text-right">{qty(row.reserved_for_order, 4)}</TableCell>
                  <TableCell className="text-right">{qty(row.available_free, 4)}</TableCell><TableCell className="text-right">{Number(row.incoming) ? qty(row.incoming) : "-"}</TableCell>
                  <TableCell className={`text-right ${Number(row.shortage) > 0 ? "font-medium text-destructive" : ""}`}>{Number(row.shortage) > 0 ? qty(row.shortage, 4) : "-"}</TableCell>
                </TableRow>
              ))}
            </DataTable>
            {detail.purchase_requests.length ? <p className="mt-2 text-xs text-muted-foreground">Solicitações de compra ligadas: {detail.purchase_requests.map((request) => `${request.request_number} (${request.status})`).join(", ")}.</p> : null}
          </SectionCard>
        </TabsContent>

        <TabsContent value="kits" className="mt-4">
          <SectionCard title="Kits e versões usados" description="Congelados quando a ordem foi criada: mudar o kit depois não altera esta ordem.">
            <DataTable headers={["Kit", "SKU", "Versão do kit", "Quantidade"]} empty={!detail.kits.length}>
              {detail.kits.map((kit) => <TableRow key={kit.kit_id}><TableCell><Link className="font-medium text-primary underline-offset-2 hover:underline" href={entityHref("kit", kit.kit_id) || "#"}>{kit.name}</Link></TableCell><TableCell className="font-mono text-xs">{kit.sku}</TableCell><TableCell>v{kit.kit_version}</TableCell><TableCell className="text-right">{qty(kit.quantity)}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="consumos" className="mt-4">
          <SectionCard title="Consumos apontados" description="Custo histórico do momento da baixa; não é reescrito depois.">
            <DataTable headers={["Quando", "Material", "Tipo", "Quantidade", "Custo unit.", "Custo", "Responsável"]} empty={!detail.consumptions.length}>
              {detail.consumptions.map((entry) => <TableRow key={entry.id}><TableCell className="whitespace-nowrap">{dateBr(entry.occurred_at)}</TableCell><TableCell>{entry.material}</TableCell><TableCell>{entry.kind}</TableCell><TableCell className="text-right">{qty(entry.quantity, 4)} {entry.unit}</TableCell><TableCell className="text-right">{brl(entry.unit_cost)}</TableCell><TableCell className="text-right">{brl(entry.total_cost)}</TableCell><TableCell>{entry.responsible || "-"}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="lotes" className="mt-4">
          <SectionCard title="Lotes concluídos e entrada de acabados" description="Cada lote guarda como o custo foi apropriado; correções entram só como ajuste auditável.">
            <DataTable headers={["Quando", "Unidades", "Custo unitário", "Materiais", "Mão de obra/indiretos", "Apropriação", "Depósito", "Responsável"]} empty={!detail.receipts.length}>
              {detail.receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="whitespace-nowrap">{dateBr(receipt.created_at)}</TableCell><TableCell className="text-right">{qty(receipt.quantity)}</TableCell><TableCell className="text-right">{brl(receipt.unit_cost)}</TableCell>
                  <TableCell className="text-right">{brl(receipt.materials_cost)}</TableCell><TableCell className="text-right">{brl(receipt.labor_other_cost)}</TableCell>
                  <TableCell className="text-xs">{(receipt.allocations || []).map((allocation: Record<string, any>) => `${costLabel[allocation.cost_type] || allocation.cost_type}: ${brl(allocation.amount)}`).join(" · ")}{(receipt.adjustments || []).length ? ` · ajustes: ${(receipt.adjustments as Array<Record<string, any>>).map((adjustment) => `${brl(adjustment.amount)} (${adjustment.reason})`).join("; ")}` : ""}</TableCell>
                  <TableCell>{receipt.warehouse || "-"}</TableCell><TableCell>{receipt.responsible || "-"}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="custos" className="mt-4">
          <SectionCard title="Custo estimado x realizado x em processo" description="Estimado = estrutura da versão congelada. Realizado = o que foi consumido e apropriado aos lotes. Em processo = consumido e ainda não apropriado a unidades concluídas.">
            <dl className="grid gap-4 sm:grid-cols-4 text-sm">
              {[["Estimado: materiais", costs.estimated_materials], ["Estimado: mão de obra", costs.estimated_labor], ["Estimado: indiretos/outros", costs.estimated_other], ["Estimado: total", costs.estimated_total],
                ["Consumido (materiais)", costs.consumed_materials], ["Apropriado aos lotes (materiais)", costs.allocated_materials], ["Em processo (materiais)", costs.in_process_materials], ["Mão de obra/indiretos aplicados", costs.labor_other_applied],
                ["Recebido em estoque (custo)", costs.received_cost], ["Ajustes de custo", costs.adjustments]].map(([label, value]) => (
                <div key={String(label)}><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{brl(value)}</dd></div>
              ))}
            </dl>
          </SectionCard>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <SectionCard title="Histórico da ordem">
            <DataTable headers={["Quando", "Evento", "Detalhe", "Responsável"]} empty={!detail.events.length} stickyHeader viewportClassName="max-h-[50vh]">
              {detail.events.map((event, index) => <TableRow key={index}><TableCell className="whitespace-nowrap">{dateBr(event.created_at)}</TableCell><TableCell>{event.event}</TableCell><TableCell>{event.description}</TableCell><TableCell>{event.actor || "-"}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>
      {detail.plan.some((row) => Number(row.shortage) > 0) ? <p className="flex items-center gap-2 text-sm text-amber-700"><TriangleAlert className="h-4 w-4" />Há material faltando para esta ordem: veja o planejamento acima.</p> : null}
    </PageShell>
  )
}
