"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Layers, Package, Plus, RefreshCw, Boxes } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, dateBr, SearchBox } from "@/components/catalog/catalog-fields"
import { KitSheet, type KitSheetTarget } from "@/components/kits/kit-sheet"
import { versionStatusLabel } from "@/lib/kits"

type Row = { id: string; sku: string; name: string; category: string | null; status: string; photo_url: string | null; version: number | null; version_status: string | null; components_count: number; cost: number; products_count: number; last_change: string | null }
type Order = "name" | "sku" | "cost" | "products" | "updated"
const SIZE = 25

export function KitsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"Ativo" | "Inativo" | "">("Ativo")
  const [category, setCategory] = useState("")
  const [order, setOrder] = useState<Order>("name")
  const [desc, setDesc] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sheet, setSheet] = useState<KitSheetTarget>(null)
  const [categories, setCategories] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ q: query, status, categoria: category, ordem: order, desc: desc ? "1" : "", pagina: String(page), tamanho: String(SIZE) })
      const data = await api<{ items: Row[]; total: number }>(`/api/kits?${params}`)
      setRows(data.items); setTotal(data.total)
      if (!category && !query) setCategories(Array.from(new Set(data.items.map((row) => row.category).filter(Boolean) as string[])).sort())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar os kits.")
    } finally {
      setLoading(false)
    }
  }, [query, status, category, order, desc, page])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])

  const pages = Math.max(1, Math.ceil(total / SIZE))
  const withoutVersion = rows.filter((row) => row.version === null || row.components_count === 0).length
  const unused = rows.filter((row) => row.products_count === 0).length
  const sort = (next: Order) => { if (order === next) setDesc(!desc); else { setOrder(next); setDesc(false) } setPage(1) }
  const SortHead = ({ label, field }: { label: string; field: Order }) => (
    <button type="button" onClick={() => sort(field)} className="inline-flex items-center gap-1 uppercase tracking-wide">{label}{order === field ? (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}</button>
  )

  return (
    <PageShell title="Kits e composições" description="Estruturas de matérias-primas e quantidades usadas para fabricar cada parte do produto: matéria-prima → kit → produto final."
      actions={<Button onClick={() => setSheet({ mode: "new" })}><Plus className="h-4 w-4" />Novo kit</Button>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Kits" value={total} note={status ? `${status === "Ativo" ? "ativos" : "inativos"} no filtro` : "no filtro"} icon={Layers} />
        <MetricCard title="Sem composição" value={withoutVersion} note="kits sem versão ou sem matéria-prima (nesta página)" icon={Boxes} />
        <MetricCard title="Sem produto" value={unused} note="kits que nenhum produto ativo usa (nesta página)" icon={Package} />
        <MetricCard title="Custo médio" value={brl(rows.length ? rows.reduce((sum, row) => sum + Number(row.cost), 0) / rows.length : 0)} note="custo estimado da versão vigente" icon={Layers} />
      </div>

      <SectionCard title="Cadastro de kits">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Buscar por nome, SKU ou categoria" />
          <div className="flex rounded-md border p-0.5 text-sm">
            {([["Ativo", "Ativos"], ["Inativo", "Inativos"], ["", "Todos"]] as const).map(([value, label]) => (
              <button key={label} type="button" onClick={() => { setStatus(value); setPage(1) }} className={`rounded px-3 py-1.5 ${status === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          {categories.length ? (
            <select value={category} aria-label="Categoria" className="h-9 rounded-md border bg-background px-3 text-sm" onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
              <option value="">Todas as categorias</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : null}
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Kit", "SKU", "Categoria", "Versão vigente", "Matérias-primas", "Custo estimado", "Produtos", "Última alteração", "Status"]} empty={!rows.length && !loading}>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/kits/${row.id}`)}>
              <TableCell><div className="flex items-center gap-2">{row.photo_url ? <img src={row.photo_url} alt="" className="h-8 w-8 rounded object-cover" /> : null}<span className="font-medium">{row.name}</span></div></TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.sku}</TableCell>
              <TableCell>{row.category || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{row.version ? <>v{row.version} <span className="text-xs text-muted-foreground">({versionStatusLabel(row.version_status || "")})</span></> : <span className="text-muted-foreground">Sem versão</span>}</TableCell>
              <TableCell className="text-center">{row.components_count || "-"}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{row.version ? brl(row.cost) : "-"}</TableCell>
              <TableCell className="text-center">{row.products_count || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{dateBr(row.last_change)}</TableCell>
              <TableCell><StatusBadge status={row.status} /></TableCell>
            </TableRow>
          ))}
        </DataTable>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>Ordenar por:</span>
            {([["name", "Nome"], ["sku", "SKU"], ["cost", "Custo"], ["products", "Produtos"], ["updated", "Alteração"]] as const).map(([field, label]) => (
              <button key={field} type="button" onClick={() => sort(field)} className={`rounded px-2 py-0.5 ${order === field ? "bg-muted font-medium text-foreground" : "hover:bg-muted"}`}>{label}{order === field ? (desc ? " ↓" : " ↑") : ""}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{total} kit(s) · página {page} de {pages}</span>
            <Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </SectionCard>

      <KitSheet target={sheet} onClose={() => setSheet(null)} onSaved={(result, created) => { setSheet(null); if (created) router.push(`/kits/${result.kit_id}`); else void load() }} />
    </PageShell>
  )
}
