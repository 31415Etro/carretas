"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Printer, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/operations/shared"
import { TrailerDrawingView } from "@/components/configurator/trailer-drawing-view"
import { api, brl, dateBr, qty } from "@/components/catalog/catalog-fields"
import { configStatusLabel } from "@/lib/configurator"
import { configurationFacts } from "@/lib/sales-order-pdf"
import { releaseLabel } from "@/lib/vehicle-documentation"

type Sheet = Record<string, any>

/** Ficha de fabricação imprimível: a configuração CONGELADA da venda. Revisão nova do produto não muda uma ordem já liberada. */
export function FabricationSheet({ id }: { id: string }) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { api<{ sheet: Sheet }>(`/api/producao/${id}/ficha`).then((data) => setSheet(data.sheet)).catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar a ficha.")) }, [id])

  if (!sheet) return <PageShell title="Ficha de fabricação" description="Carregando..." actions={<Button variant="outline" asChild><Link href={`/producao/${id}`}><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>}>{error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : null}</PageShell>
  const cfg = sheet.configuration
  const facts = cfg ? configurationFacts(cfg) : []
  return (
    <PageShell title={`Ficha de fabricação ${sheet.order.code}`} description={`${sheet.product.name} · pedido ${sheet.sales_order?.order_number || "-"}`}
      actions={<><Button variant="outline" asChild><Link href={`/producao/${id}`}><ArrowLeft className="h-4 w-4" />Voltar</Link></Button><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</Button></>}>
      <style>{`@media print { body * { visibility: hidden !important; } #ficha, #ficha * { visibility: visible !important; } #ficha { position: absolute; left: 0; top: 0; width: 100%; padding: 8mm; } .no-print { display: none !important; } }`}</style>
      <div id="ficha" className="space-y-4 rounded-md border bg-white p-5 text-sm text-slate-900">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
          <div><h2 className="text-lg font-semibold">Ficha de fabricação · {sheet.order.code}</h2><p>{sheet.product.name}{sheet.product.model ? ` · modelo ${sheet.product.model}` : ""} ({sheet.product.sku})</p></div>
          <dl className="grid grid-cols-2 gap-x-4 text-xs"><dt className="text-slate-500">Pedido</dt><dd>{sheet.sales_order?.order_number || "-"}</dd><dt className="text-slate-500">Cliente</dt><dd>{sheet.sales_order?.client || "-"}</dd><dt className="text-slate-500">Quantidade</dt><dd>{qty(sheet.order.quantity)}</dd>
            <dt className="text-slate-500">Previsão</dt><dd>{dateBr(sheet.order.planned_end)}</dd><dt className="text-slate-500">Prioridade</dt><dd>{sheet.order.priority}</dd><dt className="text-slate-500">Estrutura</dt><dd>v{sheet.bom.version}</dd></dl>
        </header>
        {!sheet.release?.eligible ? <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />ORDEM AINDA NÃO LIBERADA PARA FABRICAR. {releaseLabel(sheet.release)}</p> : null}
        {cfg ? (
          <section className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
            <div>
              <h3 className="mb-1 font-semibold">Configuração vendida</h3>
              <p className="mb-2 text-xs text-slate-600">{cfg.summary} · {configStatusLabel(cfg.status)} · congelada em {dateBr(cfg.frozen_at)} · revisão do projeto {cfg.revision_label || "-"}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{facts.map(([label, value]) => [<dt key={`l${label}`} className="text-xs text-slate-500">{label}</dt>, <dd key={`v${label}`}>{value}</dd>])}</dl>
            </div>
            {cfg.params?.comprimento ? <TrailerDrawingView product={sheet.product.name} params={cfg.params} grade={cfg.drawing_spec?.grade === "validado" && cfg.homologated ? "validado" : "ilustrativo"} revision={cfg.revision_label} geometry={cfg.drawing_spec?.geometry} finish={cfg.options?.selected?.find((o: any) => o.group === "acabamento")?.label} accessories={(cfg.options?.selected || []).filter((o: any) => o.group === "acessorio").map((o: any) => o.label)} /> : null}
          </section>
        ) : <p className="text-xs text-slate-600">Produto padrão (sem personalização): fabricar conforme a estrutura v{sheet.bom.version}.</p>}
        <section><h3 className="mb-1 font-semibold">Kits</h3>
          <table className="w-full border-collapse text-xs"><thead><tr className="border-b text-left"><th className="py-1">Kit</th><th>SKU</th><th>Versão</th><th className="text-right">Quantidade</th></tr></thead><tbody>{sheet.kits.map((kit: any, index: number) => <tr key={index} className="border-b"><td className="py-1">{kit.name}</td><td className="font-mono">{kit.sku}</td><td>v{kit.version}</td><td className="text-right">{qty(kit.quantity)}</td></tr>)}</tbody></table></section>
        <section><h3 className="mb-1 font-semibold">Matérias-primas (quantidades calculadas para a ordem)</h3>
          <table className="w-full border-collapse text-xs"><thead><tr className="border-b text-left"><th className="py-1">Material</th><th>SKU</th><th>Kit</th><th className="text-right">Quantidade</th></tr></thead><tbody>{sheet.materials.map((material: any, index: number) => <tr key={index} className="border-b"><td className="py-1">{material.name}</td><td className="font-mono">{material.sku}</td><td>{material.kit}</td><td className="text-right">{qty(material.required, 4)} {material.unit}</td></tr>)}</tbody></table></section>
        {cfg?.cut_list?.length ? (
          <section><h3 className="mb-1 font-semibold">Plano de cortes (regra aprovada pela engenharia)</h3>
            {cfg.cut_list.map((cut: any, index: number) => <div key={index} className="mb-2 text-xs"><strong>{cut.name}</strong>: {cut.plan.bars} barra(s) de {qty(cut.plan.bar_length_mm)} mm por unidade; sobra {qty(cut.plan.waste_mm)} mm. Peças: {cut.plan.pieces.map((piece: any) => `${piece.count}× ${piece.label} ${qty(piece.length_mm)} mm`).join("; ")}.</div>)}
          </section>
        ) : null}
        <section><h3 className="mb-1 font-semibold">Instruções de fabricação</h3>
          <p className="whitespace-pre-line text-xs">{[sheet.bom.notes, cfg ? `Fabricar exatamente conforme as medidas e opções acima. Qualquer mudança exige revisão controlada do pedido (revisão do projeto ${cfg.revision_label || "-"}).` : ""].filter(Boolean).join("\n") || "Sem instruções adicionais cadastradas na estrutura."}</p>
          <p className="mt-1 text-xs text-slate-500">Prazo estimado de produção: {sheet.bom.estimated_days || "-"} dias. Custo estimado da configuração: {cfg ? brl(cfg.cost_total) : "-"}.</p></section>
      </div>
    </PageShell>
  )
}
