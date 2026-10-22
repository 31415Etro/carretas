"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard } from "@/components/operations/shared"

type Row = { id: string; kind: string; number: string; series: string; issued_at: string; total_amount: number; my_role: string; issuer_name: string; issuer_document: string; recipient_name: string; recipient_document: string }
type Papel = "" | "Destinatário" | "Remetente"
const SIZE = 50

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
// emissão vem com fuso: mostra o dia no horário do Brasil
const day = (value?: string) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-")
const cnpj = (value?: string) => {
  const digits = String(value || "").replace(/\D/g, "")
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
  return value || ""
}

/** Todas as notas importadas (entrada e saída), da mais recente para a mais antiga: quem emitiu, quem recebeu, valor e data. */
export function NfLedger({ refreshKey = 0 }: { refreshKey?: number }) {
  const [papel, setPapel] = useState<Papel>("")
  const [q, setQ] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: Row[]; total: number; sum: number }>({ items: [], total: 0, sum: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ page: String(page), size: String(SIZE) })
      if (papel) params.set("papel", papel)
      if (q.trim()) params.set("q", q.trim())
      if (de) params.set("de", de)
      if (ate) params.set("ate", ate)
      const response = await fetch(`/api/financeiro/nf?${params}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setData(payload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar as notas.")
    } finally {
      setLoading(false)
    }
  }, [page, papel, q, de, ate])

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 350 : 0)
    return () => clearTimeout(timer)
  }, [load, refreshKey, q])

  const pages = Math.max(1, Math.ceil(data.total / SIZE))
  const reset = () => setPage(1)

  return (
    <SectionCard title="Notas fiscais importadas">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {([["", "Todas"], ["Destinatário", "Entrada (recebidas)"], ["Remetente", "Saída (emitidas)"]] as Array<[Papel, string]>).map(([value, label]) => (
            <button key={value || "todas"} type="button" onClick={() => { setPapel(value); reset() }} className={`rounded px-3 py-1.5 ${papel === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(event) => { setQ(event.target.value); reset() }} placeholder="Buscar por emitente, destinatário, CNPJ ou número" className="pl-9" />
        </div>
        <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => { setDe(event.target.value); reset() }} className="mt-1 w-40" /></label>
        <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => { setAte(event.target.value); reset() }} className="mt-1 w-40" /></label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span><strong>{data.total.toLocaleString("pt-BR")}</strong> nota(s)</span>
        <span>Total: <strong>{brl(data.sum)}</strong></span>
        {loading ? <span className="text-muted-foreground">Carregando...</span> : null}
      </div>
      {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      <DataTable headers={["Emissão", "Tipo", "NF", "Quem emitiu", "Quem recebeu", "Valor", "Conta"]} empty={!data.items.length && !loading}>
        {data.items.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap">{day(row.issued_at)}</TableCell>
            <TableCell className="whitespace-nowrap">{row.my_role === "Destinatário" ? "Entrada" : "Saída"}</TableCell>
            <TableCell className="whitespace-nowrap">{row.number || "-"}{row.series ? `/${row.series}` : ""}</TableCell>
            <TableCell>{row.issuer_name || "-"}<div className="text-xs text-muted-foreground">{cnpj(row.issuer_document)}</div></TableCell>
            <TableCell>{row.recipient_name || "-"}<div className="text-xs text-muted-foreground">{cnpj(row.recipient_document)}</div></TableCell>
            <TableCell className="whitespace-nowrap text-right font-medium">{brl(row.total_amount)}</TableCell>
            <TableCell className="whitespace-nowrap">{row.my_role === "Destinatário" ? "A pagar" : "A receber"}</TableCell>
          </TableRow>
        ))}
      </DataTable>

      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">Página {page} de {pages}</span>
        <Button type="button" variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="icon" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </SectionCard>
  )
}
