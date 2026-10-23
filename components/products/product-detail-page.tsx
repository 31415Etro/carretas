"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Banknote, CheckCircle2, Factory, GitCompare, Layers, PackageCheck, Pencil, Plus, RefreshCw, TriangleAlert, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { EngineeringTab } from "@/components/products/engineering-tab"
import { PhotoGallery } from "@/components/products/photo-gallery"
import { ProductSheet, type ProductSheetTarget } from "@/components/products/product-sheet"
import { entityHref } from "@/lib/entity-links"
import { formFromProductDetail, margin } from "@/lib/products"
import { versionStatusLabel } from "@/lib/kits"

type Detail = {
  product: Record<string, any>; availability: Record<string, any> | null; in_production: Record<string, any>; stock_by_warehouse: Array<Record<string, any>>; movements: Array<Record<string, any>>
  orders: Array<Record<string, any>>; documents: Array<Record<string, any>>; current_version_id: string | null; shown_version_id: string | null; versions: Array<Record<string, any>>
  kits: Array<Record<string, any>>; cost: Record<string, any> | null; cost_of_version: Record<string, any> | null; cost_history: Array<Record<string, any>>; real_cost: Record<string, any>
  change_log: Array<Record<string, any>>; sku_history: Array<Record<string, any>>; used_in_production: boolean
}
type Explosion = { kits: Array<Record<string, any>>; consolidated: Array<Record<string, any>>; materials_cost: number; quantity: number }
type Capacity = { immediate_capacity: number; projected_capacity: number; materials: Array<Record<string, any>>; company_name: string; warehouses: Array<Record<string, any>>; computed_at: string; note: string }
type Diff = { kit_id: string; sku: string; name: string; qty_a: number | null; qty_b: number | null; cost_a: number; cost_b: number; change: string }
const changeLabel: Record<string, string> = { adicionado: "Adicionado", removido: "Removido", alterado: "Alterado", igual: "Igual" }
const changeTone: Record<string, string> = { adicionado: "bg-emerald-100 text-emerald-800", removido: "bg-red-100 text-red-800", alterado: "bg-amber-100 text-amber-800", igual: "bg-slate-100 text-slate-700" }
const actionLabel: Record<string, string> = { versao_criada: "Versão criada", versao_ativada: "Versão ativada", versao_obsoleta: "Versão obsoleta", kit_adicionado: "Kit adicionado", kit_alterado: "Quantidade do kit alterada", kit_removido: "Kit removido", cadastro_alterado: "Cadastro alterado", preco_alterado: "Preço alterado" }
const Item = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">-</span>}</dd></div>
)

