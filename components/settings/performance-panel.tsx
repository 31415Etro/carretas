"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard } from "@/components/operations/shared"

type Snapshot = {
  since: string; thresholdMs: number; totalRequests: number; totalSlow: number
  routes: Array<{ route: string; count: number; avgMs: number; p95Ms: number; maxMs: number; slow: number; lastSlowAt: string }>
  recent: Array<{ at: string; method: string; route: string; url: string; status: number; ms: number }>
}

const stamp = (value: string) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-")
const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : `${ms} ms`)
const tone = (ms: number) => (ms >= 3000 ? "font-semibold text-destructive" : ms >= 1000 ? "font-medium text-amber-600" : "")

/** Configurações > Desempenho: quais páginas e APIs passam de 1 segundo. Visível só para o dono do sistema. */
export function PerformancePanel() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/desempenho?limite=300", { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setData(payload as Snapshot); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function clear() {
    if (!window.confirm("Zerar as medições? Elas voltam a ser coletadas do zero.")) return
    await fetch("/api/desempenho", { method: "DELETE" })
    await load()
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Desempenho do sistema" description={`Mede o tempo de toda página e API atendida pelo servidor. Aparece aqui o que passa de ${data ? seconds(data.thresholdMs) : "1 s"}. Medindo desde ${data ? stamp(data.since) : "..."}.`}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Atualizar</Button>
          <Button variant="ghost" onClick={() => void clear()}><Trash2 className="h-4 w-4" />Zerar medições</Button>
          {data ? <span className="text-muted-foreground">{data.totalRequests.toLocaleString("pt-BR")} requisições medidas · {data.totalSlow.toLocaleString("pt-BR")} lentas guardadas</span> : null}
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Rotas mais lentas" description="Média, p95 (95% das chamadas levam menos que isso) e pior caso. Ordenadas por quantidade de chamadas lentas.">
        <DataTable headers={["Rota", "Chamadas", "Média", "p95", "Pior", "Lentas", "Última lenta"]} empty={!data?.routes.length}>
          {(data?.routes || []).map((item) => (
            <TableRow key={item.route}>
              <TableCell className="font-mono text-xs">{item.route}</TableCell>
              <TableCell className="text-right">{item.count.toLocaleString("pt-BR")}</TableCell>
              <TableCell className={`text-right ${tone(item.avgMs)}`}>{seconds(item.avgMs)}</TableCell>
              <TableCell className={`text-right ${tone(item.p95Ms)}`}>{seconds(item.p95Ms)}</TableCell>
              <TableCell className={`text-right ${tone(item.maxMs)}`}>{seconds(item.maxMs)}</TableCell>
              <TableCell className="text-right">{item.slow}</TableCell>
              <TableCell className="whitespace-nowrap">{stamp(item.lastSlowAt)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Chamadas lentas recentes" description="As mais novas primeiro, com o endereço completo (filtros incluídos).">
        <DataTable headers={["Quando", "Método", "Endereço", "Status", "Tempo"]} empty={!data?.recent.length}>
          {(data?.recent || []).map((item, index) => (
            <TableRow key={`${item.at}-${index}`}>
              <TableCell className="whitespace-nowrap">{stamp(item.at)}</TableCell>
              <TableCell>{item.method}</TableCell>
              <TableCell className="max-w-[520px] break-all font-mono text-xs">{item.url}</TableCell>
              <TableCell>{item.status}</TableCell>
              <TableCell className={`whitespace-nowrap text-right ${tone(item.ms)}`}>{seconds(item.ms)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </div>
  )
}
