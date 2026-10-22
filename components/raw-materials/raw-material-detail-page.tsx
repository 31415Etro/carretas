"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ArrowLeft, Banknote, Boxes, Pencil, PackageCheck, RefreshCw, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { RawMaterialSheet, type RawMaterialSheetTarget } from "@/components/raw-materials/raw-material-sheet"
import { entityHref, type EntityKind } from "@/lib/entity-links"
import { formatNcm, stockSituation, type RawMaterialForm } from "@/lib/raw-materials"

type Detail = {
  material: Record<string, any>
  availability: { physical: number; reserved: number; available: number; incoming: number; projected: number }
  suppliers: Array<Record<string, any>>
  stock_by_warehouse: Array<Record<string, any>>
  purchases: Array<Record<string, any>>
  movements: Array<Record<string, any>>
  kits: Array<Record<string, any>>
  production: Array<Record<string, any>>
  ncm: Record<string, string | null>
  sku_history: Array<Record<string, any>>
}
type Payload = { detail: Detail; hasHistory: boolean; form: RawMaterialForm }
const tones = { danger: "bg-red-100 text-red-800", warning: "bg-amber-100 text-amber-800", muted: "bg-slate-100 text-slate-700", ok: "bg-emerald-100 text-emerald-800" }

function Link2({ kind, id, children }: { kind: EntityKind; id: string; children: React.ReactNode }) {
  const href = entityHref(kind, id)
  return href ? <Link href={href} className="text-primary underline-offset-2 hover:underline">{children}</Link> : <>{children}</>
}
const Item = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">-</span>}</dd></div>
)

