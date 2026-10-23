"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, Boxes, PackageCheck, Plus, RefreshCw, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { api, brl, qty, SearchBox } from "@/components/catalog/catalog-fields"
import { RawMaterialSheet, type RawMaterialSheetTarget } from "@/components/raw-materials/raw-material-sheet"
import { stockSituation } from "@/lib/raw-materials"
import { useAuth } from "@/lib/auth-context"

type Row = {
  id: string; sku: string; name: string; category: string | null; subcategory: string | null; unit: string; status: string; ncm: string | null; photo_url: string | null
  unit_cost: number; minimum_stock: number; reorder_point: number; physical: number; reserved: number; available: number; incoming: number
  below_minimum: boolean; needs_reorder: boolean; primary_supplier: string | null; kits_count: number
}
const tones = { danger: "bg-red-100 text-red-800", warning: "bg-amber-100 text-amber-800", muted: "bg-slate-100 text-slate-700", ok: "bg-emerald-100 text-emerald-800" }

export function RawMaterialsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const canStock = user?.role === "admin" || Boolean(user?.permissions?.includes("estoque"))
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"Ativo" | "Inativo" | "">("Ativo")
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sheet, setSheet] = useState<RawMaterialSheetTarget>(null)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ q: query, status, abaixoMinimo: onlyBelow ? "1" : "" })
      setRows((await api<{ items: Row[] }>(`/api/materias-primas?${params}`)).items)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar as matérias-primas.")
    } finally {
      setLoading(false)
    }
  }, [query, status, onlyBelow])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])

  const below = rows.filter((row) => row.below_minimum).length
  const reorder = rows.filter((row) => row.needs_reorder && !row.below_minimum).length
  const stockValue = rows.reduce((sum, row) => sum + Number(row.physical) * Number(row.unit_cost), 0)

  return (
    <PageShell title="Matérias-primas" description="Materiais e insumos usados na fabricação: especificações, fornecedores, estoque da empresa e kits em que cada um é usado."
      actions={<>{canStock ? <Button variant="outline" asChild><Link href="/estoque?aba=movimentacoes">Movimentos, inventário e depósitos</Link></Button> : null}<Button onClick={() => setSheet({})}><Plus className="h-4 w-4" />Nova matéria-prima</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Matérias-primas" value={rows.length} note={status ? `${status === "Ativo" ? "ativas" : "inativas"} na lista` : "na lista"} icon={Boxes} />
        <MetricCard title="Abaixo do mínimo" value={below} note="saldo físico menor que o estoque mínimo" icon={AlertTriangle} onClick={() => setOnlyBelow(!onlyBelow)} />
        <MetricCard title="Para repor" value={reorder} note="disponível + a receber no ponto de reposição" icon={ShoppingCart} />
        <MetricCard title="Valor em estoque" value={brl(stockValue)} note="saldo físico da empresa × custo vigente" icon={PackageCheck} />
      </div>

      <SectionCard title="Cadastro">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar por nome, SKU, categoria ou código do fornecedor" />
          <div className="flex rounded-md border p-0.5 text-sm">
            {([["Ativo", "Ativas"], ["Inativo", "Inativas"], ["", "Todas"]] as const).map(([value, label]) => (
              <button key={label} type="button" onClick={() => setStatus(value)} className={`rounded px-3 py-1.5 ${status === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyBelow} onChange={(event) => setOnlyBelow(event.target.checked)} />Só abaixo do mínimo</label>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["SKU", "Matéria-prima", "Categoria", "Un.", "Custo vigente", "Físico", "Reservado", "Disponível", "A receber", "Situação", "Fornecedor principal", "Kits", "Status"]} empty={!rows.length && !loading} stickyHeader viewportClassName="max-h-[62vh]">
          {rows.map((row) => {
            const situation = stockSituation({ physical: Number(row.physical), available: Number(row.available), incoming: Number(row.incoming), minimumStock: Number(row.minimum_stock), reorderPoint: Number(row.reorder_point) })
            return (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/materias-primas/${row.id}`)}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{row.sku || "-"}</TableCell>
                <TableCell><div className="flex items-center gap-2">{row.photo_url ? <img src={row.photo_url} alt="" className="h-8 w-8 rounded object-cover" /> : null}<span className="font-medium">{row.name}</span></div></TableCell>
                <TableCell>{[row.category, row.subcategory].filter(Boolean).join(" / ") || "-"}</TableCell>
                <TableCell>{row.unit}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(row.unit_cost)}</TableCell>
                <TableCell className="text-right">{qty(row.physical)}</TableCell>
                <TableCell className="text-right">{qty(row.reserved)}</TableCell>
                <TableCell className="text-right font-medium">{qty(row.available)}</TableCell>
                <TableCell className="text-right">{Number(row.incoming) > 0 ? qty(row.incoming) : "-"}</TableCell>
                <TableCell><span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${tones[situation.tone]}`}>{situation.label}</span></TableCell>
                <TableCell>{row.primary_supplier || <span className="text-muted-foreground">Sem fornecedor</span>}</TableCell>
                <TableCell className="text-center">{row.kits_count || "-"}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
              </TableRow>
            )
          })}
        </DataTable>
        <p className="mt-2 text-xs text-muted-foreground">Os saldos mostram o estoque da empresa selecionada. O cadastro é compartilhado entre as empresas; estoque, compras e produção não.</p>
      </SectionCard>

      <RawMaterialSheet target={sheet} onClose={() => setSheet(null)} onSaved={(result, created) => { setSheet(null); if (created) router.push(`/materias-primas/${result.id}`); else void load() }} />
    </PageShell>
  )
}
