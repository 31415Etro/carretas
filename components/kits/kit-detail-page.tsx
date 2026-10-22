"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Banknote, Boxes, CheckCircle2, GitCompare, Layers, Package, Pencil, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { KitSheet, type KitSheetTarget } from "@/components/kits/kit-sheet"
import { entityHref } from "@/lib/entity-links"
import { formFromKitDetail, versionStatusLabel } from "@/lib/kits"

type Detail = {
  kit: Record<string, any>; current_version_id: string | null; shown_version_id: string | null
  versions: Array<Record<string, any>>; components: Array<Record<string, any>>; cost: number
  products: Array<Record<string, any>>; cost_history: Array<Record<string, any>>; change_log: Array<Record<string, any>>; used_in_production: boolean
}
type Diff = { material_id: string; sku: string; name: string; qty_a: number | null; unit_a: string | null; loss_a: number | null; qty_b: number | null; unit_b: string | null; loss_b: number | null; cost_a: number; cost_b: number; change: string }
const changeLabel: Record<string, string> = { adicionado: "Adicionada", removido: "Removida", alterado: "Alterada", igual: "Igual" }
const changeTone: Record<string, string> = { adicionado: "bg-emerald-100 text-emerald-800", removido: "bg-red-100 text-red-800", alterado: "bg-amber-100 text-amber-800", igual: "bg-slate-100 text-slate-700" }
const actionLabel: Record<string, string> = { versao_criada: "Versão criada", versao_ativada: "Versão ativada", versao_obsoleta: "Versão obsoleta", componente_adicionado: "Matéria-prima adicionada", componente_alterado: "Quantidade alterada", componente_removido: "Matéria-prima removida", cadastro_alterado: "Cadastro alterado" }
const Item = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">-</span>}</dd></div>
)

