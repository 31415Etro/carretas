"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, MetricCard, SectionCard, SelectField, StatusBadge, TextField, useCrudFeedback } from "@/components/operations/shared"
import { Activity, AlertTriangle, ShieldAlert } from "lucide-react"
import { auditActions, auditModules } from "@/lib/audit-catalog"

type Row = Record<string, any>
type Filters = { start: string; end: string; module: string; action: string; result: string; origin: string; actor: string; record: string; q: string; company: string }

const none = "nenhum"
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }) : "-")
const initial = (): Filters => ({ start: iso(7), end: iso(0), module: "", action: "", result: "", origin: "", actor: "", record: "", q: "", company: "current" })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const query = (filters: Filters, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams()
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => value && params.set(key, value))
  return params.toString()
}

function Opts({ label, value, onChange, items, placeholder }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder: string }) {
  return <SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} />
}

const display = (value: unknown) => (value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value))

export function AuditPanel() {
  const { toast } = useCrudFeedback()
  const [filters, setFilters] = useState<Filters>(initial())
  const [events, setEvents] = useState<Row[]>([])
  const [next, setNext] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [summary, setSummary] = useState<{ last24h: number; denied24h: number; failed24h: number } | null>(null)
  const [detail, setDetail] = useState<Row | null>(null)
  const [retention, setRetention] = useState("")
  const [integrity, setIntegrity] = useState<Array<{ scope: string; ok: boolean; checked: number; brokenSeq: number | null }> | null>(null)

  const search = useCallback(async (current: Filters, before = "") => {
    setLoading(true)
    try {
      const result = await api<{ events: Row[]; nextBefore: string }>(`/api/auditoria?${query(current, before ? { before } : {})}`)
      setEvents((previous) => (before ? [...previous, ...result.events] : result.events))
      setNext(result.nextBefore)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao consultar a auditoria.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void search(initial())
    api<{ last24h: number; denied24h: number; failed24h: number }>("/api/auditoria/summary").then(setSummary).catch(() => undefined)
    api<{ retentionDays: number }>("/api/auditoria/settings").then((value) => setRetention(String(value.retentionDays))).catch(() => undefined)
  }, [search])

  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))

  async function openDetail(id: string) {
    try {
      setDetail(await api<Row>(`/api/auditoria/${id}`))
    } catch (reason) {
      toast({ title: "Não foi possível abrir o evento", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function verify() {
    try {
      setIntegrity((await api<{ results: Array<{ scope: string; ok: boolean; checked: number; brokenSeq: number | null }> }>("/api/auditoria/verify", { method: "POST" })).results)
    } catch (reason) {
      toast({ title: "Verificação não concluída", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function saveRetention() {
    try {
      await api("/api/auditoria/settings", { method: "PUT", body: JSON.stringify({ retentionDays: Number(retention) }) })
      toast({ title: "Retenção atualizada", description: `Eventos mantidos por ${retention} dias; o expurgo roda diariamente.` })
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  const changedKeys: string[] = detail ? Array.from(new Set([...Object.keys(detail.oldValues || {}), ...Object.keys(detail.newValues || {})])) : []

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Eventos nas últimas 24 h" value={summary?.last24h ?? "-"} note="Nesta empresa e acessos sem empresa" icon={Activity} />
        <MetricCard title="Acessos negados (24 h)" value={summary?.denied24h ?? "-"} note="Tentativas sem permissão" icon={ShieldAlert} />
        <MetricCard title="Falhas (24 h)" value={summary?.failed24h ?? "-"} note="Logins inválidos e ações que falharam" icon={AlertTriangle} />
      </div>

      <SectionCard title="Filtros" description="A trilha só pode ser lida por administradores; consultas e exportações também ficam registradas.">
        <div className="grid gap-3 md:grid-cols-4">
          <TextField label="De" type="date" value={filters.start} onChange={(value) => set({ start: value })} />
          <TextField label="Até" type="date" value={filters.end} onChange={(value) => set({ end: value })} />
          <Opts label="Módulo" value={filters.module} onChange={(value) => set({ module: value })} items={auditModules.map((item) => ({ value: item.value, label: item.label }))} placeholder="Todos" />
          <Opts label="Tipo de ação" value={filters.action} onChange={(value) => set({ action: value })} items={auditActions.map((value) => ({ value, label: value }))} placeholder="Todas" />
          <Opts label="Resultado" value={filters.result} onChange={(value) => set({ result: value })} items={["Sucesso", "Falha", "Negado"].map((value) => ({ value, label: value }))} placeholder="Todos" />
          <Opts label="Origem" value={filters.origin} onChange={(value) => set({ origin: value })} items={["Usuário", "API", "Integração", "Agendador", "Sistema"].map((value) => ({ value, label: value }))} placeholder="Todas" />
          <TextField label="Usuário (e-mail)" value={filters.actor} onChange={(value) => set({ actor: value })} />
          <TextField label="Registro / requisição (ID)" value={filters.record} onChange={(value) => set({ record: value })} />
          <TextField label="Descrição contém" value={filters.q} onChange={(value) => set({ q: value })} />
          <Opts label="Empresa" value={filters.company === "current" ? "" : filters.company} onChange={(value) => set({ company: value || "current" })} items={[{ value: "all", label: "Todas as empresas" }]} placeholder="Empresa selecionada" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void search(filters)} disabled={loading}><Search className="h-4 w-4" />Consultar</Button>
          <Button variant="outline" onClick={() => { const reset = initial(); setFilters(reset); void search(reset) }} disabled={loading}><RefreshCw className="h-4 w-4" />Limpar</Button>
          <Button variant="outline" asChild><a href={`/api/auditoria/export?${query(filters)}`}><Download className="h-4 w-4" />Exportar CSV</a></Button>
          <Button variant="outline" onClick={() => void verify()}><ShieldCheck className="h-4 w-4" />Verificar integridade</Button>
        </div>
        {integrity && (
          <div className="mt-3 space-y-1 text-sm">
            {integrity.map((item) => <div key={item.scope} className={item.ok ? "text-green-700" : "font-medium text-destructive"}>{item.scope}: {item.ok ? `íntegra (${item.checked} evento(s) verificados)` : `INCONSISTENTE no evento ${item.brokenSeq} — a sequência foi alterada ou há eventos removidos`}</div>)}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Eventos">
        <DataTable headers={["Evento", "Data/hora", "Usuário", "Módulo", "Ação", "Registro", "Descrição", "Resultado", "Origem", ""]} empty={!loading && !events.length}>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="font-mono text-xs">{event.seq}</TableCell><TableCell className="whitespace-nowrap">{stamp(event.at)}</TableCell><TableCell>{event.actorName}</TableCell>
              <TableCell>{auditModules.find((item) => item.value === event.module)?.label || event.module}</TableCell><TableCell>{event.action}</TableCell><TableCell className="max-w-[10rem] truncate font-mono text-xs" title={event.recordId}>{event.recordId || "-"}</TableCell>
              <TableCell className="max-w-md"><p className="line-clamp-2" title={event.description}>{event.description}</p></TableCell>
              <TableCell><StatusBadge status={event.result === "Sucesso" ? "Sucesso" : event.result === "Negado" ? "Negado" : "Falha"} /></TableCell><TableCell>{event.origin}</TableCell>
              <TableCell><Button size="sm" variant="outline" onClick={() => void openDetail(event.id)}>Detalhes</Button></TableCell>
            </TableRow>
          ))}
        </DataTable>
        {next && <Button className="mt-3" variant="outline" onClick={() => void search(filters, next)} disabled={loading}>Carregar mais</Button>}
      </SectionCard>

      <SectionCard title="Retenção" description="Os eventos são mantidos pelo prazo abaixo (mínimo 365 dias) e depois removidos automaticamente, uma vez por dia. Nada além disso apaga ou altera a trilha.">
        <div className="flex max-w-md items-end gap-2">
          <TextField label="Manter eventos por (dias)" type="number" value={retention} onChange={setRetention} />
          <Button onClick={() => void saveRetention()}>Salvar</Button>
        </div>
      </SectionCard>

      <Sheet open={Boolean(detail)} onOpenChange={(value) => !value && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>Evento {detail?.seq}</SheetTitle><SheetDescription>{detail?.description}</SheetDescription></SheetHeader>
          {detail && (
            <div className="space-y-4 px-4 pb-6 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                {[["Data e hora", stamp(detail.at)], ["Usuário", `${detail.actorName}${detail.actorEmail ? ` (${detail.actorEmail})` : ""}`], ["Empresa", detail.companyName], ["Módulo", auditModules.find((item) => item.value === detail.module)?.label || detail.module],
                  ["Ação", detail.action], ["Tabela", detail.tableName || "-"], ["Registro afetado", detail.recordId || "-"], ["Resultado", detail.result], ["Origem", detail.origin], ["IP", detail.ip || "-"],
                  ["Sessão", detail.sessionId || "-"], ["Requisição", detail.requestId || "-"], ["Motivo", detail.reason || "-"]].map(([label, value]) => (
                  <div key={label as string}><div className="text-xs text-muted-foreground">{label}</div><div className="break-all">{value}</div></div>
                ))}
              </div>
              {changedKeys.length > 0 && (
                <div>
                  <h3 className="mb-1 font-medium">Valores alterados</h3>
                  <DataTable headers={["Campo", "Antes", "Depois"]}>
                    {changedKeys.map((key) => <TableRow key={key}><TableCell className="font-mono text-xs">{key}</TableCell><TableCell className="break-all">{display(detail.oldValues?.[key])}</TableCell><TableCell className="break-all">{display(detail.newValues?.[key])}</TableCell></TableRow>)}
                  </DataTable>
                  <p className="mt-1 text-xs text-muted-foreground">Senhas, tokens e assinaturas nunca são gravados; documentos aparecem mascarados.</p>
                </div>
              )}
              <div className="break-all font-mono text-xs text-muted-foreground">hash {detail.hash}<br />anterior {detail.prevHash}</div>
              {detail.requestId && <Button variant="outline" size="sm" onClick={() => { const next = { ...filters, record: detail.requestId }; setFilters(next); setDetail(null); void search(next) }}>Ver todos os eventos desta requisição</Button>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