export function RawMaterialDetailPage({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<RawMaterialSheetTarget>(null)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setData(await api<Payload>(`/api/materias-primas/${id}`)) } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a matéria-prima.") } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (!data) {
    return (
      <PageShell title="Matéria-prima" description="Carregando os dados do cadastro..." actions={<Button variant="outline" asChild><Link href="/materias-primas"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : ""}</p>}
      </PageShell>
    )
  }
  const { detail, hasHistory, form } = data
  const m = detail.material
  const a = detail.availability
  const situation = stockSituation({ physical: Number(a.physical), available: Number(a.available), incoming: Number(a.incoming), minimumStock: Number(m.minimum_stock), reorderPoint: Number(m.reorder_point) })
  const dims = [["Comprimento", m.length], ["Largura", m.width], ["Altura", m.height], ["Espessura", m.thickness], ["Diâmetro", m.diameter]].filter(([, value]) => Number(value) > 0)
  const attributes = Object.entries((m.technical_attributes || {}) as Record<string, string>)

  return (
    <PageShell title={m.name} description={`${m.internal_code || "Sem SKU"} · ${[m.category, m.subcategory].filter(Boolean).join(" / ") || "Sem categoria"} · unidade ${m.unit}`}
      actions={<>
        <Button variant="outline" asChild><Link href="/materias-primas"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        <Button onClick={() => setSheet({ id, form, hasHistory, originalSku: m.internal_code || "" })}><Pencil className="h-4 w-4" />Editar</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={m.status} />
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${tones[situation.tone]}`}>{situation.label}</span>
        {m.allows_sale ? <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Disponível para venda</span> : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Consumo interno</span>}
        {m.ncm ? <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">NCM {formatNcm(String(m.ncm))}</span> : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Sem NCM</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Custo vigente" value={brl(m.unit_cost)} note={`última compra ${brl(m.last_purchase_cost)}`} icon={Banknote} />
        <MetricCard title="Físico" value={`${qty(a.physical)} ${m.unit}`} note="nos depósitos da empresa" icon={Boxes} />
        <MetricCard title="Reservado" value={`${qty(a.reserved)} ${m.unit}`} note="para ordens de produção e OS" icon={PackageCheck} />
        <MetricCard title="Disponível" value={`${qty(a.available)} ${m.unit}`} note={Number(m.minimum_stock) > 0 ? `mínimo ${qty(m.minimum_stock)}` : "sem estoque mínimo"} icon={AlertTriangle} />
        <MetricCard title="A receber" value={`${qty(a.incoming)} ${m.unit}`} note={`projetado ${qty(a.projected)} ${m.unit}`} icon={ShoppingCart} />
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="fornecedores">Fornecedores ({detail.suppliers.length})</TabsTrigger>
          <TabsTrigger value="estoque">Estoque e movimentações ({detail.movements.length})</TabsTrigger>
          <TabsTrigger value="compras">Compras ({detail.purchases.length})</TabsTrigger>
          <TabsTrigger value="kits">Kits e produtos ({detail.kits.length})</TabsTrigger>
          <TabsTrigger value="producao">Produção ({detail.production.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="mt-4 grid gap-4 lg:grid-cols-2">
          <SectionCard title="Cadastro">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="SKU" value={<span className="font-mono">{m.internal_code}</span>} />
              <Item label="Tipo de material" value={m.material_kind} />
              <Item label="Unidade" value={m.unit} />
              <Item label="Depósito padrão" value={detail.stock_by_warehouse.find((w) => w.warehouse_id === m.warehouse_id)?.warehouse} />
              <Item label="Descrição técnica" value={m.description} />
              <Item label="Observações" value={m.notes} />
            </dl>
          </SectionCard>
          <SectionCard title="Especificações técnicas">
            <dl className="grid gap-4 sm:grid-cols-2">
              {dims.map(([label, value]) => <Item key={String(label)} label={String(label)} value={`${qty(value)} mm`} />)}
              <Item label="Peso líquido" value={Number(m.net_weight) > 0 ? `${qty(m.net_weight)} kg` : ""} />
              <Item label="Peso bruto" value={Number(m.gross_weight) > 0 ? `${qty(m.gross_weight)} kg` : ""} />
              {attributes.map(([key, value]) => <Item key={key} label={key} value={String(value)} />)}
            </dl>
            {!dims.length && !attributes.length && !(Number(m.net_weight) > 0) ? <p className="text-sm text-muted-foreground">Nenhuma característica técnica informada.</p> : null}
          </SectionCard>
          <SectionCard title="Reposição e compras">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="Estoque mínimo" value={Number(m.minimum_stock) > 0 ? `${qty(m.minimum_stock)} ${m.unit}` : ""} />
              <Item label="Ponto de reposição" value={Number(m.reorder_point) > 0 ? `${qty(m.reorder_point)} ${m.unit}` : ""} />
              <Item label="Estoque máximo" value={Number(m.maximum_stock) > 0 ? `${qty(m.maximum_stock)} ${m.unit}` : ""} />
              <Item label="Prazo de reposição" value={m.lead_time_days ? `${m.lead_time_days} dias` : ""} />
              <Item label="Compra mínima" value={m.min_purchase_qty ? `${qty(m.min_purchase_qty)} ${m.unit}` : ""} />
              <Item label="Custo médio" value={brl(m.average_cost)} />
            </dl>
          </SectionCard>
          <SectionCard title="Classificação fiscal e venda">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="NCM" value={m.ncm ? <span className="font-mono">{formatNcm(String(m.ncm))}</span> : ""} />
              <Item label="Descrição oficial" value={detail.ncm.description} />
              <Item label="Fonte" value={detail.ncm.source} />
              <Item label="Confirmado por" value={detail.ncm.confirmed_by ? `${detail.ncm.confirmed_by} em ${dateBr(detail.ncm.confirmed_at)}` : ""} />
              <Item label="Disponível para venda" value={m.allows_sale ? `Sim · ${brl(m.sale_price)}` : "Não (consumo interno)"} />
            </dl>
          </SectionCard>
          {(m.photo_url || m.technical_sheet_url) ? (
            <SectionCard title="Arquivos">
              <div className="flex flex-wrap items-center gap-4">
                {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-28 w-28 rounded-md border object-cover" /> : null}
                {m.technical_sheet_url ? <Button variant="outline" asChild><a href={m.technical_sheet_url} target="_blank" rel="noreferrer">Abrir ficha técnica</a></Button> : null}
              </div>
            </SectionCard>
          ) : null}
          {detail.sku_history.length ? (
            <SectionCard title="Histórico de SKU">
              <ul className="space-y-1 text-sm">{detail.sku_history.map((entry, index) => <li key={index}><span className="font-mono">{entry.old_sku || "-"}</span> → <span className="font-mono">{entry.new_sku}</span> · {entry.reason} <span className="text-muted-foreground">({entry.changed_by || "sistema"}, {dateBr(entry.changed_at)})</span></li>)}</ul>
            </SectionCard>
          ) : null}
        </TabsContent>

        <TabsContent value="fornecedores" className="mt-4">
          <SectionCard title="Fornecedores" description="O principal é o sugerido nas solicitações de compra da produção.">
            <DataTable headers={["Fornecedor", "CNPJ", "Código no fornecedor", "Último custo", "Prazo", "Compra mínima", "Papel"]} empty={!detail.suppliers.length}>
              {detail.suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link2 kind="supplier" id={s.supplier_id}>{s.supplier_name}</Link2></TableCell><TableCell>{s.supplier_document || "-"}</TableCell><TableCell>{s.supplier_code || "-"}</TableCell>
                  <TableCell>{s.last_cost ? brl(s.last_cost) : "-"}</TableCell><TableCell>{s.lead_time_days ? `${s.lead_time_days} dias` : "-"}</TableCell><TableCell>{s.min_purchase_qty ? qty(s.min_purchase_qty) : "-"}</TableCell>
                  <TableCell>{s.is_primary ? <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Principal</span> : "Alternativo"}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="estoque" className="mt-4 space-y-4">
          <SectionCard title="Saldo por depósito (empresa selecionada)">
            <DataTable headers={["Depósito", "Código", "Quantidade"]} empty={!detail.stock_by_warehouse.length}>
              {detail.stock_by_warehouse.map((w) => <TableRow key={w.warehouse_id}><TableCell>{w.warehouse}</TableCell><TableCell>{w.code || "-"}</TableCell><TableCell className="text-right">{qty(w.quantity)} {m.unit}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
          <SectionCard title="Histórico de movimentações" description="Últimas 100 movimentações dos depósitos da empresa.">
            <DataTable headers={["Data", "Tipo", "Quantidade", "Custo unit.", "Origem", "Destino", "Saldo após", "Documento", "Responsável"]} empty={!detail.movements.length} stickyHeader viewportClassName="max-h-[50vh]">
              {detail.movements.map((mv) => (
                <TableRow key={mv.id}>
                  <TableCell className="whitespace-nowrap">{dateBr(mv.occurred_at)}</TableCell><TableCell>{mv.movement_type}</TableCell><TableCell className="text-right">{qty(mv.quantity)}</TableCell>
                  <TableCell className="text-right">{brl(mv.unit_cost)}</TableCell><TableCell>{mv.from_warehouse || "-"}</TableCell><TableCell>{mv.to_warehouse || "-"}</TableCell>
                  <TableCell className="text-right">{mv.balance_after === null ? "-" : qty(mv.balance_after)}</TableCell><TableCell>{mv.document_reference || "-"}</TableCell><TableCell>{mv.responsible || "-"}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="compras" className="mt-4">
          <SectionCard title="Histórico de compras" description="Pedidos de compra da empresa que incluem este material.">
            <DataTable headers={["Pedido", "Data", "Fornecedor", "Status", "Quantidade", "Recebido", "Custo unit.", "Total"]} empty={!detail.purchases.length}>
              {detail.purchases.map((p, index) => (
                <TableRow key={`${p.purchase_order_id}-${index}`}>
                  <TableCell><Link2 kind="purchaseOrder" id={p.purchase_order_id}>{p.order_number}</Link2></TableCell><TableCell>{dateBr(p.order_date)}</TableCell><TableCell>{p.supplier_name}</TableCell><TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-right">{qty(p.quantity)}</TableCell><TableCell className="text-right">{qty(p.received_quantity)}</TableCell><TableCell className="text-right">{brl(p.unit_cost)}</TableCell><TableCell className="text-right">{brl(p.total)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="kits" className="mt-4">
          <SectionCard title="Kits em que é usada" description="Do material ao kit e ao produto final que o utiliza.">
            <DataTable headers={["Kit", "SKU", "Versão", "Situação", "Quantidade", "Perda", "Produtos finais que usam o kit"]} empty={!detail.kits.length}>
              {detail.kits.map((k) => (
                <TableRow key={k.version_id}>
                  <TableCell><Link2 kind="kit" id={k.kit_id}>{k.kit_name}</Link2></TableCell><TableCell className="font-mono text-xs">{k.kit_sku || "-"}</TableCell><TableCell>v{k.version}</TableCell><TableCell><StatusBadge status={k.version_status} /></TableCell>
                  <TableCell className="text-right">{qty(k.quantity)} {k.unit}</TableCell><TableCell className="text-right">{Number(k.loss_percent) > 0 ? `${qty(k.loss_percent)}%` : "-"}</TableCell>
                  <TableCell>{k.products.length ? k.products.map((p: Record<string, string>, index: number) => <span key={p.product_id}>{index ? ", " : ""}<Link2 kind="product" id={p.product_id}>{p.product_name}</Link2></span>) : <span className="text-muted-foreground">Nenhum produto ativo</span>}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="producao" className="mt-4">
          <SectionCard title="Ordens de produção que usam este material" description="Necessidade, reserva e consumo por ordem da empresa.">
            <DataTable headers={["Ordem", "Produto", "Status", "Necessário", "Reservado", "Consumido"]} empty={!detail.production.length}>
              {detail.production.map((p) => (
                <TableRow key={p.production_order_id}>
                  <TableCell><Link2 kind="productionOrder" id={p.production_order_id}>{p.code}</Link2></TableCell><TableCell>{p.product_name}</TableCell><TableCell><StatusBadge status={String(p.status).replace("Concluida", "Concluída").replace("producao", "produção")} /></TableCell>
                  <TableCell className="text-right">{qty(p.required)}</TableCell><TableCell className="text-right">{qty(p.reserved)}</TableCell><TableCell className="text-right">{qty(p.consumed)}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <RawMaterialSheet target={sheet} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void load() }} />
    </PageShell>
  )
}
