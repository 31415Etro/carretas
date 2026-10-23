"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Loader2, Search, Trash2, TriangleAlert } from "lucide-react"
import { Input } from "@/components/ui/input"
import { api } from "@/components/catalog/catalog-fields"
import { linkFromOption, type KitLinkForm, type KitOption, type ProductErrors, type StructureForm } from "@/lib/products"

/** Pesquisa de kits ativos (com versão vigente). Só devolve kits existentes: nunca cria cadastro. */
function KitPicker({ onPick, excludeIds }: { onPick: (option: KitOption) => void; excludeIds: string[] }) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<KitOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try { setItems((await api<{ items: KitOption[] }>(`/api/produtos/kits?q=${encodeURIComponent(query)}`)).items) } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao pesquisar.") } finally { setLoading(false) }
    }, query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [query, open])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  const visible = items.filter((item) => !excludeIds.includes(item.id))
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} placeholder="Pesquisar kit por nome ou SKU..." className="pl-9" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} />
        {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>
      {open ? (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg" role="listbox">
          {error ? <li className="p-3 text-sm text-destructive">{error}</li> : null}
          {!error && !loading && visible.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Nenhum kit com versão ativa encontrado. Cadastre e ative em Kits e composições.</li> : null}
          {visible.map((item) => (
            <li key={item.id} role="option" aria-selected="false" className="flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm hover:bg-accent" onMouseDown={(event) => { event.preventDefault(); onPick(item); setQuery(""); setOpen(false) }}>
              <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block text-xs text-muted-foreground"><span className="font-mono">{item.sku}</span> · v{item.version} · {item.components_count} matéria(s)-prima(s)</span></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Estrutura de fabricação do produto: só os kits (por ID e versão) e a quantidade de cada um por unidade do produto. */
export function KitLinkEditor({ structure, onChange, errors, readOnlyReason }: { structure: StructureForm; onChange: (structure: StructureForm) => void; errors: ProductErrors; readOnlyReason?: string }) {
  const update = (key: string, patch: Partial<KitLinkForm>) => onChange({ ...structure, kits: structure.kits.map((link) => (link.key === key ? { ...link, ...patch } : link)) })
  return (
    <div className="space-y-3">
      {readOnlyReason ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{readOnlyReason}</p> : null}
      <KitPicker excludeIds={structure.kits.map((link) => link.kitId)} onPick={(option) => onChange({ ...structure, kits: [...structure.kits, linkFromOption(option)] })} />
      {errors.kits ? <p className="flex items-center gap-1 text-sm text-destructive"><TriangleAlert className="h-4 w-4" />{errors.kits}</p> : null}
      {structure.kits.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Pesquise acima e vincule os kits que compõem este produto. As matérias-primas vêm dos kits: não são copiadas para o produto.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Kit</th><th className="w-24 px-2 py-2">Qtd. por produto</th><th className="px-2 py-2">Versão</th><th className="w-9" /></tr></thead>
            <tbody>
              {structure.kits.map((link) => (
                <tr key={link.key} className="border-t align-top">
                  <td className="px-3 py-2"><Link href={`/kits/${link.kitId}`} target="_blank" className="font-medium text-primary underline-offset-2 hover:underline">{link.name}</Link>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{link.sku}</span> · {link.componentsCount} matéria(s)-prima(s)</div>
                    {errors[`k:${link.key}`] ? <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="h-3 w-3" />{errors[`k:${link.key}`]}</p> : null}</td>
                  <td className="px-2 py-2"><Input inputMode="decimal" value={link.quantity} aria-label={`Quantidade de ${link.name}`} aria-invalid={Boolean(errors[`k:${link.key}`])} onChange={(event) => update(link.key, { quantity: event.target.value })} /></td>
                  <td className="px-2 py-2 text-xs"><label className="flex items-center gap-1"><input type="checkbox" checked={link.pinVersion} onChange={(event) => update(link.key, { pinVersion: event.target.checked })} />Fixar v{link.activeVersion ?? "-"}</label><span className="text-muted-foreground">{link.pinVersion ? "não muda quando o kit tiver nova versão" : "acompanha a versão vigente do kit"}</span></td>
                  <td className="px-1 py-2"><button type="button" title="Remover" aria-label={`Remover ${link.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange({ ...structure, kits: structure.kits.filter((item) => item.key !== link.key) })}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Motivo da alteração (obrigatório ao criar uma nova versão)</span><Input value={structure.changeReason} placeholder="Ex.: troca do kit de rodagem" onChange={(event) => onChange({ ...structure, changeReason: event.target.value })} /></label>
    </div>
  )
}
