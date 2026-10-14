"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, CheckCircle2, Link2, Loader2, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SectionCard, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { amountOf, dateOf, daysBetween, descriptionSimilarity, STATEMENT_ORIGIN } from "@/lib/bank-reconciliation"
import { money, type AccountsPayable, type FinancialState, type FinancialTransaction } from "@/lib/financial-storage"

type Kind = "tx" | "ap"
type Row = { key: string; kind: Kind; id: string; date: string; description: string; party: string; type: "Entrada" | "Saida"; amount: number; status: string; origin: string; category: string; hasCategory: boolean }

const day = (value?: string) => (value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "-")
const kindLabel: Record<Kind, string> = { tx: "Entradas e Saídas", ap: "Contas a Pagar" }
const viewport = "max-h-[28rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]"
const same = (a: number, b: number) => Math.abs(a - b) <= 0.009

function toRows(state: FinancialState): Row[] {
  const categories = new Map(state.categories.map((item) => [item.id, item.name]))
  const tx = (state.transactions as FinancialTransaction[]).filter((item) => item.status !== "Cancelado").map((item): Row => ({
    key: `tx:${item.id}`, kind: "tx", id: item.id, date: dateOf(item), description: item.description, party: item.supplierName || "", type: item.type, amount: amountOf(item),
    status: item.status, origin: item.origin || "", category: categories.get(item.categoryId) || "", hasCategory: Boolean(item.categoryId),
  }))
  const ap = (state.accountsPayable as AccountsPayable[]).filter((item) => item.status !== "Cancelada").map((item): Row => ({
    key: `ap:${item.id}`, kind: "ap", id: item.id, date: item.paymentDate || item.dueDate, description: item.description, party: item.supplierName || "", type: "Saida",
    amount: Number(item.paidAmount) > 0 ? Number(item.paidAmount) : Number(item.expectedAmount || 0), status: item.status, origin: "Conta a pagar", category: categories.get(item.categoryId) || "", hasCategory: Boolean(item.categoryId),
  }))
  return [...tx, ...ap]
}

