"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Link2, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { amountOf, dateOf, daysBetween, descriptionSimilarity, findCandidates, isReconcilable, isStatementTransaction, levelLabel, statementKeyFromNotes, suggestPairs, type TxLike } from "@/lib/bank-reconciliation"
import { money, type FinancialState, type FinancialTransaction } from "@/lib/financial-storage"

const day = (value?: string) => (value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "-")
const viewport = "max-h-[26rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]"

async function reconcile(pairs: Array<{ manualId: string; statementId: string }>) {
  const response = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok && !payload?.reconciled) throw new Error(payload?.error || payload?.failed?.[0]?.error || "Não foi possível conciliar.")
  return payload as { reconciled: number; failed: Array<{ error: string }> }
}

export function ReconciliationTab({ state, refresh }: { state: FinancialState; refresh: () => Promise<unknown> }) {
  const { toast } = useCrudFeedback()
  const [type, setType] = useState<"todos" | "Entrada" | "Saida">("todos")
  const [query, setQuery] = useState("")
  const [statementId, setStatementId] = useState("")
  const [manualId, setManualId] = useState("")
  const [busy, setBusy] = useState(false)

  const transactions = state.transactions as FinancialTransaction[]
  const statements = useMemo(() => transactions.filter((tx) => isStatementTransaction(tx) && tx.status !== "Cancelado"), [transactions])
  const pool = useMemo(() => transactions.filter((tx) => isReconcilable(tx as TxLike)), [transactions])
  const reconciledCount = useMemo(() => transactions.filter((tx) => !isStatementTransaction(tx) && statementKeyFromNotes(tx.notes)).length, [transactions])

  const suggestions = useMemo(() => suggestPairs(statements.map((tx) => ({ id: tx.id, type: tx.type, date: dateOf(tx), amount: amountOf(tx), description: tx.description })), pool as TxLike[], "Media"), [statements, pool])
  const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions])

  const matches = (tx: FinancialTransaction) => (type === "todos" || tx.type === type) && (!query.trim() || `${tx.description} ${tx.supplierName} ${amountOf(tx)}`.toLowerCase().includes(query.toLowerCase()))
  const shownStatements = statements.filter(matches)
  const picked = statementId ? byId.get(statementId) : undefined
  // lado manual: se escolheu uma linha do extrato, mostra primeiro o que casa com ela
  const ranked = useMemo(() => {
    const scores = new Map(picked ? findCandidates({ type: picked.type, date: dateOf(picked), amount: amountOf(picked), description: picked.description }, pool as TxLike[]).map((c) => [c.id, c]) : [])
    return pool.filter((tx) => matches(tx) && (!picked || tx.type === picked.type)).sort((a, b) => (scores.get(b.id)?.score || 0) - (scores.get(a.id)?.score || 0) || dateOf(b).localeCompare(dateOf(a)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, picked, type, query])
  const chosen = manualId ? byId.get(manualId) : undefined
  const differs = picked && chosen && Math.abs(amountOf(picked) - amountOf(chosen)) > 0.009

  async function run(pairs: Array<{ manualId: string; statementId: string }>, label: string) {
    setBusy(true)
    try {
      const result = await reconcile(pairs)
      await refresh()
      setStatementId("")
      setManualId("")
      toast({ title: label, description: `${result.reconciled} conciliado(s)${result.failed?.length ? `; ${result.failed.length} com erro: ${result.failed[0].error}` : ""}.`, variant: result.failed?.length ? "destructive" : undefined })
    } catch (reason) {
      toast({ title: "Não foi possível conciliar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const high = suggestions.filter((pair) => pair.level === "Alta")

  return (
    <div className="space-y-4">
      <SectionCard title="Conciliação bancária" description="Junte uma linha do extrato com um lançamento que você já tinha feito à mão. O valor conta uma vez só nos cards, em Entradas e Saídas e no DRE.">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Extrato sem conciliar</div><div className="text-lg font-semibold">{statements.length}</div></div>
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Lançamentos manuais disponíveis</div><div className="text-lg font-semibold">{pool.length}</div></div>
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Já conciliados</div><div className="text-lg font-semibold">{reconciledCount}</div></div>
        </div>
      </SectionCard>

      <SectionCard title="Sugestões automáticas" description="Mesmo tipo e mesmo valor, com data próxima e nome parecido. Confira antes de conciliar.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button disabled={busy || !high.length} onClick={() => void run(high.map((pair) => ({ manualId: pair.manualId, statementId: pair.statementId })), "Sugestões de alta confiança")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Conciliar as {high.length} de confiança alta</Button>
          <span className="text-sm text-muted-foreground">{suggestions.length} sugestão(ões) no total.</span>
        </div>
        <DataTable headers={["Confiança", "Extrato (banco)", "Lançamento já existente", "Valor", "Ação"]} empty={!suggestions.length} viewportClassName={viewport} tableClassName="min-w-[900px]">
          {suggestions.map((pair) => {
            const bank = byId.get(pair.statementId)
            const mine = byId.get(pair.manualId)
            if (!bank || !mine) return null
            return (
              <TableRow key={`${pair.statementId}-${pair.manualId}`}>
                <TableCell><StatusBadge status={levelLabel[pair.level]} /></TableCell>
                <TableCell>{day(dateOf(bank))}<div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={bank.description}>{bank.description}</div></TableCell>
                <TableCell>{day(dateOf(mine))} · {mine.origin}<div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={mine.description}>{mine.description}</div></TableCell>
                <TableCell>{money(amountOf(bank))}</TableCell>
                <TableCell><Button size="sm" disabled={busy} onClick={() => void run([{ manualId: pair.manualId, statementId: pair.statementId }], "Conciliação")}><Link2 className="h-4 w-4" />Conciliar</Button></TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>

      <SectionCard title="Conciliar manualmente" description="Escolha uma linha do extrato à esquerda e o lançamento correspondente à direita.">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="space-y-2"><Label>Tipo</Label>
            <div className="flex gap-1">{(["todos", "Entrada", "Saida"] as const).map((item) => <Button key={item} size="sm" variant={type === item ? "default" : "outline"} onClick={() => setType(item)}>{item === "todos" ? "Todos" : item === "Entrada" ? "Entradas" : "Saídas"}</Button>)}</div></div>
          <div className="space-y-2"><Label>Buscar (descrição, fornecedor ou valor)</Label><Input className="w-72" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: 36,90 ou nome" /></div>
          <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Atualizar</Button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold">Extrato bancário ({shownStatements.length})</h4>
            <DataTable headers={["", "Data", "Descrição", "Tipo", "Valor"]} empty={!shownStatements.length} viewportClassName={viewport} tableClassName="min-w-[520px]">
              {shownStatements.map((tx) => <TableRow key={tx.id} className={`cursor-pointer ${statementId === tx.id ? "bg-primary/10" : ""}`} onClick={() => { setStatementId(tx.id === statementId ? "" : tx.id); setManualId("") }}>
                <TableCell><input type="radio" readOnly checked={statementId === tx.id} aria-label="Selecionar linha do extrato" /></TableCell>
                <TableCell>{day(dateOf(tx))}</TableCell><TableCell className="max-w-[16rem] truncate" title={tx.description}>{tx.description}</TableCell><TableCell>{tx.type === "Entrada" ? "Entrada" : "Saída"}</TableCell><TableCell>{money(amountOf(tx))}</TableCell>
              </TableRow>)}
            </DataTable>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Lançamentos já feitos ({ranked.length}){picked ? " — os de mesmo valor aparecem primeiro" : ""}</h4>
            <DataTable headers={["", "Data", "Descrição", "Origem", "Valor"]} empty={!ranked.length} viewportClassName={viewport} tableClassName="min-w-[560px]">
              {ranked.slice(0, 300).map((tx) => {
                const same = picked && Math.abs(amountOf(picked) - amountOf(tx)) <= 0.009
                const close = picked ? daysBetween(dateOf(picked), dateOf(tx)) : null
                const alike = picked ? descriptionSimilarity(picked.description, `${tx.description} ${tx.supplierName || ""}`) : 0
                return <TableRow key={tx.id} className={`cursor-pointer ${manualId === tx.id ? "bg-primary/10" : ""}`} onClick={() => setManualId(tx.id === manualId ? "" : tx.id)}>
                  <TableCell><input type="radio" readOnly checked={manualId === tx.id} aria-label="Selecionar lançamento" /></TableCell>
                  <TableCell>{day(dateOf(tx))}{close !== null && same ? <div className="text-xs text-muted-foreground">{close} dia(s) de diferença</div> : null}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={tx.description}>{tx.description}{same && alike >= 0.25 ? <div className="text-xs text-emerald-700">nome parecido</div> : null}</TableCell>
                  <TableCell>{tx.origin}</TableCell>
                  <TableCell className={same ? "font-semibold text-emerald-700" : ""}>{money(amountOf(tx))}</TableCell>
                </TableRow>
              })}
            </DataTable>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          {picked && chosen ? <>
            <span><strong>{money(amountOf(picked))}</strong> no extrato ({day(dateOf(picked))}) ⇄ <strong>{money(amountOf(chosen))}</strong> lançado ({day(dateOf(chosen))}).</span>
            {differs ? <span className="text-amber-700">Valores diferentes: vale o valor do banco ({money(amountOf(picked))}).</span> : <span className="text-emerald-700">Mesmo valor: passará a contar uma vez só.</span>}
            <Button disabled={busy || picked.type !== chosen.type} onClick={() => void run([{ manualId: chosen.id, statementId: picked.id }], "Conciliação")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Conciliar os dois</Button>
            {picked.type !== chosen.type ? <span className="text-destructive">Entrada não concilia com saída.</span> : null}
          </> : <span className="text-muted-foreground">Selecione uma linha do extrato e um lançamento para conciliar.</span>}
        </div>
      </SectionCard>
    </div>
  )
}
