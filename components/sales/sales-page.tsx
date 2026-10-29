"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, ClipboardCheck, Factory, PackageCheck, Receipt, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { documentationChannels } from "@/lib/vehicle-documentation"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr, qty, SearchBox } from "@/components/catalog/catalog-fields"
import { salesStatusLabel, salesTone } from "@/lib/sales"

type Row = {
  id: string; order_number: string; status: string; client_name: string; order_date: string; delivery_date: string | null; total_amount: number; quote_number: string | null; items_count: number
  units_ordered: number; units_ready: number; units_delivered: number; units_in_production: number; payment_confirmed: boolean
}
const SIZE = 25
const filters: Array<[string, string]> = [["abertos", "Em andamento"], ["Aguardando confirmacao", "Aguardando confirmação"], ["Aguardando producao", "Aguardando produção"], ["Em producao", "Em produção"], ["Parcialmente disponivel", "Parcialmente disponível"], ["Pronto para entrega", "Pronto para entrega"], ["Entregue", "Entregues"], ["Cancelado", "Cancelados"], ["", "Todos"]]

export function SalesPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [settings, setSettings] = useState<Record<string, any> | null>(null)
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const data = await api<{ items: Row[]; total: number }>(`/api/vendas?${new URLSearchParams({ q: query, status, pagina: String(page), tamanho: String(SIZE) })}`)
      setRows(data.items); setTotal(data.total)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar os pedidos.") } finally { setLoading(false) }
  }, [query, status, page])
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 300 : 0); return () => clearTimeout(timer) }, [load, query])
  useEffect(() => { api<Record<string, any>>("/api/vendas/config").then(setSettings).catch(() => setSettings(null)) }, [])

  async function saveSetting(patch: Record<string, unknown>) {
    setNotice("")
    try {
      setSettings(await api<Record<string, any>>("/api/vendas/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }))
      setNotice("Regra atualizada e registrada.")
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Não foi possível alterar a regra.") }
  }

  const pages = Math.max(1, Math.ceil(total / SIZE))
  const awaiting = rows.filter((row) => row.status === "Aguardando confirmacao").length
  const producing = rows.reduce((sum, row) => sum + Number(row.units_in_production), 0)
  const ready = rows.reduce((sum, row) => sum + Number(row.units_ready), 0)

  return (
    <PageShell title="Pedidos de venda" description="Orçamento aprovado → pedido de venda → confirmação → estoque de acabados e produção. O pedido nasce da conversão do orçamento aprovado."
      actions={<Button variant="outline" asChild><Link href="/comercial"><Receipt className="h-4 w-4" />Ir para o Comercial / CRM</Link></Button>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Pedidos" value={total} note="no filtro" icon={Receipt} />
        <MetricCard title="Aguardando confirmação" value={awaiting} note="nesta página" icon={ClipboardCheck} />
        <MetricCard title="Em fabricação" value={qty(producing)} note="unidades (nesta página)" icon={Factory} />
        <MetricCard title="Prontas para entrega" value={qty(ready)} note="unidades reservadas (nesta página)" icon={PackageCheck} />
      </div>

      <SectionCard title="Regras da empresa para liberar a fabricação" description="A demanda e os materiais são planejados quando o pedido é confirmado; o início físico espera todas as condições ligadas aqui. Só administrador ou gerente altera, e cada mudança fica registrada.">
        <div className="grid gap-2 text-sm md:grid-cols-2">
          {([["require_documentation_before_production", "Exigir documentação veicular aprovada (pré-cadastro de cada unidade)"], ["require_operational_authorization", "Exigir autorização operacional registrada"], ["require_payment_before_production", "Exigir confirmação de sinal/pagamento"],
            ["allow_payment_exception", "Permitir exceção formal da exigência de sinal (com justificativa e auditoria)"], ["generate_receivables_on_confirmation", "Gerar títulos a receber previstos ao confirmar o pedido"]] as const).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={Boolean(settings?.[key])} disabled={!settings} onChange={(event) => void saveSetting({ [key]: event.target.checked })} /><span>{label}</span></label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">Canal da documentação</span>
            <select className="h-9 rounded-md border bg-background px-2" value={String(settings?.documentation_channel || "manual")} disabled={!settings} onChange={(event) => void saveSetting({ documentation_channel: event.target.value })}>
              {documentationChannels.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">Alertar sem retorno há (dias)</span>
            <Input className="w-24" inputMode="numeric" defaultValue={String(settings?.documentation_stale_days || 7)} key={String(settings?.documentation_stale_days)} onBlur={(event) => { const days = Number(event.target.value); if (days >= 1 && days <= 90 && days !== Number(settings?.documentation_stale_days)) void saveSetting({ documentation_stale_days: days }) }} /></label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{documentationChannels.find((channel) => channel.value === (settings?.documentation_channel || "manual"))?.detail}</p>
        {notice ? <p className="mt-2 rounded-md border bg-muted/40 p-2 text-sm">{notice}</p> : null}
      </SectionCard>

      <SectionCard title="Pedidos">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1) }} placeholder="Buscar por pedido, cliente ou orçamento" />
          <select value={status} aria-label="Situação" className="h-9 rounded-md border bg-background px-3 text-sm" onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
            {filters.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Pedido", "Cliente", "Orçamento", "Situação", "Unidades", "Prontas", "Entregues", "Em fabricação", "Total", "Previsão"]} empty={!rows.length && !loading}>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/vendas/${row.id}`)}>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.order_number}</TableCell>
              <TableCell className="font-medium">{row.client_name}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.quote_number || "-"}</TableCell>
              <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${salesTone(row.status)}`}>{salesStatusLabel(row.status)}</span></TableCell>
              <TableCell className="text-right">{qty(row.units_ordered)}</TableCell>
              <TableCell className="text-right">{Number(row.units_ready) ? qty(row.units_ready) : "-"}</TableCell>
              <TableCell className="text-right">{Number(row.units_delivered) ? qty(row.units_delivered) : "-"}</TableCell>
              <TableCell className="text-right">{Number(row.units_in_production) ? qty(row.units_in_production) : "-"}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.total_amount)}</TableCell>
              <TableCell className="whitespace-nowrap">{dateBr(row.delivery_date)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{total} pedido(s) · página {page} de {pages}</span>
          <Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="icon" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </SectionCard>
    </PageShell>
  )
}
