"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard } from "@/components/operations/shared"
import type { RegistryView } from "@/lib/chassis-registry"

type Payload = {
  missing: boolean; hint: string; sellers: string[]; found: number; page: number; pageSize: number; items: RegistryView[]; noteChassisNotRegistered: number
  summary: { total: number; withNote: number; withoutNote: number; withDescription: number; byModel: Array<{ model: string; total: number; withNote: number }> }
}

const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-")
const brl = (value: number) => (value ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-")
const kg = (value: number) => (value ? `${value.toLocaleString("pt-BR")} kg` : "-")

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

/** Cadastro de chassis (planilha de controle): todos os números de chassi conhecidos, com descrição/tamanho, e se já têm nota de venda no sistema. */
export function RegistrySection() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  const [model, setModel] = useState("")
  const [seller, setSeller] = useState("")
  const [note, setNote] = useState<"" | "com" | "sem">("sem")
  const [page, setPage] = useState(1)
  const [order, setOrder] = useState<"" | "chassi-asc" | "chassi-desc">("")

  useEffect(() => { const timer = setTimeout(() => { setTerm(q); setPage(1) }, 350); return () => clearTimeout(timer) }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ visao: "cadastro", q: term, modelo: model, nota: note, pagina: String(page), ordem: order, vendedor: seller })
      const response = await fetch(`/api/contabilidade/chassis?${query}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setData(payload as Payload); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar o cadastro.") } finally { setLoading(false) }
  }, [term, model, note, page, order, seller])
  useEffect(() => { void load() }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.found / data.pageSize)) : 1

  return (
    <SectionCard title="Cadastro de chassis" description="Todos os números de chassi conhecidos (planilha de controle do WhatsApp), com a descrição/tamanho. Os que ainda não têm nota de venda no sistema aparecem como “sem nota”.">
      {data?.missing ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data.hint}</p> : null}
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {data && !data.missing ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Chassis cadastrados" value={data.summary.total.toLocaleString("pt-BR")} hint={`${data.summary.withDescription.toLocaleString("pt-BR")} com descrição / tamanho`} />
            <Card label="Com nota de venda" value={data.summary.withNote.toLocaleString("pt-BR")} hint="já aparecem nos gráficos acima" />
            <Card label="Sem nota no sistema" value={data.summary.withoutNote.toLocaleString("pt-BR")} hint="fabricados / vendidos antes das notas importadas, ou ainda sem nota" />
            <Card label="Na nota, fora do cadastro" value={data.noteChassisNotRegistered.toLocaleString("pt-BR")} hint="número da nota difere da planilha (provável erro de digitação)" />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">Buscar<Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="chassi, descrição, cliente..." className="mt-1 w-72" /></label>
            <label className="text-xs text-muted-foreground">Modelo
              <select value={model} onChange={(event) => { setModel(event.target.value); setPage(1) }} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                <option value="">Todos</option>{data.summary.byModel.map((entry) => <option key={entry.model} value={entry.model}>{entry.model} ({entry.total.toLocaleString("pt-BR")})</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Vendedor
              <select value={seller} onChange={(event) => { setSeller(event.target.value); setPage(1) }} className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                <option value="">Todos</option>{data.sellers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <div className="text-xs text-muted-foreground">Nota de venda
              <div className="mt-1 flex rounded-md border p-0.5 text-sm">{([["sem", "Sem nota"], ["com", "Com nota"], ["", "Todos"]] as const).map(([value, label]) => <button key={label} type="button" onClick={() => { setNote(value); setPage(1) }} className={`rounded px-3 py-1 ${note === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>)}</div>
            </div>
            {loading ? <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="mt-3">
            <DataTable headers={["Chassi", "Modelo", "Descrição / tamanho", "Ano", "PBT", "Capacidade", "Tara", "Vendedor", "Valor", "Consumidor", "Revenda / cliente (conversa)", "Última menção", "Nota de venda"]} sort={{ keys: ["chassi", null, null, null, null, null, null, null, null, null, null, null, null], active: order ? "chassi" : "", dir: order === "chassi-desc" ? "desc" : "asc", onSort: () => { setOrder((current) => (current === "" ? "chassi-asc" : current === "chassi-asc" ? "chassi-desc" : "")); setPage(1) } }} empty={!data.items.length && !loading} stickyHeader viewportClassName="max-h-[60vh]">
              {data.items.map((row) => (
                <TableRow key={`${row.companyId}-${row.vin}`}>
                  <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{row.vin}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.model || "-"}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={row.description}>{row.description || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.yearManufacture || "-"}{row.yearModel && row.yearModel !== row.yearManufacture ? `/${row.yearModel}` : ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{kg(row.pbtKg)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{kg(row.capacityKg)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{kg(row.tareKg)}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.seller || row.externalSeller ? <>{row.seller || "-"}{row.externalSeller ? <div className="text-xs text-muted-foreground">{row.externalSeller}</div> : null}</> : "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{brl(row.saleValue || row.externalValue)}</TableCell>
                  <TableCell className="max-w-[160px] truncate" title={row.consumer}>{row.consumer || "-"}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={row.clientHint}>{row.clientHint || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(row.lastMention)}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.hasNote ? <span title={row.noteClient}>NF {row.noteNumber} · {day(row.noteIssuedAt)}</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">sem nota</span>}</TableCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.found.toLocaleString("pt-BR")} chassi(s) no filtro · página {data.page} de {pages.toLocaleString("pt-BR")}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
              <Button type="button" variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
            </div>
          </div>
        </>
      ) : null}
    </SectionCard>
  )
}