export function ProductDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ProductSheetTarget>(null)
  const [compare, setCompare] = useState({ a: "", b: "" })
  const [differences, setDifferences] = useState<Diff[] | null>(null)
  const [notice, setNotice] = useState("")
  const [explosionQty, setExplosionQty] = useState("1")
  const [explosion, setExplosion] = useState<Explosion | null>(null)
  const [explosionError, setExplosionError] = useState("")
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [capacityError, setCapacityError] = useState("")

  const load = useCallback(async (version: string | null = versionId) => {
    setLoading(true); setError("")
    try { setDetail((await api<{ detail: Detail }>(`/api/produtos/${id}${version ? `?versao=${version}` : ""}`)).detail) } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar o produto.") } finally { setLoading(false) }
  }, [id, versionId])
  useEffect(() => { void load() }, [load])

  const shownId = detail?.shown_version_id
  const runExplosion = useCallback(async (quantity: string) => {
    setExplosionError("")
    try {
      const amount = Number(quantity.replace(",", "."))
      const data = await api<{ explosion: Explosion }>(`/api/produtos/${id}?explosao=${amount}${shownId ? `&versao=${shownId}` : ""}`)
      setExplosion(data.explosion)
    } catch (reason) { setExplosion(null); setExplosionError(reason instanceof Error ? reason.message : "Erro ao calcular a explosão.") }
  }, [id, shownId])
  const runCapacity = useCallback(async () => {
    setCapacityError("")
    try { setCapacity((await api<{ capacity: Capacity }>(`/api/produtos/${id}?capacidade=1${shownId ? `&versao=${shownId}` : ""}`)).capacity) } catch (reason) { setCapacity(null); setCapacityError(reason instanceof Error ? reason.message : "Erro ao calcular a capacidade.") }
  }, [id, shownId])
  useEffect(() => { if (shownId) { void runExplosion("1"); void runCapacity() } else { setExplosion(null); setCapacity(null) } }, [shownId, runExplosion, runCapacity])

  async function runCompare(a: string, b: string) {
    setCompare({ a, b })
    if (!a || !b || a === b) { setDifferences(null); return }
    try { setDifferences((await api<{ differences: Diff[] }>(`/api/produtos/${id}?comparar=${a},${b}`)).differences) } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Erro ao comparar.") }
  }
  async function activate(version: string) {
    try { await api(`/api/produtos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", versionId: version }) }); setNotice("Versão ativada: agora é a vigente."); setVersionId(null); await load(null) } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Erro ao ativar.") }
  }

  if (!detail) {
    return (
      <PageShell title="Produto" description="Carregando os dados do produto..." actions={<Button variant="outline" asChild><Link href="/produtos"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : ""}</p>}
      </PageShell>
    )
  }
  const product = detail.product
  const shown = detail.versions.find((version) => version.id === detail.shown_version_id)
  const current = detail.versions.find((version) => version.id === detail.current_version_id)
  const viewingOther = shown && current && shown.id !== current.id
  const editorForm = () => formFromProductDetail(detail)
  const gross = detail.cost ? margin(Number(product.sale_price || 0), Number(detail.cost.total)) : null
  const av = detail.availability || { physical: 0, reserved: 0, available: 0 }

  return (
    <PageShell title={product.name} description={`${product.internal_code}${product.product_model ? ` · ${product.product_model}` : ""} · ${product.category || "Sem categoria"} · ${current ? `estrutura v${current.version}` : "sem estrutura"}`}
      actions={<>
        <Button variant="outline" asChild><Link href="/produtos"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        <Button variant="outline" onClick={() => setSheet({ mode: "header", productId: id, form: editorForm(), originalSku: product.internal_code || "" })}><Pencil className="h-4 w-4" />Dados do produto</Button>
        <Button onClick={() => setSheet({ mode: "structure", productId: id, form: editorForm(), baseVersion: shown?.version || 0, draftVersionId: shown?.status === "Rascunho" ? shown.id : undefined, locked: Boolean(shown && shown.status !== "Rascunho") })}>
          <Plus className="h-4 w-4" />{shown?.status === "Rascunho" ? `Editar rascunho v${shown.version}` : shown ? "Nova versão da estrutura" : "Definir estrutura"}
        </Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={product.status} />
        {current ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${current.status === "Ativa" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>v{current.version} {versionStatusLabel(current.status)}</span> : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Sem estrutura de fabricação</span>}
        {detail.used_in_production ? <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Já usado em produção: versões protegidas</span> : null}
        {product.available_for_quote === false ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Fora do orçamento</span> : null}
      </div>
      {viewingOther ? <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">Você está vendo a <strong>v{shown!.version} ({versionStatusLabel(shown!.status)})</strong>, não a vigente (v{current!.version}). <button type="button" className="underline" onClick={() => { setVersionId(null); void load(null) }}>Voltar para a vigente</button></p> : null}
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Preço de venda" value={brl(product.sale_price)} note={gross ? `margem ${brl(gross.value)}${gross.percent === null ? "" : ` (${gross.percent.toLocaleString("pt-BR")}%)`}` : "sem estrutura para calcular a margem"} icon={Banknote} />
        <MetricCard title="Custo estimado" value={detail.cost ? brl(detail.cost.total) : "-"} note={shown ? `estrutura v${shown.version}, custo vigente das matérias-primas` : "sem estrutura"} icon={Layers} />
        <MetricCard title="Disponível" value={qty(av.available)} note={`físico ${qty(av.physical)} · reservado ${qty(av.reserved)} (empresa selecionada)`} icon={Warehouse} />
        <MetricCard title="Em produção" value={qty(detail.in_production?.quantity)} note={detail.in_production?.expected_end ? `previsão ${dateBr(detail.in_production.expected_end)}` : "sem ordens abertas"} icon={Factory} />
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="fotografias">Fotografias</TabsTrigger>
          <TabsTrigger value="kits">Kits ({detail.kits.length})</TabsTrigger>
          <TabsTrigger value="estrutura">Estrutura completa</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
          <TabsTrigger value="producao">Produção ({detail.orders.length})</TabsTrigger>
          <TabsTrigger value="engenharia">Engenharia</TabsTrigger>
          <TabsTrigger value="homologacao">Engenharia e Homologação</TabsTrigger>
          <TabsTrigger value="historico">Histórico ({detail.change_log.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="fotografias" className="mt-4"><PhotoGallery productId={id} onChange={() => void load()} /></TabsContent>

        <TabsContent value="geral" className="mt-4 grid gap-4 lg:grid-cols-2">
          <SectionCard title="Identificação">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="SKU" value={<span className="font-mono">{product.internal_code}</span>} /><Item label="Status" value={product.status} />
              <Item label="Modelo" value={product.product_model} /><Item label="Linha" value={product.product_line} />
              <Item label="Categoria" value={product.category} /><Item label="Referência interna" value={product.internal_ref} />
              <Item label="Descrição" value={product.description} /><Item label="Última alteração" value={dateBr(product.updated_at)} />
            </dl>
          </SectionCard>
          <SectionCard title="Comercial e fiscal">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="Preço de venda" value={brl(product.sale_price)} /><Item label="Unidade" value={product.unit} />
              <Item label="Prazo de entrega" value={product.lead_time_days ? `${product.lead_time_days} dias` : null} /><Item label="Garantia" value={Number(product.warranty_months) ? `${product.warranty_months} meses` : null} />
              <Item label="Orçamento" value={product.available_for_quote === false ? "Indisponível" : "Disponível"} /><Item label="Venda" value={product.allows_sale === false ? "Indisponível" : "Disponível"} />
              <Item label="NCM" value={product.ncm ? <span>{product.ncm}{product.ncm_confirmed_by ? <span className="text-xs text-muted-foreground"> · confirmado por {product.ncm_confirmed_by}</span> : null}</span> : null} /><Item label="Fabricação" value={product.make_to_order ? "Sob encomenda" : "Para estoque ou encomenda"} />
            </dl>
          </SectionCard>
          {product.photo_url ? <SectionCard title="Foto"><img src={product.photo_url} alt={product.name} className="h-40 rounded-md border object-cover" /></SectionCard> : null}
          <SectionCard title="Documentos">
            {detail.documents.length || product.technical_sheet_url ? (
              <ul className="space-y-1 text-sm">
                {product.technical_sheet_url ? <li><a className="text-primary underline-offset-2 hover:underline" href={product.technical_sheet_url} target="_blank" rel="noreferrer">Ficha técnica</a></li> : null}
                {detail.documents.map((document) => <li key={document.id}><a className="text-primary underline-offset-2 hover:underline" href={document.url} target="_blank" rel="noreferrer">{document.name}</a> <span className="text-xs text-muted-foreground">· {document.kind}</span></li>)}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="kits" className="mt-4">
          <SectionCard title={shown ? `Kits da v${shown.version} (${versionStatusLabel(shown.status)})` : "Kits do produto"} description="Vínculos por ID e versão do kit; as matérias-primas ficam dentro dos kits.">
            <DataTable headers={["Kit", "SKU", "Versão do kit", "Qtd. por produto", "Custo do kit", "Custo na linha", "Matérias-primas"]} empty={!detail.kits.length}>
              {detail.kits.map((kit) => (
                <TableRow key={kit.id}>
                  <TableCell><Link href={entityHref("kit", kit.kit_id) || "#"} className="font-medium text-primary underline-offset-2 hover:underline">{kit.name}</Link></TableCell>
                  <TableCell className="font-mono text-xs">{kit.sku}</TableCell>
                  <TableCell>{kit.kit_version ? `v${kit.kit_version}` : "-"} <span className="text-xs text-muted-foreground">{kit.follows_active ? "(acompanha a vigente)" : "(fixada)"}</span></TableCell>
                  <TableCell className="text-right">{qty(kit.quantity)}</TableCell>
                  <TableCell className="text-right">{brl(kit.kit_cost)}</TableCell>
                  <TableCell className="text-right font-medium">{brl(kit.line_cost)}</TableCell>
                  <TableCell className="text-center">{kit.components_count}</TableCell>
                </TableRow>
              ))}
            </DataTable>
            {!detail.kits.length ? <p className="mt-2 text-sm text-muted-foreground">Este produto ainda não tem kits. Use "Definir estrutura" para vinculá-los.</p> : null}
          </SectionCard>
        </TabsContent>

        <TabsContent value="estrutura" className="mt-4 space-y-4">
          {!shown ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Sem estrutura de fabricação: defina os kits para ver a explosão de materiais.</p> : (
            <>
              <SectionCard title="Quantas unidades posso fabricar?" description="Consulta apenas: não reserva, não consome e não movimenta estoque.">
                {capacityError ? <p className="text-sm text-destructive">{capacityError}</p> : null}
                {capacity ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">Imediata</div><div className="text-3xl font-semibold">{qty(capacity.immediate_capacity)}</div><div className="text-xs text-muted-foreground">só saldo físico livre de {capacity.company_name} (descontadas as reservas)</div></div>
                      <div className="rounded-md border p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">Projetada</div><div className="text-3xl font-semibold">{qty(capacity.projected_capacity)}</div><div className="text-xs text-muted-foreground">inclui compras aprovadas ainda não recebidas</div></div>
                    </div>
                    <DataTable headers={["Matéria-prima", "Por unidade", "Disponível", "A receber", "Fabrica (imediato)", "Fabrica (projetado)"]} empty={!capacity.materials.length}>
                      {capacity.materials.map((material) => (
                        <TableRow key={material.material_id} className={material.limits_immediate ? "bg-amber-50" : ""}>
                          <TableCell>{material.name} <span className="font-mono text-xs text-muted-foreground">{material.sku}</span>{material.limits_immediate ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">LIMITA</span> : null}</TableCell>
                          <TableCell className="text-right">{qty(material.required_per_unit, 4)} {material.unit}</TableCell>
                          <TableCell className="text-right">{qty(material.available)} {material.unit}</TableCell>
                          <TableCell className="text-right">{Number(material.incoming) ? `${qty(material.incoming)} ${material.unit}` : "-"}</TableCell>
                          <TableCell className="text-right">{qty(material.immediate_units)}</TableCell>
                          <TableCell className="text-right">{qty(material.projected_units)}</TableCell>
                        </TableRow>
                      ))}
                    </DataTable>
                    <p className="text-xs text-muted-foreground">{capacity.note} Depósitos considerados: {capacity.warehouses.map((warehouse) => warehouse.name).join(", ") || "nenhum"} · calculado em {dateBr(capacity.computed_at)}.</p>
                  </div>
                ) : capacityError ? null : <p className="text-sm text-muted-foreground">Calculando...</p>}
              </SectionCard>

              <SectionCard title="Explosão de materiais" description="Produto → kits → matérias-primas, respeitando versões, perdas e conversão de unidades.">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span>Quantidade de produtos:</span>
                  <Input className="w-24" inputMode="decimal" value={explosionQty} aria-label="Quantidade de produtos" onChange={(event) => setExplosionQty(event.target.value)} />
                  <Button variant="outline" onClick={() => void runExplosion(explosionQty)}>Calcular</Button>
                </div>
                {explosionError ? <p className="flex items-center gap-1 text-sm text-destructive"><TriangleAlert className="h-4 w-4" />{explosionError}</p> : null}
                {explosion ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {explosion.kits.map((kit) => (
                        <details key={kit.kit_id} open className="rounded-md border">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{kit.name} <span className="font-mono text-xs text-muted-foreground">{kit.sku} · v{kit.kit_version}</span> — {qty(kit.quantity)} kit(s) · {brl(kit.cost)}</summary>
                          <ul className="divide-y border-t text-sm">
                            {kit.components.map((component: Record<string, any>) => <li key={component.material_id} className="flex flex-wrap justify-between gap-2 px-6 py-1.5"><span>{component.name} <span className="font-mono text-xs text-muted-foreground">{component.sku}</span></span><span>{qty(component.required, 4)} {component.unit} · {brl(component.cost)}</span></li>)}
                          </ul>
                        </details>
                      ))}
                    </div>
                    <DataTable headers={["Matéria-prima (consolidada)", "Necessário", "Disponível", "Falta", "Origem", "Custo"]} empty={!explosion.consolidated.length}>
                      {explosion.consolidated.map((material) => (
                        <TableRow key={material.material_id}>
                          <TableCell>{material.name} <span className="font-mono text-xs text-muted-foreground">{material.sku}</span></TableCell>
                          <TableCell className="text-right">{qty(material.required, 4)} {material.unit}</TableCell>
                          <TableCell className="text-right">{qty(material.available)} {material.unit}</TableCell>
                          <TableCell className={`text-right ${Number(material.shortage) > 0 ? "font-medium text-destructive" : ""}`}>{Number(material.shortage) > 0 ? `${qty(material.shortage, 4)} ${material.unit}` : "-"}</TableCell>
                          <TableCell className="text-xs">{(material.origins || []).map((origin: Record<string, any>) => `${origin.kit_name}: ${qty(origin.required, 4)}`).join(" · ")}</TableCell>
                          <TableCell className="text-right">{brl(material.cost)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow><TableCell className="font-semibold">Custo de materiais</TableCell><TableCell colSpan={4} /><TableCell className="text-right font-semibold">{brl(explosion.materials_cost)}</TableCell></TableRow>
                    </DataTable>
                  </div>
                ) : null}
              </SectionCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="custos" className="mt-4 space-y-4">
          <SectionCard title="Custo estimado atual" description="Calculado agora com o custo vigente das matérias-primas. Não altera o custo de ordens já produzidas.">
            {detail.cost ? (
              <dl className="grid gap-4 sm:grid-cols-5">
                <Item label="Materiais" value={brl(detail.cost.materials)} /><Item label="Mão de obra" value={brl(detail.cost.labor)} /><Item label="Indiretos" value={brl(detail.cost.overhead)} /><Item label="Outros" value={brl(detail.cost.other)} />
                <Item label="Total" value={<strong>{brl(detail.cost.total)}</strong>} />
                <Item label="Preço de venda" value={brl(detail.cost.price)} /><Item label="Margem bruta" value={brl(detail.cost.margin)} /><Item label="Margem %" value={detail.cost.margin_percent === null ? null : `${Number(detail.cost.margin_percent).toLocaleString("pt-BR")}%`} />
              </dl>
            ) : <p className="text-sm text-muted-foreground">Sem estrutura: não há custo estimado.</p>}
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Custo da versão" description="Estimativa gravada quando a versão foi criada ou ativada.">
              {detail.cost_of_version ? <p className="text-sm">{brl(detail.cost_of_version.total)} em {dateBr(detail.cost_of_version.computed_at)}{detail.cost && Number(detail.cost.total) !== Number(detail.cost_of_version.total) ? <span className="block text-muted-foreground">Diferença para o custo atual: {brl(Number(detail.cost.total) - Number(detail.cost_of_version.total))}</span> : null}</p> : <p className="text-sm text-muted-foreground">-</p>}
            </SectionCard>
            <SectionCard title="Custo real das ordens executadas" description="Média ponderada do que foi efetivamente recebido no estoque de acabados.">
              {Number(detail.real_cost?.lots) > 0 ? <p className="text-sm">{brl(detail.real_cost.unit_cost)} por unidade · {qty(detail.real_cost.quantity)} unidade(s) em {detail.real_cost.lots} recebimento(s) · total {brl(detail.real_cost.total_cost)}</p> : <p className="text-sm text-muted-foreground">Nenhuma ordem concluída ainda.</p>}
            </SectionCard>
          </div>
          <SectionCard title="Histórico de estimativas" description="Uma linha é gravada quando o custo calculado muda.">
            <DataTable headers={["Data", "Versão", "Materiais", "Custo estimado"]} empty={!detail.cost_history.length}>
              {detail.cost_history.map((entry, index) => <TableRow key={index}><TableCell>{dateBr(entry.computed_at)}</TableCell><TableCell>v{entry.version}</TableCell><TableCell className="text-right">{brl(entry.materials_cost)}</TableCell><TableCell className="text-right">{brl(entry.total_cost)}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="estoque" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard title="Físico" value={qty(av.physical)} note="produtos acabados" icon={PackageCheck} />
            <MetricCard title="Reservado" value={qty(av.reserved)} note="separado para pedidos" icon={PackageCheck} />
            <MetricCard title="Disponível" value={qty(av.available)} note="físico − reservado" icon={PackageCheck} />
          </div>
          <SectionCard title="Saldo por depósito" description="Só a empresa selecionada. O estoque de acabados nasce da conclusão da produção; cadastrar o produto não cria saldo.">
            <DataTable headers={["Depósito", "Código", "Quantidade"]} empty={!detail.stock_by_warehouse.length}>
              {detail.stock_by_warehouse.map((row) => <TableRow key={row.warehouse_id}><TableCell>{row.warehouse}</TableCell><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell className="text-right">{qty(row.quantity)}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
          <SectionCard title="Movimentações recentes">
            <DataTable headers={["Data", "Tipo", "Quantidade", "Custo unit.", "Origem", "Destino", "Documento"]} empty={!detail.movements.length} stickyHeader viewportClassName="max-h-[45vh]">
              {detail.movements.map((move) => <TableRow key={move.id}><TableCell className="whitespace-nowrap">{dateBr(move.occurred_at)}</TableCell><TableCell>{move.movement_type}</TableCell><TableCell className="text-right">{qty(move.quantity)}</TableCell><TableCell className="text-right">{move.unit_cost ? brl(move.unit_cost) : "-"}</TableCell><TableCell>{move.from_warehouse || "-"}</TableCell><TableCell>{move.to_warehouse || "-"}</TableCell><TableCell>{move.document_reference || "-"}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="producao" className="mt-4">
          <SectionCard title="Ordens de produção do produto" description="Cada ordem usa uma cópia congelada da estrutura (rastreável) e é da empresa selecionada.">
            <DataTable headers={["Ordem", "Pedido de venda", "Estrutura", "Situação", "Quantidade", "Produzido", "Previsão"]} empty={!detail.orders.length}>
              {detail.orders.map((order) => <TableRow key={order.production_order_id}><TableCell className="font-mono text-xs">{order.code}</TableCell><TableCell>{order.sales_order || "-"}</TableCell><TableCell>v{order.bom_version}</TableCell><TableCell>{order.status}</TableCell><TableCell className="text-right">{qty(order.quantity)}</TableCell><TableCell className="text-right">{qty(order.produced_quantity)}</TableCell><TableCell>{dateBr(order.planned_end)}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="engenharia" className="mt-4 space-y-4">
          <SectionCard title="Especificações técnicas">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Item label="Comprimento" value={Number(product.length) ? `${qty(product.length)} cm` : null} /><Item label="Largura" value={Number(product.width) ? `${qty(product.width)} cm` : null} /><Item label="Altura" value={Number(product.height) ? `${qty(product.height)} cm` : null} />
              <Item label="Peso vazio" value={Number(product.net_weight) ? `${qty(product.net_weight)} kg` : null} /><Item label="Peso bruto" value={Number(product.gross_weight) ? `${qty(product.gross_weight)} kg` : null} /><Item label="Capacidade de carga" value={product.payload_capacity ? `${qty(product.payload_capacity)} kg` : null} />
              <Item label="Eixos" value={product.axle_count} /><Item label="Acabamento" value={product.finish_type} /><Item label="Características estruturais" value={product.structural_notes} />
              <Item label="Observações de engenharia" value={product.engineering_notes} />
            </dl>
          </SectionCard>
          <SectionCard title="Versões da estrutura" description="Versão ativa ou usada nunca é alterada: mudanças geram nova versão, com motivo e responsável.">
            <DataTable headers={["Versão", "Situação", "Kits", "Custo atual", "Motivo", "Criada em", "Por", "Uso", "Ações"]} empty={!detail.versions.length}>
              {detail.versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-medium">v{version.version}</TableCell>
                  <TableCell>{version.status === "Ativa" ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Vigente</span> : versionStatusLabel(version.status)}</TableCell>
                  <TableCell className="text-center">{version.kits_count}</TableCell>
                  <TableCell className="text-right">{brl(version.total_cost)}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={version.change_reason || ""}>{version.change_reason || "-"}</TableCell>
                  <TableCell>{dateBr(version.created_at)}</TableCell>
                  <TableCell>{version.created_by || "-"}</TableCell>
                  <TableCell>{[version.used_in_production ? "produção" : "", version.used_in_quotes ? "orçamentos" : ""].filter(Boolean).join(" e ") || "-"}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => { setVersionId(version.id); void load(version.id) }}>Ver</Button>
                    {version.status === "Rascunho" ? <Button size="sm" onClick={() => void activate(version.id)}>Ativar</Button> : null}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
          <SectionCard title="Comparar versões" description="Quais kits entraram, saíram ou mudaram de quantidade e o efeito no custo.">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <GitCompare className="h-4 w-4 text-muted-foreground" />
              {(["a", "b"] as const).map((side) => (
                <select key={side} aria-label={`Versão ${side.toUpperCase()}`} className="h-9 rounded-md border bg-background px-3 text-sm" value={compare[side]} onChange={(event) => void runCompare(side === "a" ? event.target.value : compare.a, side === "b" ? event.target.value : compare.b)}>
                  <option value="">{side === "a" ? "Versão base" : "Versão comparada"}</option>
                  {detail.versions.map((version) => <option key={version.id} value={version.id}>v{version.version} ({versionStatusLabel(version.status)})</option>)}
                </select>
              ))}
            </div>
            {differences ? (
              <DataTable headers={["Kit", "Mudança", "Qtd. base", "Qtd. comparada", "Custo base", "Custo comparado"]} empty={!differences.length}>
                {differences.map((row) => <TableRow key={row.kit_id}><TableCell>{row.name} <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></TableCell><TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${changeTone[row.change]}`}>{changeLabel[row.change]}</span></TableCell><TableCell className="text-right">{row.qty_a === null ? "-" : qty(row.qty_a)}</TableCell><TableCell className="text-right">{row.qty_b === null ? "-" : qty(row.qty_b)}</TableCell><TableCell className="text-right">{brl(row.cost_a)}</TableCell><TableCell className="text-right">{brl(row.cost_b)}</TableCell></TableRow>)}
              </DataTable>
            ) : <p className="text-sm text-muted-foreground">Escolha duas versões diferentes para ver as diferenças.</p>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="homologacao" className="mt-4"><EngineeringTab productId={id} productName={product.name} /></TabsContent>

        <TabsContent value="historico" className="mt-4">
          <SectionCard title="Histórico de alterações" description="Quem alterou o quê e quando (cadastro, preço, versões e kits).">
            <DataTable headers={["Quando", "Ação", "Detalhe", "Responsável"]} empty={!detail.change_log.length} stickyHeader viewportClassName="max-h-[55vh]">
              {detail.change_log.map((entry) => <TableRow key={entry.id}><TableCell className="whitespace-nowrap">{dateBr(entry.changed_at)}</TableCell><TableCell className="whitespace-nowrap">{actionLabel[entry.action] || entry.action}</TableCell><TableCell>{entry.description}</TableCell><TableCell>{entry.changed_by || "-"}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <ProductSheet target={sheet} onClose={() => setSheet(null)} onSaved={(result) => { setSheet(null); setNotice(result.version_status === "Ativa" ? `Estrutura v${result.version} salva e ativada.` : result.version ? `Estrutura v${result.version} salva como rascunho: ative quando estiver pronta.` : "Dados do produto salvos."); setVersionId(null); void load(null) }} />
    </PageShell>
  )
}
