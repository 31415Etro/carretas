"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Search } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard } from "@/components/operations/shared"
import { cfopLabel } from "@/lib/remessas"
import { spDay } from "@/lib/sp-day"

type Note = {
  id: string; companyId: string; companyName: string; operation: string; number: string; series: string; issuedAt: string | null; nature: string; cfop: string
  issuerName: string; recipientName: string; recipientDocument: string; intercompany: boolean; total: number; itemCount: number; quantity: number; carretas: number
  models: Array<{ model: string; quantity: number }>
}

const COLORS = ["#1e3a8a", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#0369a1", "#4d7c0f", "#a16207", "#475569", "#c026d3"]
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const number = (value: number) => Number(value || 0).toLocaleString("pt-BR")
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-")
const dayKey = (value?: string | null) => spDay(value)
const monthLabel = (key: string) => (/^\d{4}-\d{2}$/.test(key) ? `${key.slice(5)}/${key.slice(2, 4)}` : "sem data")
const formatDoc = (value: string) => (value.length === 14 ? value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : value.length === 11 ? value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : value)
const sense = (operation: string) => (operation === "Saída" ? "Enviada" : "Recebida")

async function load(): Promise<{ notes: Note[] }> {
  const response = await fetch("/api/contabilidade/remessas", { cache: "no-store" })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function downloadCsv(name: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const body = [header, ...rows].map((line) => line.map(cell).join(";")).join("\r\n")
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Visão "Remessas" da Contabilidade: notas de remessa (CFOP 5912 e 6912), que não entram nas vendas. */
export function RemessasPanel() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [ano, setAno] = useState("")
  const [mes, setMes] = useState("")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [company, setCompany] = useState("")
  const [direction, setDirection] = useState<"" | "Saída" | "Entrada">("")
  const [cfop, setCfop] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => { load().then((result) => { setNotes(result.notes); setError("") }).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar as remessas.")).finally(() => setLoading(false)) }, [])

  const years = useMemo(() => [...new Set(notes.map((note) => dayKey(note.issuedAt).slice(0, 4)).filter(Boolean))].sort().reverse(), [notes])
  const companies = useMemo(() => [...new Set(notes.map((note) => note.companyName))].sort(), [notes])
  const cfops = useMemo(() => [...new Set(notes.map((note) => note.cfop).filter(Boolean))].sort(), [notes])
  function pickMonth(year: string, month: string) {
    setAno(year); setMes(year ? month : "")
    if (!year) { setDe(""); setAte(""); return }
    if (!month) { setDe(`${year}-01-01`); setAte(`${year}-12-31`); return }
    setDe(`${year}-${month}-01`); setAte(`${year}-${month}-${String(new Date(Number(year), Number(month), 0).getDate()).padStart(2, "0")}`)
  }

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return notes.filter((note) => {
      const issued = dayKey(note.issuedAt)
      if (de && issued < de) return false
      if (ate && issued > ate) return false
      if (company && note.companyName !== company) return false
      if (direction && note.operation !== direction) return false
      if (cfop && note.cfop !== cfop) return false
      if (term && ![note.recipientName, note.issuerName, note.recipientDocument, note.number, note.nature, note.companyName].join(" ").toLowerCase().includes(term)) return false
      return true
    })
  }, [notes, de, ate, company, direction, cfop, q])

  const totals = useMemo(() => {
    const recipients = new Set(shown.map((note) => note.recipientDocument || note.recipientName))
    return { notes: shown.length, value: shown.reduce((sum, note) => sum + note.total, 0), carretas: shown.reduce((sum, note) => sum + note.carretas, 0), recipients: recipients.size, byCfop: [...new Set(shown.map((note) => note.cfop))].sort().map((code) => ({ code, notes: shown.filter((note) => note.cfop === code).length, value: shown.filter((note) => note.cfop === code).reduce((sum, note) => sum + note.total, 0) })).sort((a, b) => b.value - a.value) }
  }, [shown])

  const models = useMemo(() => {
    const map = new Map<string, number>()
    for (const note of shown) for (const entry of note.models) map.set(entry.model, (map.get(entry.model) || 0) + entry.quantity)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [shown])
  const byMonth = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const note of shown) {
      const key = dayKey(note.issuedAt).slice(0, 7) || "sem data"
      const row = map.get(key) || { notes: 0, value: 0 }
      row.notes += 1; row.value += note.total
      for (const entry of note.models) row[entry.model] = (row[entry.model] || 0) + entry.quantity
      map.set(key, row)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, row]) => ({ period: key, label: monthLabel(key), ...row, value: Math.round(row.value * 100) / 100 }))
  }, [shown])
  const byRecipient = useMemo(() => {
    const map = new Map<string, { name: string; notes: number; value: number; carretas: number }>()
    for (const note of shown) {
      const key = note.recipientDocument || note.recipientName || "sem destinatário"
      const entry = map.get(key) || { name: note.recipientName || "(sem destinatário)", notes: 0, value: 0, carretas: 0 }
      entry.notes += 1; entry.value += note.total; entry.carretas += note.carretas
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [shown])
  const byCompany = useMemo(() => {
    const map = new Map<string, { name: string; notes: number; value: number; carretas: number }>()
    for (const note of shown) { const entry = map.get(note.companyName) || { name: note.companyName, notes: 0, value: 0, carretas: 0 }; entry.notes += 1; entry.value += note.total; entry.carretas += note.carretas; map.set(note.companyName, entry) }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [shown])
  const colorOf = (model: string) => COLORS[models.findIndex(([name]) => name === model) % COLORS.length]

  function exportNotes() {
    downloadCsv("remessas.csv", ["Emissão", "Empresa", "Sentido", "NF", "Série", "Natureza", "CFOP", "Destinatário", "CPF/CNPJ", "Carretas", "Itens", "Valor da nota"],
      shown.map((note) => [day(note.issuedAt), note.companyName, sense(note.operation), note.number, note.series, note.nature, note.cfop, note.recipientName, formatDoc(note.recipientDocument), note.carretas, note.itemCount, String(note.total).replace(".", ",")]))
  }

  const tip = (rows: Array<{ label: string; value: string }>, title: string) => (
    <div className="rounded-md border bg-background p-3 text-sm shadow-md"><div className="mb-1 font-semibold">{title}</div>{rows.map((row) => <div key={row.label} className="flex justify-between gap-4"><span>{row.label}</span><span className="font-medium">{row.value}</span></div>)}</div>
  )

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        Notas de <strong>remessa e de retorno de remessa</strong>: demonstração (5912/6912 e retorno 5913/6913), industrialização por encomenda (5901/6901, retorno 5902/6902/5925/6925), conserto e brinde. Elas <strong>não entram nas vendas nem nas compras</strong> da Contabilidade nem na página de Chassis: aparecem só aqui, de todas as empresas.
      </p>

      <SectionCard title="Filtros">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Ano
            <select value={ano} onChange={(event) => pickMonth(event.target.value, mes)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">Mês
            <select value={mes} disabled={!ano} onChange={(event) => pickMonth(ano, event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground disabled:opacity-50"><option value="">Todos</option>{MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}</select>
          </label>
          <label className="text-xs text-muted-foreground">De<Input type="date" value={de} onChange={(event) => { setDe(event.target.value); setAno(""); setMes("") }} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Até<Input type="date" value={ate} onChange={(event) => { setAte(event.target.value); setAno(""); setMes("") }} className="mt-1 w-40" /></label>
          <label className="text-xs text-muted-foreground">Empresa
            <select value={company} onChange={(event) => setCompany(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todas</option>{companies.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <div className="text-xs text-muted-foreground">Sentido
            <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["", "Todas"], ["Saída", "Enviadas"], ["Entrada", "Recebidas"]] as const).map(([value, label]) => <button key={label} type="button" onClick={() => setDirection(value)} className={`rounded px-3 py-1 ${direction === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
          </div>
          <label className="text-xs text-muted-foreground">CFOP
            <select value={cfop} onChange={(event) => setCfop(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="">Todos</option>{cfops.map((code) => <option key={code} value={code}>{cfopLabel(code)}</option>)}</select>
          </label>
          <div className="relative min-w-[220px] flex-1 text-xs text-muted-foreground">Buscar<Search className="pointer-events-none absolute left-3 top-[calc(50%+9px)] h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Destinatário, CNPJ, número ou natureza" className="mt-1 pl-9" /></div>
          {(de || ate || company || direction || cfop || q) ? <Button variant="ghost" size="sm" onClick={() => { setDe(""); setAte(""); setAno(""); setMes(""); setCompany(""); setDirection(""); setCfop(""); setQ("") }}>Limpar filtros</Button> : null}
          {loading ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Notas de remessa" value={number(totals.notes)} hint={totals.byCfop.slice(0, 4).map((entry) => `${entry.code}: ${number(entry.notes)}`).join(" · ")} />
        <Card label="Valor das remessas" value={brl(totals.value)} hint={totals.byCfop.slice(0, 3).map((entry) => `${entry.code}: ${brl(entry.value)}`).join(" · ")} />
        <Card label="Carretas remetidas" value={number(totals.carretas)} hint={models.slice(0, 3).map(([model, quantity]) => `${model}: ${number(quantity)}`).join(" · ")} />
        <Card label="Destinatários" value={number(totals.recipients)} hint="clientes, lojas e representantes que receberam" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Carretas remetidas por mês e modelo" description="Cada cor é um modelo. Passe o mouse para ver as notas e o valor do mês.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as Record<string, number | string>
                  return tip([...models.map(([model]) => ({ label: model, value: number(Number(row[model] || 0)) })).filter((line) => line.value !== "0"), { label: "Notas", value: number(Number(row.notes)) }, { label: "Valor", value: brl(row.value) }], monthLabel(String(row.period)))
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {models.map(([model]) => <Bar key={model} dataKey={model} stackId="m" fill={colorOf(model)} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Valor remetido por mês" description="Soma do valor das notas de remessa no mês.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)} mil`} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as Record<string, number | string>
                  return tip([{ label: "Valor", value: brl(row.value) }, { label: "Notas", value: number(Number(row.notes)) }], monthLabel(String(row.period)))
                }} />
                <Bar dataKey="value" fill="#0f766e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Quem mais recebeu remessa (por valor)" description="Os 12 maiores destinatários do período filtrado.">
          <div style={{ height: Math.max(180, Math.min(12, byRecipient.length) * 30 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRecipient.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)} mil`} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} tickFormatter={(value: string) => (value.length > 22 ? `${value.slice(0, 21)}…` : value)} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as { name: string; value: number; notes: number; carretas: number }
                  return tip([{ label: "Valor", value: brl(row.value) }, { label: "Notas", value: number(row.notes) }, { label: "Carretas", value: number(row.carretas) }], row.name)
                }} cursor={{ fill: "rgba(30,58,138,0.08)" }} />
                <Bar dataKey="value" fill="#1e3a8a" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Remessas por tipo (CFOP)" description="Cada CFOP de remessa ou retorno e o que ele representa.">
          <DataTable headers={["CFOP", "Tipo", "Notas", "Valor"]} empty={!totals.byCfop.length && !loading}>
            {totals.byCfop.map((entry) => <TableRow key={entry.code}><TableCell className="font-medium">{entry.code}</TableCell><TableCell className="max-w-[260px] truncate" title={cfopLabel(entry.code)}>{cfopLabel(entry.code).replace(/^\d+ · /, "")}</TableCell><TableCell className="text-right">{number(entry.notes)}</TableCell><TableCell className="whitespace-nowrap text-right">{brl(entry.value)}</TableCell></TableRow>)}
          </DataTable>
        </SectionCard>

        <SectionCard title="Remessas por empresa" description="Valor e carretas remetidos por cada empresa do grupo.">
          <DataTable headers={["Empresa", "Notas", "Carretas", "Valor"]} empty={!byCompany.length && !loading}>
            {byCompany.map((entry) => <TableRow key={entry.name}><TableCell className="font-medium">{entry.name}</TableCell><TableCell className="text-right">{number(entry.notes)}</TableCell><TableCell className="text-right">{number(entry.carretas)}</TableCell><TableCell className="whitespace-nowrap text-right">{brl(entry.value)}</TableCell></TableRow>)}
          </DataTable>
          <div className="mt-3">
            <DataTable headers={["Modelo", "Carretas"]} empty={!models.length && !loading}>
              {models.map(([model, quantity]) => <TableRow key={model}><TableCell className="font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(model) }} />{model}</TableCell><TableCell className="text-right">{number(quantity)}</TableCell></TableRow>)}
            </DataTable>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Notas de remessa" description={`${number(shown.length)} nota(s) · ${brl(totals.value)}`}>
        <div className="mb-2"><Button type="button" variant="outline" size="sm" onClick={exportNotes} disabled={!shown.length}><Download className="h-4 w-4" />Planilha das remessas</Button></div>
        <DataTable stickyHeader viewportClassName="max-h-[36rem] overflow-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]" headers={["Emissão", "Empresa", "Sentido", "NF", "Natureza", "CFOP", "Destinatário", "CPF/CNPJ", "Carretas", "Valor"]} empty={!shown.length && !loading}>
          {shown.map((note) => (
            <TableRow key={note.id}>
              <TableCell className="whitespace-nowrap">{day(note.issuedAt)}</TableCell>
              <TableCell className="whitespace-nowrap">{note.companyName}</TableCell>
              <TableCell>{sense(note.operation)}</TableCell>
              <TableCell className="whitespace-nowrap">{note.number}{note.series ? `/${note.series}` : ""}</TableCell>
              <TableCell className="max-w-[220px] truncate" title={note.nature}>{note.nature || "-"}</TableCell>
              <TableCell>{note.cfop}</TableCell>
              <TableCell className="max-w-[240px] truncate" title={note.recipientName}>{note.recipientName || "-"}{note.intercompany ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">entre empresas</span> : null}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDoc(note.recipientDocument) || "-"}</TableCell>
              <TableCell className="text-right">{number(note.carretas)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium">{brl(note.total)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </div>
  )
}