export function ReconciliationPage() {
  const params = useSearchParams()
  const { toast } = useCrudFeedback()
  const [state, setState] = useState<FinancialState | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [sourceKey, setSourceKey] = useState(() => (params.get("kind") && params.get("id") ? `${params.get("kind")}:${params.get("id")}` : ""))
  const [targetKey, setTargetKey] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [query, setQuery] = useState("")
  const [fonte, setFonte] = useState<"todos" | Kind>("todos")
  const [onlySame, setOnlySame] = useState(true)
  const [keep, setKeep] = useState<"source" | "target">("source")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/financial-state?refresh=1", { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.state) throw new Error(payload?.error || "Não foi possível carregar o financeiro.")
      setState(payload.state)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => (state ? toRows(state) : []), [state])
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const source = sourceKey ? byKey.get(sourceKey) : undefined
  const target = targetKey ? byKey.get(targetKey) : undefined

  const list = useMemo(() => {
    const text = query.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (source && (row.key === source.key || row.type !== source.type)) return false
      if (source?.kind === "ap" && row.kind === "ap") return false // duas contas a pagar não se conciliam
      if (fonte !== "todos" && row.kind !== fonte) return false
      if (start && (!row.date || row.date < start)) return false
      if (end && (!row.date || row.date > end)) return false
      if (text && !`${row.description} ${row.party} ${row.category} ${row.amount.toFixed(2)} ${String(row.amount).replace(".", ",")}`.toLowerCase().includes(text)) return false
      if (source && onlySame && !same(row.amount, source.amount)) return false
      return true
    })
    const score = (row: Row) => source ? (same(row.amount, source.amount) ? 60 : 0) + Math.max(0, 25 - daysBetween(row.date, source.date) * 2.5) + descriptionSimilarity(source.description, `${row.description} ${row.party}`) * 15 : 0
    return filtered.sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date))
  }, [rows, source, fonte, start, end, query, onlySame])

  const problem = useMemo(() => {
    if (!source || !target) return ""
    if (source.type !== target.type) return "Entrada não concilia com saída."
    if (source.kind === "ap" && target.kind === "ap") return "Duas contas a pagar não se conciliam: exclua a duplicada em Contas a Pagar."
    return ""
  }, [source, target])
  const bothTx = source?.kind === "tx" && target?.kind === "tx"
  const bankInvolved = bothTx && (source!.origin === STATEMENT_ORIGIN || target!.origin === STATEMENT_ORIGIN)
  const differs = source && target ? !same(source.amount, target.amount) : false

  function chooseTarget(row: Row) {
    setTargetKey(row.key === targetKey ? "" : row.key)
    setDone("")
    if (source && row.kind === "tx" && source.kind === "tx") {
      // sugestão de quem fica: o que veio de conta a pagar, senão o que tem categoria, senão a origem
      const prefer = (item: Row) => (item.origin === "Conta a pagar" ? 2 : 0) + (item.hasCategory ? 1 : 0)
      setKeep(prefer(row) > prefer(source) ? "target" : "source")
    }
  }

  async function conciliar() {
    if (!source || !target || problem) return
    setBusy(true)
    try {
      const response = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: { kind: source.kind, id: source.id }, target: { kind: target.kind, id: target.id }, keep }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || payload?.failed?.[0]?.error || "Não foi possível conciliar.")
      setDone(payload.message || "Conciliado.")
      toast({ title: "Conciliação feita", description: payload.message })
      setTargetKey("")
      setSourceKey("")
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível conciliar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const aroundSource = () => {
    if (!source?.date) return
    const base = new Date(`${source.date.slice(0, 10)}T12:00:00`)
    const iso = (offset: number) => new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
    setStart(iso(-30))
    setEnd(iso(30))
  }

  const rowLabel = (row: Row) => <><span className="font-semibold">{money(row.amount)}</span> · {day(row.date)} · {row.description}{row.party && row.party !== row.description ? ` (${row.party})` : ""} <span className="text-muted-foreground">— {kindLabel[row.kind]}{row.kind === "tx" && row.origin ? ` / ${row.origin}` : ""} · {row.status}</span></>

  return (
    <PageShell title="Conciliação bancária" description="Escolha o lançamento de origem e o lançamento com o mesmo valor para conciliar: o pagamento passa a contar uma vez só nos totais."
      actions={<Button variant="outline" asChild><Link href="/financeiro"><ArrowLeft className="h-4 w-4" />Voltar ao Financeiro</Link></Button>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {done ? <p className="flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0" />{done}</p> : null}

      <SectionCard title="1. Lançamento de origem" description={source ? "Este é o lançamento que você quer conciliar com outro." : "Escolha, na lista abaixo, o lançamento de origem (botão “Definir como origem”)."}>
        {source ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-primary/5 p-3 text-sm">
            <div>{rowLabel(source)}</div>
            <Button size="sm" variant="outline" onClick={() => { setSourceKey(""); setTargetKey("") }}><X className="h-4 w-4" />Trocar origem</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : "Nenhuma origem escolhida."}</p>}
      </SectionCard>

      <SectionCard title={source ? "2. Escolha o lançamento para conciliar" : "Lançamentos e contas a pagar"} description="Entradas e Saídas e Contas a Pagar juntos. Filtre por período e descrição; por padrão só aparecem os de mesmo valor.">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="space-y-2"><Label>De</Label><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div>
          <div className="space-y-2"><Label>Até</Label><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
          <div className="space-y-2"><Label>Descrição, fornecedor ou valor</Label><Input className="w-72" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: 36,90 ou nome" /></div>
          <div className="space-y-2"><Label>Onde</Label>
            <div className="flex gap-1">{(["todos", "tx", "ap"] as const).map((item) => <Button key={item} size="sm" variant={fonte === item ? "default" : "outline"} onClick={() => setFonte(item)}>{item === "todos" ? "Tudo" : kindLabel[item]}</Button>)}</div></div>
          {source ? <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={onlySame} onCheckedChange={(checked) => setOnlySame(Boolean(checked))} />Só o mesmo valor ({money(source.amount)})</label> : null}
          {source ? <Button size="sm" variant="outline" onClick={aroundSource}>±30 dias da origem</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => { setStart(""); setEnd(""); setQuery("") }}>Limpar filtros</Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        <DataTable headers={["", "Data", "Descrição", "Onde", "Situação", "Categoria", "Valor", ...(source ? [] : ["Ação"])]} empty={!list.length} viewportClassName={viewport} tableClassName="min-w-[980px]" stickyHeader>
          {list.slice(0, 400).map((row) => {
            const exact = source ? same(row.amount, source.amount) : false
            return (
              <TableRow key={row.key} className={`${source ? "cursor-pointer" : ""} ${targetKey === row.key ? "bg-primary/10" : ""}`} onClick={() => source && chooseTarget(row)}>
                <TableCell>{source ? <input type="radio" readOnly checked={targetKey === row.key} aria-label="Selecionar para conciliar" /> : null}</TableCell>
                <TableCell>{day(row.date)}{source && exact && row.date ? <div className="text-xs text-muted-foreground">{daysBetween(row.date, source.date)} dia(s) da origem</div> : null}</TableCell>
                <TableCell className="max-w-[22rem]"><div className="truncate" title={row.description}>{row.description}</div>{row.party && row.party !== row.description ? <div className="truncate text-xs text-muted-foreground">{row.party}</div> : null}</TableCell>
                <TableCell>{kindLabel[row.kind]}{row.kind === "tx" && row.origin ? <div className="text-xs text-muted-foreground">{row.origin}</div> : null}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell>{row.category || "-"}</TableCell>
                <TableCell className={exact ? "font-semibold text-emerald-700" : ""}>{money(row.amount)}</TableCell>
                {!source ? <TableCell><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setSourceKey(row.key); setTargetKey(""); setDone("") }}>Definir como origem</Button></TableCell> : null}
              </TableRow>
            )
          })}
        </DataTable>
        {list.length > 400 ? <p className="mt-2 text-xs text-muted-foreground">Mostrando 400 de {list.length}. Use o período e a busca para reduzir.</p> : <p className="mt-2 text-xs text-muted-foreground">{list.length} lançamento(s).</p>}
      </SectionCard>

      {source && target ? (
        <SectionCard title="3. Conferir e conciliar">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-md border p-3"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Origem</div>{rowLabel(source)}</div>
            <div className="rounded-md border p-3"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Escolhido</div>{rowLabel(target)}</div>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {problem ? <p className="text-destructive">{problem}</p> : null}
            {!problem && differs ? <p className="text-amber-700">Os valores são diferentes ({money(source.amount)} e {money(target.amount)}). {bankInvolved ? "Vale o valor do banco." : "Vale o valor do lançamento que ficar."}</p> : null}
            {!problem && !differs ? <p className="text-emerald-700">Mesmo valor: depois de conciliar, conta uma vez só.</p> : null}
            {!problem && bothTx && !bankInvolved ? (
              <div className="flex flex-wrap items-center gap-4"><span>Qual lançamento deve ficar?</span>
                <label className="flex items-center gap-2"><input type="radio" checked={keep === "source"} onChange={() => setKeep("source")} />A origem (o outro é apagado)</label>
                <label className="flex items-center gap-2"><input type="radio" checked={keep === "target"} onChange={() => setKeep("target")} />O escolhido (a origem é apagada)</label></div>) : null}
            {!problem && bothTx && bankInvolved ? <p className="text-muted-foreground">O lançamento do extrato é apagado e o outro recebe a data, o valor e a chave do banco.</p> : null}
            {!problem && !bothTx ? <p className="text-muted-foreground">{(source.kind === "ap" ? source : target).status === "Paga" ? "A conta já está paga: o lançamento duplicado será unido ao da conta." : "A conta a pagar será quitada com este lançamento (data e valor do pagamento)."}</p> : null}
          </div>
          <div className="mt-4"><Button disabled={busy || Boolean(problem)} onClick={() => void conciliar()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Conciliar</Button></div>
        </SectionCard>
      ) : null}
    </PageShell>
  )
}
