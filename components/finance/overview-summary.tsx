"use client"

import { AlertTriangle, CreditCard, Receipt } from "lucide-react"
import { SectionCard } from "@/components/operations/shared"
import { money } from "@/lib/financial-storage"

type Tone = "default" | "good" | "bad"
const toneClass: Record<Tone, string> = { default: "text-foreground", good: "text-emerald-600", bad: "text-destructive" }
const signTone = (value: number): Tone => (value > 0 ? "good" : value < 0 ? "bad" : "default")

/** Faixa de números lado a lado (no lugar de vários cards pequenos): rótulo, valor e nota, separados por divisórias. */
export function StatStrip({ items }: { items: Array<{ label: string; value: string; note?: string; tone?: Tone }> }) {
  return (
    <dl className="grid divide-y divide-border sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3 first:pl-0 last:pr-0 sm:py-1">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</dt>
          <dd className={`mt-1.5 text-xl font-semibold tracking-tight tabular-nums ${toneClass[item.tone || "default"]}`}>{item.value}</dd>
          {item.note ? <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p> : null}
        </div>
      ))}
    </dl>
  )
}

function Flow({ title, done, expected, tone, loading, bar = "bg-primary" }: { title: string; done: number; expected: number; tone: Tone; loading: boolean; bar?: string }) {
  const pct = expected > 0 ? Math.max(0, Math.min(100, (done / expected) * 100)) : 0
  return (
    <div className="px-5 py-4 first:pl-0 sm:py-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${toneClass[tone]}`}>{loading ? "..." : money(done)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">realizado · previsto {loading ? "..." : money(expected)}</p>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${title} realizado sobre o previsto`}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export type OverviewSummaryProps = {
  loading: boolean
  periodLabel: string
  /** Sistema + Asaas */
  summary: { entriesExpected: number; entriesDone: number; outputsExpected: number; outputsDone: number; plannedBalance: number; realizedBalance: number }
  /** Somente lançamentos do sistema */
  system: { plannedRevenue: number; realizedRevenue: number; realizedExpense: number; realizedBalance: number }
  overduePayables: number
  overdueReceivables: number
  invoicesTotal: number
  invoicesCount: number
}

/** Resumo do período da Visão Geral: resultado (entradas, saídas e saldo), atenção e lançamentos do sistema. */
export function FinanceOverviewSummary(p: OverviewSummaryProps) {
  const { summary } = p
  const attention = [
    { label: "Contas a pagar vencidas", value: String(p.overduePayables), note: "no período", icon: Receipt, alert: p.overduePayables > 0 },
    { label: "Contas a receber vencidas", value: String(p.overdueReceivables), note: "no período", icon: Receipt, alert: p.overdueReceivables > 0 },
    { label: "Faturas de cartão", value: money(p.invoicesTotal), note: `${p.invoicesCount} fatura(s) no período`, icon: CreditCard, alert: false },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard title="Resultado do período" description={`${p.periodLabel} · sistema + Asaas`}>
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Flow title="Entradas" done={summary.entriesDone} expected={summary.entriesExpected} tone="default" loading={p.loading} />
            <Flow title="Saídas" done={summary.outputsDone} expected={summary.outputsExpected} tone="default" loading={p.loading} bar="bg-red-400" />
            <div className="px-5 py-4 last:pr-0 sm:py-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Saldo (caixa realizado)</p>
              <p className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${toneClass[signTone(summary.realizedBalance)]}`}>{p.loading ? "..." : money(summary.realizedBalance)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">previsto {p.loading ? "..." : money(summary.plannedBalance)}</p>
              <p className="mt-2.5 text-xs text-muted-foreground">Entradas − saídas</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Atenção" description="O que precisa de acompanhamento">
          <ul className="divide-y divide-border">
            {attention.map((item) => (
              <li key={item.label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.alert ? "bg-red-50 text-destructive" : "bg-[var(--brand-soft)] text-primary"}`}>{item.alert ? <AlertTriangle className="h-4 w-4" /> : <item.icon className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.note}</span>
                </span>
                <span className={`text-lg font-semibold tabular-nums ${item.alert ? "text-destructive" : ""}`}>{p.loading ? "..." : item.value}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Lançamentos do sistema" description={`${p.periodLabel} · sem os extratos do Asaas`}>
        <StatStrip
          items={[
            { label: "Receita prevista", value: p.loading ? "..." : money(p.system.plannedRevenue) },
            { label: "Receita realizada", value: p.loading ? "..." : money(p.system.realizedRevenue) },
            { label: "Despesa realizada", value: p.loading ? "..." : money(p.system.realizedExpense) },
            { label: "Saldo realizado", value: p.loading ? "..." : money(p.system.realizedBalance), tone: signTone(p.system.realizedBalance) },
          ]}
        />
      </SectionCard>
    </div>
  )
}
