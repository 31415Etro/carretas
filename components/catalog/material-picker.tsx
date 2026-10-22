"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { api, brl, qty } from "@/components/catalog/catalog-fields"
import type { MaterialOption } from "@/lib/kits"

/**
 * Seletor de matéria-prima já cadastrada (pesquisa por nome, SKU ou categoria). Só devolve itens existentes: nunca cria cadastro.
 * Reutilizável nas próximas telas (produto, serviço com materiais, solicitação de compra).
 */
export function MaterialPicker({ onPick, excludeIds = [], placeholder = "Pesquisar matéria-prima por nome, SKU ou categoria..." }: { onPick: (option: MaterialOption) => void; excludeIds?: string[]; placeholder?: string }) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<MaterialOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        setItems((await api<{ items: MaterialOption[] }>(`/api/kits/materiais?q=${encodeURIComponent(query)}`)).items)
        setActive(0)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Erro ao pesquisar.")
      } finally {
        setLoading(false)
      }
    }, query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [query, open])

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  const visible = items.filter((item) => !excludeIds.includes(item.id))
  const choose = (item: MaterialOption) => { onPick(item); setQuery(""); setOpen(false) }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} placeholder={placeholder} className="pl-9" onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, visible.length - 1)) }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
            if (event.key === "Enter" && visible[active]) { event.preventDefault(); choose(visible[active]) }
            if (event.key === "Escape") setOpen(false)
          }} />
        {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>
      {open ? (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg" role="listbox">
          {error ? <li className="p-3 text-sm text-destructive">{error}</li> : null}
          {!error && !loading && visible.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Nenhuma matéria-prima encontrada. Cadastre em Matérias-primas e volte aqui.</li> : null}
          {visible.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); choose(item) }}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm ${index === active ? "bg-accent" : ""}`}>
              <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block text-xs text-muted-foreground"><span className="font-mono">{item.sku || "sem SKU"}</span>{item.category ? ` · ${item.category}` : ""}</span></span>
              <span className="shrink-0 text-right text-xs"><span className="block">{brl(item.unit_cost)} / {item.unit}</span><span className="block text-muted-foreground">disp. {qty(item.available)} {item.unit}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
