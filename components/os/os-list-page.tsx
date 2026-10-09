"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SectionCard, SelectField, StatusBadge } from "@/components/operations/shared"
import { osKinds, osStatuses } from "@/lib/os-workflow"

type Row = { id: string; orderNumber: string; status: string; orderKind: string; priority: string; clientName: string; asset: string; technician: string; description: string; openedAt: string; plannedStart: string; dueDate: string; finishedAt: string; totalAmount: number; costAmount: number }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value: string) => value ? value.slice(0, 10).split("-").reverse().join("/") : "-"
const today = () => new Date().toISOString().slice(0, 10)
const closed = new Set(["Concluída", "Entregue", "Cancelada", "Finalizada", "Finalizada parcialmente"])

export function OsListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState("abertas")
  const [kind, setKind] = useState("todos")
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/os", { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setRows(payload.orders)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar OS.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => Object.fromEntries(osStatuses.map((item) => [item, rows.filter((row) => row.status === item).length])), [rows])
  const visible = rows.filter((row) => {
    const statusMatch = status === "todas" || (status === "abertas" ? !closed.has(row.status) : status === "atrasadas" ? !closed.has(row.status) && row.dueDate && row.dueDate < today() : row.status === status)
    const kindMatch = kind === "todos" || row.orderKind === kind
    const text = [row.orderNumber, row.clientName, row.asset, row.technician, row.description].join(" ").toLowerCase()
    return statusMatch && kindMatch && text.includes(query.toLowerCase())
  })
  const late = rows.filter((row) => !closed.has(row.status) && row.dueDate && row.dueDate < today()).length

  return (
    <PageShell title="Ordens de Serviço" description="Manutenção, reparos, instalações e fabricação de carretas, do atendimento à entrega." actions={<Button asChild><Link href="/ordens-servico/nova"><Plus className="h-4 w-4" />Nova OS</Link></Button>}>
      <div className="flex flex-wrap gap-2">
        {[{ value: "abertas", label: `Em aberto (${rows.filter((row) => !closed.has(row.status)).length})` }, { value: "atrasadas", label: `Atrasadas (${late})` }, ...osStatuses.map((item) => ({ value: item, label: `${item} (${counts[item] || 0})` })), { value: "todas", label: `Todas (${rows.length})` }].map((chip) => (
          <Button key={chip.value} size="sm" variant={status === chip.value ? "default" : "outline"} onClick={() => setStatus(chip.value)}>{chip.label}</Button>
        ))}
      </div>
      <SectionCard title="OS">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Input className="max-w-sm" placeholder="Número, cliente, carreta, técnico..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="min-w-[220px]"><SelectField label="Tipo" value={kind} onChange={setKind} options={[{ value: "todos", label: "Todos os tipos" }, ...osKinds.map((item) => ({ value: item, label: item }))]} /></div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Nº", "Abertura", "Tipo", "Cliente", "Carreta / veículo", "Técnico", "Prioridade", "Prazo", "Situação", "Total", "Margem"]} empty={!visible.length} stickyHeader viewportClassName="max-h-[40rem] overflow-auto overscroll-contain" tableClassName="min-w-[1300px]">
          {visible.map((row) => {
            const isLate = !closed.has(row.status) && row.dueDate && row.dueDate < today()
            const margin = row.totalAmount > 0 ? Math.round(((row.totalAmount - row.costAmount) / row.totalAmount) * 1000) / 10 : null
            return <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/ordens-servico/${row.id}`)}>
              <TableCell className="font-mono">{row.orderNumber}</TableCell>
              <TableCell>{day(row.openedAt)}</TableCell>
              <TableCell>{row.orderKind || "-"}</TableCell>
              <TableCell>{row.clientName}</TableCell>
              <TableCell>{row.asset || "-"}</TableCell>
              <TableCell>{row.technician}</TableCell>
              <TableCell className={row.priority === "Urgente" ? "font-semibold text-destructive" : ""}>{row.priority === "Media" ? "Média" : row.priority}</TableCell>
              <TableCell className={isLate ? "font-semibold text-destructive" : ""}>{day(row.dueDate)}</TableCell>
              <TableCell><StatusBadge status={row.status} /></TableCell>
              <TableCell>{brl(row.totalAmount)}</TableCell>
              <TableCell>{margin === null ? "-" : `${margin.toLocaleString("pt-BR")}%`}</TableCell>
            </TableRow>
          })}
        </DataTable>
      </SectionCard>
    </PageShell>
  )
}