export function KitDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<KitSheetTarget>(null)
  const [compare, setCompare] = useState<{ a: string; b: string }>({ a: "", b: "" })
  const [differences, setDifferences] = useState<Diff[] | null>(null)
  const [notice, setNotice] = useState("")

  const load = useCallback(async (version: string | null = versionId) => {
    setLoading(true); setError("")
    try { setDetail((await api<{ detail: Detail }>(`/api/kits/${id}${version ? `?versao=${version}` : ""}`)).detail) } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar o kit.") } finally { setLoading(false) }
  }, [id, versionId])
  useEffect(() => { void load() }, [load])

  async function runCompare(a: string, b: string) {
    setCompare({ a, b })
    if (!a || !b || a === b) { setDifferences(null); return }
    try { setDifferences((await api<{ differences: Diff[] }>(`/api/kits/${id}?comparar=${a},${b}`)).differences) } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Erro ao comparar.") }
  }
  async function activate(version: string) {
    try { await api(`/api/kits/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", versionId: version }) }); setNotice("Versão ativada: agora é a vigente."); setVersionId(null); await load(null) } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Erro ao ativar.") }
  }

  if (!detail) {
    return (
      <PageShell title="Kit" description="Carregando os dados do kit..." actions={<Button variant="outline" asChild><Link href="/kits"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : ""}</p>}
      </PageShell>
    )
  }
  const kit = detail.kit
  const shown = detail.versions.find((version) => version.id === detail.shown_version_id)
  const current = detail.versions.find((version) => version.id === detail.current_version_id)
  const viewingOther = shown && current && shown.id !== current.id
  const editorForm = () => formFromKitDetail({ kit, components: detail.components })
  const share = (cost: number) => (detail.cost > 0 ? `${((cost / detail.cost) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "-")

  return (
    <PageShell title={kit.name} description={`${kit.internal_code} · ${kit.category || "Sem categoria"} · ${current ? `versão vigente v${current.version}` : "sem versão"}`}
      actions={<>
        <Button variant="outline" asChild><Link href="/kits"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        <Button variant="outline" onClick={() => setSheet({ mode: "header", kitId: id, form: editorForm(), originalSku: kit.internal_code || "" })}><Pencil className="h-4 w-4" />Dados do kit</Button>
        <Button onClick={() => setSheet(shown?.status === "Rascunho" ? { mode: "draft", kitId: id, versionId: shown.id, form: editorForm(), version: shown.version } : { mode: "version", kitId: id, form: editorForm(), baseVersion: shown?.version || 0, hasActive: Boolean(current && current.status === "Ativa") })}>
          <Plus className="h-4 w-4" />{shown?.status === "Rascunho" ? `Editar rascunho v${shown.version}` : "Nova versão da composição"}
        </Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={kit.status} />
        {current ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${current.status === "Ativa" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>v{current.version} {versionStatusLabel(current.status)}</span> : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Sem composição cadastrada</span>}
        {detail.used_in_production ? <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Já usado em produção: versões protegidas</span> : null}
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Kit lógico: sem saldo de estoque</span>
      </div>
      {viewingOther ? <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">Você está vendo a <strong>v{shown!.version} ({versionStatusLabel(shown!.status)})</strong>, não a vigente (v{current!.version}). <button type="button" className="underline" onClick={() => { setVersionId(null); void load(null) }}>Voltar para a vigente</button></p> : null}
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Custo estimado" value={brl(detail.cost)} note={shown ? `versão v${shown.version}, custo vigente das matérias-primas` : "sem composição"} icon={Banknote} />
        <MetricCard title="Matérias-primas" value={detail.components.length} note="na versão exibida" icon={Boxes} />
        <MetricCard title="Produtos que usam" value={new Set(detail.products.filter((p) => p.bom_status === "Ativa").map((p) => p.product_id)).size} note="com estrutura ativa" icon={Package} />
        <MetricCard title="Versões" value={detail.versions.length} note="todas ficam guardadas para rastreabilidade" icon={Layers} />
      </div>

      <Tabs defaultValue="materias">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="materias">Matérias-primas ({detail.components.length})</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
          <TabsTrigger value="produtos">Produtos vinculados ({detail.products.length})</TabsTrigger>
          <TabsTrigger value="versoes">Versões ({detail.versions.length})</TabsTrigger>
          <TabsTrigger value="historico">Histórico ({detail.change_log.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="mt-4 grid gap-4 lg:grid-cols-2">
          <SectionCard title="Identificação">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="SKU" value={<span className="font-mono">{kit.internal_code}</span>} /><Item label="Status" value={kit.status} />
              <Item label="Categoria" value={kit.category} /><Item label="Tipo" value="Kit de fabricação (lógico)" />
              <Item label="Descrição" value={kit.description} /><Item label="Última alteração" value={dateBr(kit.updated_at)} />
            </dl>
          </SectionCard>
          <SectionCard title="Como funciona">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>O kit reúne matérias-primas e quantidades; ele não tem saldo próprio.</li>
              <li>Cadastrar ou editar o kit não movimenta estoque. As matérias-primas só são baixadas quando a produção apontar o consumo.</li>
              <li>Versão vigente é a usada por produtos novos; versões antigas continuam disponíveis e intactas.</li>
              <li>Mudar a composição sempre cria uma nova versão.</li>
            </ul>
          </SectionCard>
          {kit.photo_url ? <SectionCard title="Imagem"><img src={kit.photo_url} alt={kit.name} className="h-40 rounded-md border object-cover" /></SectionCard> : null}
        </TabsContent>

        <TabsContent value="materias" className="mt-4">
          <SectionCard title={shown ? `Composição da v${shown.version} (${versionStatusLabel(shown.status)})` : "Composição"} description="Matérias-primas por ID real do cadastro, com quantidade, unidade, perda e disponibilidade na empresa selecionada.">
            <DataTable headers={["Matéria-prima", "SKU", "Quantidade", "Perda", "Necessário (un. do estoque)", "Custo unit.", "Custo", "Disponível"]} empty={!detail.components.length}>
              {detail.components.map((component) => (
                <TableRow key={component.id}>
                  <TableCell><Link href={entityHref("rawMaterial", component.component_id) || "#"} className="font-medium text-primary underline-offset-2 hover:underline">{component.name}</Link></TableCell>
                  <TableCell className="font-mono text-xs">{component.sku || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{qty(component.quantity)} {component.unit}</TableCell>
                  <TableCell className="text-right">{Number(component.loss_percent) > 0 ? `${qty(component.loss_percent)}%` : "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{qty(component.required_with_loss, 4)} {component.material_unit}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{brl(component.unit_cost)} / {component.material_unit}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium">{brl(component.line_cost)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-right ${Number(component.available) < Number(component.required_with_loss) ? "text-destructive" : ""}`}>{qty(component.available)} {component.material_unit}</TableCell>
                </TableRow>
              ))}
            </DataTable>
            <p className="mt-2 text-xs text-muted-foreground">Disponível em vermelho: o saldo livre da empresa não cobre uma unidade deste kit.</p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="custos" className="mt-4 space-y-4">
          <SectionCard title="Custo por componente" description="Calculado agora com o custo vigente de cada matéria-prima. Não altera o custo de ordens já produzidas.">
            <DataTable headers={["Matéria-prima", "Custo da linha", "Participação"]} empty={!detail.components.length}>
              {[...detail.components].sort((a, b) => Number(b.line_cost) - Number(a.line_cost)).map((component) => (
                <TableRow key={component.id}><TableCell>{component.name}</TableCell><TableCell className="text-right">{brl(component.line_cost)}</TableCell><TableCell className="text-right">{share(Number(component.line_cost))}</TableCell></TableRow>
              ))}
              <TableRow><TableCell className="font-semibold">Total estimado</TableCell><TableCell className="text-right font-semibold">{brl(detail.cost)}</TableCell><TableCell /></TableRow>
            </DataTable>
          </SectionCard>
          <SectionCard title="Histórico de estimativas" description="Uma linha é gravada quando o custo calculado muda (por troca de versão ou de custo das matérias-primas).">
            <DataTable headers={["Data", "Versão", "Custo estimado"]} empty={!detail.cost_history.length}>
              {detail.cost_history.map((entry) => <TableRow key={entry.id}><TableCell>{dateBr(entry.computed_at)}</TableCell><TableCell>v{entry.version}</TableCell><TableCell className="text-right">{brl(entry.total_cost)}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="produtos" className="mt-4">
          <SectionCard title="Produtos finais que usam este kit" description="Um kit pode ser usado por vários produtos, cada um com a sua quantidade e, se quiser, uma versão fixada.">
            <DataTable headers={["Produto", "SKU", "Estrutura do produto", "Quantidade do kit", "Versão do kit usada"]} empty={!detail.products.length}>
              {detail.products.map((product, index) => (
                <TableRow key={`${product.bom_version_id}-${index}`}>
                  <TableCell>{entityHref("product", product.product_id) ? <Link href={entityHref("product", product.product_id)!} className="text-primary underline-offset-2 hover:underline">{product.name}</Link> : product.name}</TableCell>
                  <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                  <TableCell>v{product.bom_version} <StatusBadge status={product.bom_status === "Ativa" ? "Ativo" : product.bom_status} /></TableCell>
                  <TableCell className="text-right">{qty(product.quantity)}</TableCell>
                  <TableCell>{product.follows_active ? "Acompanha a vigente" : `v${product.pinned_kit_version} (fixada)`}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="versoes" className="mt-4 space-y-4">
          <SectionCard title="Versões da composição" description="Versão ativa ou usada nunca é alterada: mudanças geram nova versão.">
            <DataTable headers={["Versão", "Situação", "Matérias-primas", "Custo atual", "Criada em", "Por", "Uso", "Ações"]} empty={!detail.versions.length}>
              {detail.versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-medium">v{version.version}</TableCell>
                  <TableCell>{version.status === "Ativa" ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />Vigente</span> : versionStatusLabel(version.status)}</TableCell>
                  <TableCell className="text-center">{version.components_count}</TableCell>
                  <TableCell className="text-right">{brl(version.cost)}</TableCell>
                  <TableCell>{dateBr(version.created_at)}</TableCell>
                  <TableCell>{version.created_by || "-"}</TableCell>
                  <TableCell>{version.used_in_production ? "Em produção" : version.used_by_products ? `${version.used_by_products} produto(s)` : "-"}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => { setVersionId(version.id); void load(version.id) }}>Ver</Button>
                    {version.status === "Rascunho" ? <Button size="sm" onClick={() => void activate(version.id)}>Ativar</Button> : null}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
          <SectionCard title="Comparar versões" description="O que entrou, saiu ou mudou entre duas versões e o efeito no custo.">
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
              <DataTable headers={["Matéria-prima", "Mudança", "Base", "Comparada", "Custo base", "Custo comparado"]} empty={!differences.length}>
                {differences.map((row) => (
                  <TableRow key={row.material_id}>
                    <TableCell>{row.name} <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></TableCell>
                    <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${changeTone[row.change]}`}>{changeLabel[row.change]}</span></TableCell>
                    <TableCell>{row.qty_a === null ? "-" : `${qty(row.qty_a)} ${row.unit_a}${Number(row.loss_a) > 0 ? ` (+${qty(row.loss_a)}%)` : ""}`}</TableCell>
                    <TableCell>{row.qty_b === null ? "-" : `${qty(row.qty_b)} ${row.unit_b}${Number(row.loss_b) > 0 ? ` (+${qty(row.loss_b)}%)` : ""}`}</TableCell>
                    <TableCell className="text-right">{brl(row.cost_a)}</TableCell><TableCell className="text-right">{brl(row.cost_b)}</TableCell>
                  </TableRow>
                ))}
              </DataTable>
            ) : <p className="text-sm text-muted-foreground">Escolha duas versões diferentes para ver as diferenças.</p>}
          </SectionCard>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <SectionCard title="Histórico de alterações" description="Quem alterou o quê e quando (versões, componentes e dados do cadastro).">
            <DataTable headers={["Quando", "Ação", "Detalhe", "Responsável"]} empty={!detail.change_log.length} stickyHeader viewportClassName="max-h-[55vh]">
              {detail.change_log.map((entry) => (
                <TableRow key={entry.id}><TableCell className="whitespace-nowrap">{dateBr(entry.changed_at)}</TableCell><TableCell className="whitespace-nowrap">{actionLabel[entry.action] || entry.action}</TableCell><TableCell>{entry.description}</TableCell><TableCell>{entry.changed_by || "-"}</TableCell></TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <KitSheet target={sheet} onClose={() => setSheet(null)} onSaved={(result) => { setSheet(null); setNotice(result.version_status === "Ativa" ? `Versão v${result.version} salva e ativada.` : result.version ? `Versão v${result.version} salva como rascunho: ative quando estiver pronta.` : "Dados do kit salvos."); setVersionId(null); void load(null) }} />
    </PageShell>
  )
}
