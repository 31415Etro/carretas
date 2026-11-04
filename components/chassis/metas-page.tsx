"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SectionCard } from "@/components/operations/shared"
import { issuedDay, rowUnits, type ChassisRow } from "@/lib/chassis"

type Row = Omit<ChassisRow, "description" | "accessKey" | "nature"> & { seller?: string; externalSeller?: string }

/** Quanto acima da referência (média ou melhor mês) o vendedor deve mirar. */
const UPLIFT = 0.1
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const pct = (value: number) => `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
const qty = (value: number) => (value > 0 && value < 1 ? value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : Math.round(value).toLocaleString("pt-BR"))
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1
const monthFromIndex = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`

type ModelGoal = { model: string; units: number; value: number; shareUnits: number; shareValue: number; goalUnits: number; goalValue: number }
type SellerGoal = {
  name: string; kind: "fabrica" | "externo"; months: number; units: number; value: number
  avgUnits: number; avgValue: number; bestUnits: number; bestValue: number; bestUnitsMonth: string; bestValueMonth: string
  goalUnits: number; goalValue: number; models: ModelGoal[]
}

/** Página de metas: pega o histórico de vendas da página Chassis e propõe, por vendedor e por modelo, a meta do mês (referência + 10%). */
export function MetasPage() {
  const [all, setAll] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const todayMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7)
  const [goalMonth, setGoalMonth] = useState(todayMonth)
  const [baseMonths, setBaseMonths] = useState(12)
  const [unitsBase, setUnitsBase] = useState<"media" | "melhor">("media")
  const [valueBase, setValueBase] = useState<"media" | "melhor">("melhor")
  const [kind, setKind] = useState<"todos" | "fabrica" | "externo">("todos")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/contabilidade/chassis?visao=todos", { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setAll(payload.rows as Row[]); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const goalOptions = useMemo(() => {
    const now = monthIndex(todayMonth)
    return Array.from({ length: 14 }, (_, i) => monthFromIndex(now - 1 + i))
  }, [todayMonth])

  const result = useMemo(() => {
    const end = monthIndex(goalMonth) - 1 // só meses fechados antes do mês da meta
    const dated = all.filter((row) => !row.intercompany && issuedDay(row.issuedAt)).map((row) => ({ row, month: monthIndex(issuedDay(row.issuedAt).slice(0, 7)) }))
    const earliest = Math.min(end, ...dated.filter((entry) => entry.month <= end).map((entry) => entry.month))
    const start = baseMonths ? end - baseMonths + 1 : earliest
    const scoped = dated.filter((entry) => entry.month >= start && entry.month <= end && ((entry.row.seller || entry.row.externalSeller) || ""))
    const per = new Map<string, { kind: "fabrica" | "externo"; byMonthUnits: Map<number, number>; byMonthValue: Map<number, number>; models: Map<string, { units: number; value: number }> }>()
    for (const { row, month } of scoped) {
      const name = row.seller || row.externalSeller || ""
      const entry = per.get(name) || { kind: row.seller ? "fabrica" as const : "externo" as const, byMonthUnits: new Map(), byMonthValue: new Map(), models: new Map() }
      const units = rowUnits(row as ChassisRow)
      entry.byMonthUnits.set(month, (entry.byMonthUnits.get(month) || 0) + units)
      entry.byMonthValue.set(month, (entry.byMonthValue.get(month) || 0) + row.itemTotal)
      const model = row.model || "Sem modelo"
      const m = entry.models.get(model) || { units: 0, value: 0 }
      m.units += units; m.value += row.itemTotal
      entry.models.set(model, m)
      per.set(name, entry)
    }
    const sellers: SellerGoal[] = []
    for (const [name, entry] of per) {
      const monthsWithSales = [...entry.byMonthUnits.keys()]
      const first = Math.min(...monthsWithSales) // vendedor novo não é diluído em meses antes de começar
      const months = Math.max(1, end - first + 1)
      const units = [...entry.byMonthUnits.values()].reduce((a, b) => a + b, 0)
      const value = [...entry.byMonthValue.values()].reduce((a, b) => a + b, 0)
      const bestUnits = [...entry.byMonthUnits.entries()].sort((a, b) => b[1] - a[1])[0]
      const bestValue = [...entry.byMonthValue.entries()].sort((a, b) => b[1] - a[1])[0]
      const avgUnits = units / months, avgValue = value / months
      const goalUnits = Math.ceil((unitsBase === "media" ? avgUnits : bestUnits[1]) * (1 + UPLIFT))
      const goalValue = (valueBase === "media" ? avgValue : bestValue[1]) * (1 + UPLIFT)
      const models: ModelGoal[] = [...entry.models.entries()].map(([model, m]) => ({
        model, units: m.units, value: m.value, shareUnits: units ? m.units / units : 0, shareValue: value ? m.value / value : 0,
        goalUnits: goalUnits * (units ? m.units / units : 0), goalValue: goalValue * (value ? m.value / value : 0),
      })).sort((a, b) => b.units - a.units || b.value - a.value)
      sellers.push({ name, kind: entry.kind, months, units, value, avgUnits, avgValue, bestUnits: bestUnits[1], bestValue: bestValue[1], bestUnitsMonth: monthFromIndex(bestUnits[0]), bestValueMonth: monthFromIndex(bestValue[0]), goalUnits, goalValue, models })
    }
    sellers.sort((a, b) => b.goalValue - a.goalValue)
    const modelTotals = new Map<string, { goalUnits: number; goalValue: number; sellers: number }>()
    for (const seller of sellers) for (const model of seller.models) {
      const t = modelTotals.get(model.model) || { goalUnits: 0, goalValue: 0, sellers: 0 }
      t.goalUnits += model.goalUnits; t.goalValue += model.goalValue; t.sellers += 1
      modelTotals.set(model.model, t)
    }
    return { sellers, start: monthFromIndex(start), end: monthFromIndex(end), models: [...modelTotals.entries()].map(([model, t]) => ({ model, ...t })).sort((a, b) => b.goalUnits - a.goalUnits) }
  }, [all, goalMonth, baseMonths, unitsBase, valueBase])

  const shown = result.sellers.filter((seller) => kind === "todos" || seller.kind === kind)
  const totalUnits = shown.reduce((sum, seller) => sum + seller.goalUnits, 0)
  const totalValue = shown.reduce((sum, seller) => sum + seller.goalValue, 0)
  const select = "mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"

  return (
    <PageShell title="Metas de vendas" description={`Meta de ${monthName(goalMonth)} por vendedor e por modelo. Base: vendas de ${monthName(result.start)} a ${monthName(result.end)} (página Chassis, sem vendas entre as empresas ND), mais ${UPLIFT * 100}% sobre a referência escolhida.`}
      actions={<div className="flex gap-2"><Button variant="outline" asChild><Link href="/chassis"><ArrowLeft className="h-4 w-4" />Chassis</Link></Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button></div>}>
      {error ? <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <SectionCard title="Como a meta é calculada">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Mês da meta
            <select value={goalMonth} onChange={(event) => setGoalMonth(event.target.value)} className={select}>{goalOptions.map((key) => <option key={key} value={key}>{monthName(key)}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Histórico considerado
            <select value={baseMonths} onChange={(event) => setBaseMonths(Number(event.target.value))} className={select}>
              <option value={3}>Últimos 3 meses</option><option value={6}>Últimos 6 meses</option><option value={12}>Últimos 12 meses</option><option value={24}>Últimos 24 meses</option><option value={0}>Todo o histórico</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Meta de quantidade = + {UPLIFT * 100}% sobre
            <select value={unitsBase} onChange={(event) => setUnitsBase(event.target.value as "media" | "melhor")} className={select}><option value="media">Média mensal</option><option value="melhor">Melhor mês</option></select>
          </label>
          <label className="text-xs text-muted-foreground">Meta de valor = + {UPLIFT * 100}% sobre
            <select value={valueBase} onChange={(event) => setValueBase(event.target.value as "media" | "melhor")} className={select}><option value="melhor">Melhor mês (maior valor vendido)</option><option value="media">Média mensal</option></select>
          </label>
          <label className="text-xs text-muted-foreground">Vendedores
            <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className={select}><option value="todos">Todos</option><option value="fabrica">Da fábrica</option><option value="externo">Externos</option></select>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Só entram meses já fechados antes do mês da meta. A média de cada vendedor conta a partir do primeiro mês em que ele vendeu. A meta de cada modelo reparte a meta do vendedor pela participação que o modelo teve nas vendas dele (quantidade pela % em carretas, valor pela % em R$).</p>
      </SectionCard>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Meta total de carretas</div><div className="text-xl font-semibold">{totalUnits.toLocaleString("pt-BR")}</div><div className="text-xs text-muted-foreground">{shown.length} vendedor(es)</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Meta total em valor</div><div className="text-xl font-semibold">{brl(totalValue)}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Mês da meta</div><div className="text-xl font-semibold capitalize">{monthName(goalMonth)}</div></div>
      </div>

      <SectionCard title="Meta por vendedor" description="Histórico do período e a meta do mês. Melhor mês = o mês em que o vendedor mais vendeu.">
        <DataTable headers={["Vendedor", "Média/mês (carretas)", "Melhor mês (carretas)", "Média/mês (R$)", "Melhor mês (R$)", "Meta carretas", "Meta valor"]} empty={!shown.length && !loading}>
          {shown.map((seller) => (
            <TableRow key={seller.name}>
              <TableCell className="font-medium">{seller.name}<div className="text-xs font-normal text-muted-foreground">{seller.kind === "fabrica" ? "Fábrica" : "Externo"} · {seller.months} mês(es)</div></TableCell>
              <TableCell className="text-right">{decimal(seller.avgUnits)}</TableCell>
              <TableCell className="text-right">{seller.bestUnits.toLocaleString("pt-BR")}<div className="text-xs text-muted-foreground">{monthName(seller.bestUnitsMonth)}</div></TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(seller.avgValue)}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(seller.bestValue)}<div className="text-xs text-muted-foreground">{monthName(seller.bestValueMonth)}</div></TableCell>
              <TableCell className="text-right text-base font-semibold">{seller.goalUnits.toLocaleString("pt-BR")}</TableCell>
              <TableCell className="whitespace-nowrap text-right text-base font-semibold">{brl(seller.goalValue)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Meta por modelo (soma de todos os vendedores)" description="Quanto a equipe precisa vender de cada modelo para fechar as metas individuais.">
        <DataTable headers={["Modelo", "Meta carretas", "Meta valor", "Vendedores que vendem"]} empty={!result.models.length && !loading}>
          {result.models.map((model) => (
            <TableRow key={model.model}>
              <TableCell className="font-medium">{model.model}</TableCell>
              <TableCell className="text-right">{qty(model.goalUnits)}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{brl(model.goalValue)}</TableCell>
              <TableCell className="text-right">{model.sellers}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      {shown.map((seller) => (
        <SectionCard key={seller.name} title={`${seller.name} — meta ${seller.goalUnits.toLocaleString("pt-BR")} carreta(s) · ${brl(seller.goalValue)}`} description="Modelos do que mais vendeu para o que menos vendeu, com a participação de cada um nas vendas do vendedor.">
          <DataTable headers={["Modelo", "% das vendas", "Vendeu (carretas)", "Vendeu (R$)", "% do valor", "Meta carretas", "Meta valor"]} empty={false}>
            {seller.models.map((model) => (
              <TableRow key={model.model}>
                <TableCell className="font-medium">{model.model}</TableCell>
                <TableCell className="text-right font-semibold">{pct(model.shareUnits)}</TableCell>
                <TableCell className="text-right">{model.units.toLocaleString("pt-BR")}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{brl(model.value)}</TableCell>
                <TableCell className="text-right">{pct(model.shareValue)}</TableCell>
                <TableCell className="text-right font-semibold">{qty(model.goalUnits)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{brl(model.goalValue)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
      ))}
    </PageShell>
  )
}
