"use client"

import { SearchableSelectField } from "@/components/operations/shared"

export type OppItem = { productId: string; description: string; unit: string; quantity: string; unitPrice: string }
export type CatalogProduct = { id: string; name: string; code: string; unit?: string; price?: number }

const none = "nenhum"
const numeric = (value: unknown) => { const n = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0 }
const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const itemsTotal = (items: Array<{ quantity: unknown; unitPrice: unknown }>) => Math.round(items.reduce((sum, line) => sum + numeric(line.quantity) * numeric(line.unitPrice), 0) * 100) / 100

/** Produtos da negociação: escolhe do cadastro de produtos (preço vem do cadastro), quantidade livre; o valor estimado é a soma. */
export function OpportunityItemsEditor({ items, products, onChange, disabled }: { items: OppItem[]; products: CatalogProduct[]; onChange: (items: OppItem[]) => void; disabled?: boolean }) {
  const patch = (index: number, change: Partial<OppItem>) => onChange(items.map((row, at) => (at === index ? { ...row, ...change } : row)))
  return (
    <div className="space-y-2">
      {disabled ? null : (
        <SearchableSelectField label="Produtos da negociação (do cadastro de produtos)" value={none} onChange={(value) => {
          if (value === none) return
          const product = products.find((item) => item.id === value)
          if (!product) return
          const existing = items.find((line) => line.productId === product.id)
          onChange(existing
            ? items.map((line) => (line === existing ? { ...line, quantity: String(numeric(line.quantity) + 1) } : line))
            : [...items, { productId: product.id, description: product.name, unit: product.unit || "UN", quantity: "1", unitPrice: String(product.price ?? 0) }])
        }} options={[{ value: none, label: "Pesquise e escolha um produto para adicionar" }, ...products.map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name}${item.price ? ` — ${brl(item.price)}` : ""}` }))]} />
      )}
      {items.length ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Produto</th><th className="w-24 px-2 py-2">Qtd.</th><th className="w-32 px-2 py-2">Preço unit.</th><th className="px-2 py-2 text-right">Subtotal</th><th className="w-9" /></tr></thead>
            <tbody>
              {items.map((line, index) => (
                <tr key={`${line.productId}-${index}`} className="border-t align-top">
                  <td className="px-3 py-2">{line.description}<div className="text-xs text-muted-foreground">{line.unit || "UN"}</div></td>
                  <td className="px-2 py-2"><input inputMode="decimal" disabled={disabled} className="h-9 w-full rounded-md border bg-background px-2 disabled:opacity-60" value={line.quantity} aria-label={`Quantidade de ${line.description}`} onChange={(event) => patch(index, { quantity: event.target.value })} /></td>
                  <td className="px-2 py-2"><input inputMode="decimal" disabled={disabled} className="h-9 w-full rounded-md border bg-background px-2 disabled:opacity-60" value={line.unitPrice} aria-label={`Preço de ${line.description}`} onChange={(event) => patch(index, { unitPrice: event.target.value })} /></td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{brl(numeric(line.quantity) * numeric(line.unitPrice))}</td>
                  <td className="px-1 py-2">{disabled ? null : <button type="button" title="Remover" aria-label={`Remover ${line.description}`} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange(items.filter((_, at) => at !== index))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t bg-muted/30"><td className="px-3 py-2 font-medium" colSpan={3}>Valor estimado (soma dos produtos)</td><td className="px-2 py-2 text-right text-base font-semibold">{brl(itemsTotal(items))}</td><td /></tr></tfoot>
          </table>
        </div>
      ) : <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">Escolha acima os produtos desta negociação. O preço vem do cadastro do produto e o valor estimado é a soma de tudo.</p>}
    </div>
  )
}
