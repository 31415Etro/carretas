"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileCheck2, FileWarning, RefreshCw, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, dateBr, SearchBox } from "@/components/catalog/catalog-fields"
import { DocumentationSheet } from "@/components/documentation/documentation-sheet"
import { ManualDocumentationSheet } from "@/components/documentation/manual-documentation-sheet"
import { docStatusLabel, docStatusTone } from "@/lib/vehicle-documentation"

type Row = {
  id: string; sales_order_id: string; order_number: string; client_name: string; product_name: string; product_model: string | null; unit_number: number; units_in_item: number; vin: string | null; protocol: string | null
  portal: string; status: string; final_stage: string; submitted_at: string | null; last_checked_at: string | null; responsible: string | null; pendencies: string[]; last_error: string | null; stale: boolean
}
const SIZE = 25
const filters: Array<[string, string]> = [["abertas", "Em andamento"], ["atencao", "Pedem ação"], ["Pendente de dados", "Pendentes de dados"], ["Pronto para envio", "Prontas para envio"], ["Enviado", "Enviadas"], ["Aguardando processamento", "Aguardando processamento"], ["Em exigencia", "Em exigência"], ["Rejeitado", "Rejeitadas"], ["Aprovado para liberacao", "Aprovadas"], ["Cancelado", "Canceladas"], ["", "Todas"]]

export function DocumentationPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [dashboard, setDashboard] = useState<Record<string, number>>({})
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("abertas")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const data = await api<{ items: Row[]; total: number; dashboard: Record<string, number> }>(`/api/documentacao?${new URLSearchParams({ q: query, status, pagina: String(page), tamanho: String(SIZE), painel: "1" })}`)
      setRows(data.items); setTotal(data.total); setDashboard(data.dashboard || {})
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a documentação.") } finally { setLoading(false) }
  }, [query, status, page])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])

  const pages = Math.max(1, Math.ceil(total / SIZE))
  return (
    <PageShell title="Documentação veicular" description="Pré-cadastro de cada carreta (vendida ou aberta sem pedido), uma documentação por unidade. Ela corre em paralelo à fabricação; a expedição exige a documentação liberada."
      actions={<><Button onClick={() => setCreating(true)}>Nova documentação</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button></>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Em andamento" value={Number(dashboard.open || 0)} note={`${Number(dashboard.pending_data || 0)} pendentes de dados · ${Number(dashboard.ready || 0)} prontas para envio`} icon={FileCheck2} />
        <MetricCard title="Aguardando o portal" value={Number(dashboard.waiting || 0)} note={`${Number(dashboard.stale || 0)} sem retorno há muito tempo`} icon={Clock} />
        <MetricCard title="Exigências e rejeições" value={Number(dashboard.requirements || 0) + Number(dashboard.rejected || 0)} note={`${Number(dashboard.requirements || 0)} em exigência · ${Number(dashboard.rejected || 0)} rejeitadas`} icon={FileWarning} />
        <MetricCard title="Liberadas" value={Number(dashboard.approved || 0)} note="pré-cadastro aprovado" icon={CheckCircle2} />
      </div>
      {Number(dashboard.stale || 0) > 0 ? <p className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />{dashboard.stale} solicitação(ões) sem retorno do portal há mais que o prazo da empresa: consulte o andamento.</p> : null}

      <SectionCard title="Unidades">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Buscar por pedido, cliente, chassi, protocolo ou produto" />
          <select value={status} aria-label="Situação" className="h-9 rounded-md border bg-background px-3 text-sm" onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
            {filters.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </div>
        <DataTable headers={["Pedido", "Cliente", "Produto", "Unidade", "Chassi / VIN", "Protocolo", "Situação", "Enviado", "Última consulta", "Responsável", "Pendências"]} empty={!rows.length && !loading}>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row.id)}>
              <TableCell className="whitespace-nowrap font-mono text-xs"><Link href={`/vendas/${row.sales_order_id}`} className="text-primary underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>{row.order_number}</Link></TableCell>
              <TableCell>{row.client_name}</TableCell>
              <TableCell>{row.product_name}</TableCell>
              <TableCell className="text-center">{row.unit_number}/{row.units_in_item}</TableCell>
              <TableCell className="font-mono text-xs">{row.vin || <span className="text-muted-foreground">a informar</span>}</TableCell>
              <TableCell className="font-mono text-xs">{row.protocol || "-"}</TableCell>
              <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${docStatusTone(row.status)}`}>{docStatusLabel(row.status)}</span>{row.stale ? <span className="ml-1 text-xs text-red-700">atrasada</span> : null}</TableCell>
              <TableCell className="whitespace-nowrap">{dateBr(row.submitted_at)}</TableCell>
              <TableCell className="whitespace-nowrap">{dateBr(row.last_checked_at)}</TableCell>
              <TableCell>{row.responsible || "-"}</TableCell>
              <TableCell className="max-w-[240px] truncate text-xs" title={(row.pendencies || []).join("; ")}>{(row.pendencies || []).length ? (row.pendencies as string[]).join("; ") : row.last_error || "-"}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{total} unidade(s) · página {page} de {pages}</span>
          <Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="icon" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Send className="h-3 w-3" />O acompanhamento dos protocolos roda no servidor uma vez por dia (e pelo botão "Consultar andamento"); não depende desta página aberta.</p>
      </SectionCard>
      <ManualDocumentationSheet open={creating} onOpenChange={setCreating} onCreated={(id) => { void load(); setSelected(id) }} />
      <DocumentationSheet id={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
    </PageShell>
  )
}
