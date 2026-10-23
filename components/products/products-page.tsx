"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Factory, PackageCheck, Plus, RefreshCw, Tag, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, qty, SearchBox } from "@/components/catalog/catalog-fields"
import { PhotoAuditPanel } from "@/components/products/photo-audit-panel"
import { ProductSheet, type ProductSheetTarget } from "@/components/products/product-sheet"

type Row = {
  id: string; sku: string; name: string; model: string | null; category: string | null; product_line: string | null; status: string; sale_price: number; photo_url: string | null
  bom_version: number | null; bom_status: string | null; kits_count: number; est_cost: number; margin: number; margin_percent: number | null
  physical: number; reserved: number; available: number; in_production: number; make_to_order: boolean; available_for_quote: boolean
}
type Order = "name" | "sku" | "price" | "cost" | "margin" | "stock"
const SIZE = 25

export function ProductsPage() {
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
  const [sheet, setSheet] = useState<ProductSheetTarget>(null)
  const [categories, setCategories] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ q: query, status, categoria: category, ordem: order, desc: desc ? "1" : "", pagina: String(page), tamanho: String(SIZE) })
      const data = await api<{ items: Row[]; total: number }>(`/api/produtos?${params}`)
      setRows(data.items); setTotal(data.total)
      if (!category && !query) setCategories(Array.from(new Set(data.items.map((row) => row.category).filter(Boolean) as string[])).sort())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar os produtos.")
    } finally {
      setLoading(false)
    }
  }, [query, status, category, order, desc, page])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])

  const pages = Math.max(1, Math.ceil(total / SIZE))
  const withoutStructure = rows.filter((row) => row.bom_version === null).length
  const inStock = rows.reduce((sum, row) => sum + Number(row.available), 0)
  const inProduction = rows.reduce((sum, row) => sum + Number(row.in_production), 0)
  const sort = (next: Order) => { if (order === next) setDesc(!desc); else { setOrder(next); setDesc(false) } setPage(1) }

  return (
    <PageShell title="Produtos finais" description="Carretas e produtos vendidos ao cliente: engenharia (kits e versões), custo, estoque de acabados e integração com orçamento."
      actions={<Button onClick={() => setSheet({ mode: "new" })}><Plus className="h-4 w-4" />Novo produto</Button>}>
      <PhotoAuditPanel onDone={() => void load()} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Produtos" value={total} note={status ? `${status === "Ativo" ? "ativos" : "inativos"} no filtro` : "no filtro"} icon={PackageCheck} />
        <MetricCard title="Sem estrutura" value={withoutStructure} note="sem kits vinculados (nesta página)" icon={Tag} />
        <MetricCard title="Acabados disponíveis" value={qty(inStock)} note="saldo livre da empresa (nesta página)" icon={TrendingUp} />
        <MetricCard title="Em produção" value={qty(inProduction)} note="unidades em ordens abertas (nesta página)" icon={Factory} />
      </div>

      <SectionCard title="Cadastro de produtos">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Buscar por nome, SKU, modelo ou categoria" />
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
        <DataTable headers={["Produto", "SKU", "Categoria", "Estrutura", "Preço", "Custo estimado", "Margem", "Disponível", "Em produção", "Status"]} empty={!rows.length && !loading}>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/produtos/${row.id}`)}>
              <TableCell><div className="flex items-center gap-2">{row.photo_url ? <img src={row.photo_url} alt="" className="h-8 w-8 rounded object-cover" /> : null}<div><span className="font-medium">{row.name}</span>{row.model ? <span className="block text-xs text-muted-foreground">{row.model}</span> : null}</div></div></TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.sku}</TableCell>
              <TableCell>{row.category || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{row.bom_version ? <>v{row.bom_version} <span className="text-xs text-muted-foreground">· {row.kits_count} kit(s)</span></> : <span className="text-muted-foreground">Sem estrutura</span>}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.sale_price)}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{row.bom_version ? brl(row.est_cost) : "-"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{row.bom_version && row.margin_percent !== null ? `${Number(row.margin_percent).toLocaleString("pt-BR")}%` : "-"}</TableCell>
              <TableCell className="text-right">{qty(row.available)}</TableCell>
              <TableCell className="text-right">{Number(row.in_production) ? qty(row.in_production) : "-"}</TableCell>
              <TableCell><StatusBadge status={row.status} /></TableCell>
            </TableRow>
          ))}
        </DataTable>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>Ordenar por:</span>
            {([["name", "Nome"], ["sku", "SKU"], ["price", "Preço"], ["cost", "Custo"], ["margin", "Margem"], ["stock", "Estoque"]] as const).map(([field, label]) => (
              <button key={field} type="button" onClick={() => sort(field)} className={`inline-flex items-center rounded px-2 py-0.5 ${order === field ? "bg-muted font-medium text-foreground" : "hover:bg-muted"}`}>{label}{order === field ? (desc ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUp className="ml-1 h-3 w-3" />) : null}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{total} produto(s) · página {page} de {pages}</span>
            <Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </SectionCard>

      <ProductSheet target={sheet} onClose={() => setSheet(null)} onSaved={(result, created) => { setSheet(null); if (created) router.push(`/produtos/${result.product_id}`); else void load() }} />
    </PageShell>
  )
}
