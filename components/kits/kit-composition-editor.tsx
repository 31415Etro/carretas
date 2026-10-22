"use client"

import Link from "next/link"
import { TriangleAlert, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { brl, qty } from "@/components/catalog/catalog-fields"
import { MaterialPicker } from "@/components/catalog/material-picker"
import { componentFromOption, kitCost, lineCost, requiredWithLoss, type ComponentForm, type KitErrors } from "@/lib/kits"

/** Tabela de composição do kit: adicionar por pesquisa, editar quantidade/unidade/perda, remover, e o custo recalculado a cada tecla. */
export function KitCompositionEditor({ components, onChange, errors }: { components: ComponentForm[]; onChange: (components: ComponentForm[]) => void; errors: KitErrors }) {
  const update = (key: string, patch: Partial<ComponentForm>) => onChange(components.map((component) => (component.key === key ? { ...component, ...patch } : component)))
  const total = kitCost(components)
  return (
    <div className="space-y-3">
      <MaterialPicker excludeIds={components.map((component) => component.componentId)} onPick={(option) => onChange([...components, componentFromOption(option)])} />
      {errors.components ? <p className="flex items-center gap-1 text-sm text-destructive"><TriangleAlert className="h-4 w-4" />{errors.components}</p> : null}
      {components.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Pesquise acima e selecione as matérias-primas que compõem este kit. Elas já precisam estar cadastradas.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[540px] text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Matéria-prima</th><th className="w-24 px-2 py-2">Quantidade</th><th className="w-24 px-2 py-2">Unidade</th><th className="w-20 px-2 py-2">Perda %</th><th className="px-2 py-2 text-right">Custo</th><th className="w-9 px-1 py-2" /></tr>
            </thead>
            <tbody>
              {components.map((component) => {
                const error = errors[`c:${component.key}`]
                const cost = lineCost(component)
                const required = requiredWithLoss(component)
                return (
                  <tr key={component.key} className="border-t align-top">
                    <td className="px-3 py-2">
                      <Link href={`/materias-primas/${component.componentId}`} target="_blank" className="font-medium text-primary underline-offset-2 hover:underline">{component.name}</Link>
                      <div className="text-xs text-muted-foreground"><span className="font-mono">{component.sku || "sem SKU"}</span> · {brl(component.unitCost)} / {component.baseUnit} · disponível {qty(component.available)} {component.baseUnit}</div>
                      {!Number.isNaN(required) ? <div className="text-xs text-muted-foreground">Necessário por kit (com perda): {qty(required, 4)} {component.baseUnit}</div> : null}
                      {error ? <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="h-3 w-3 shrink-0" />{error}</p> : null}
                    </td>
                    <td className="px-2 py-2"><Input inputMode="decimal" value={component.quantity} placeholder="0" aria-label={`Quantidade de ${component.name}`} aria-invalid={Boolean(error)} onChange={(event) => update(component.key, { quantity: event.target.value })} /></td>
                    <td className="px-2 py-2">
                      <select value={component.unit} aria-label={`Unidade de ${component.name}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" onChange={(event) => update(component.key, { unit: event.target.value })}>
                        {component.units.map((entry) => <option key={entry.unit} value={entry.unit}>{entry.unit}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2"><Input inputMode="decimal" value={component.lossPercent} placeholder="0" aria-label={`Perda de ${component.name}`} onChange={(event) => update(component.key, { lossPercent: event.target.value })} /></td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-medium">{Number.isNaN(cost) ? "-" : brl(cost)}</td>
                    <td className="px-1 py-2"><button type="button" title="Remover" aria-label={`Remover ${component.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange(components.filter((item) => item.key !== component.key))}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr className="border-t bg-muted/30"><td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold">Custo estimado do kit</td><td className="whitespace-nowrap px-2 py-2 text-right text-base font-semibold">{brl(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">O custo usa o custo vigente de cada matéria-prima (custo médio das entradas) e já considera a conversão de unidades e a perda. Salvar o kit não movimenta estoque.</p>
    </div>
  )
}
