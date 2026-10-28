"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDown, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type MultiOption = { value: string; label: string }

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()

/** Seleção de vários itens com pesquisa: marque quantos quiser; vazio = todos. */
export function MultiSelectSearch({ label, options, value, onChange, placeholder = "Todos", searchPlaceholder = "Pesquisar..." }: { label: string; options: MultiOption[]; value: string[]; onChange: (value: string[]) => void; placeholder?: string; searchPlaceholder?: string }) {
  const [search, setSearch] = useState("")
  const filtered = useMemo(() => { const term = normalize(search); return term ? options.filter((option) => normalize(option.label).includes(term)) : options }, [options, search])
  const selected = new Set(value)
  const names = options.filter((option) => selected.has(option.value)).map((option) => option.label.split(" (")[0].split(" · ")[0])
  const summary = !value.length ? placeholder : value.length === 1 ? names[0] || "1 selecionado" : `${value.length} selecionados`
  const toggle = (item: string) => onChange(selected.has(item) ? value.filter((entry) => entry !== item) : [...value, item])

  return (
    <div className="text-xs text-muted-foreground">
      {label}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="mt-1 h-9 w-full justify-between gap-2 px-3 text-sm font-normal text-foreground sm:w-[300px]" title={names.join(", ")}>
            <span className="truncate">{summary}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(94vw,380px)] space-y-2 p-2">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} className="pl-8" /></div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{value.length ? `${value.length} selecionado(s)` : "Nenhum selecionado = todos"} · {filtered.length} na lista</span>
            <span className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={!filtered.length} onClick={() => onChange([...new Set([...value, ...filtered.map((option) => option.value)])])}>Marcar {search ? "os resultados" : "todos"}</Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={!value.length} onClick={() => onChange([])}><X className="mr-1 h-3 w-3" />Limpar</Button>
            </span>
          </div>
          <div className="max-h-72 space-y-0.5 overflow-auto pr-1">
            {filtered.length ? filtered.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-muted">
                <Checkbox checked={selected.has(option.value)} onCheckedChange={() => toggle(option.value)} className="mt-0.5" />
                <span className="leading-tight">{option.label}</span>
              </label>
            )) : <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
