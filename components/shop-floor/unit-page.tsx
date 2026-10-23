"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

type Unit = {
  order_code: string; order_status: string; unit_number: number; units: number; vin: string | null; current_step: string | null
  product: { name: string; model: string | null; sku: string }
  tasks: Array<{ id: string; step: string; status: string; started_at: string | null; finished_at: string | null }>
  history: Array<{ at: string; event: string; step: string; worker: string | null }>
  drawing: null | { configuration: null | { params: Record<string, number>; summary: string; revision: string | null; homologated: boolean } }
}
const statusLabel: Record<string, string> = { Pronta: "Pronta", "Em execucao": "Em execução", Pausada: "Pausada", Bloqueada: "Bloqueada", "Com pendencia": "Com pendência", Concluida: "Concluída", Aguardando: "Aguardando", Cancelada: "Cancelada" }
const when = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "-")

/** Destino do QR Code da carreta: exige login do ERP; nenhum dado do cliente. O QR carrega apenas um identificador opaco. */
export function UnitPage({ token }: { token: string }) {
  const [unit, setUnit] = useState<Unit | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    fetch(`/api/chao-de-fabrica/unidade/${token}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`)
      setUnit(data.unit)
    }).catch((failure) => setError(failure instanceof Error ? failure.message : "Erro ao abrir a carreta."))
  }, [token])
  if (error) return <div className="min-h-screen bg-slate-950 p-8 text-2xl text-white">{error}</div>
  if (!unit) return <div className="flex min-h-screen items-center gap-3 bg-slate-950 p-8 text-2xl text-white"><Loader2 className="h-7 w-7 animate-spin" />Carregando...</div>
  const cfg = unit.drawing?.configuration
  return (
    <div className="min-h-screen space-y-5 bg-slate-950 p-5 text-white">
      <header className="rounded-3xl bg-slate-900 p-5">
        <p className="text-3xl font-extrabold">{unit.product.name}{unit.product.model ? ` · ${unit.product.model}` : ""}</p>
        <p className="mt-1 text-xl text-slate-300">Ordem {unit.order_code} · unidade {unit.unit_number} de {unit.units} · {unit.order_status}</p>
        <p className="mt-1 text-xl">Chassi <span className="font-mono font-bold">{unit.vin || "a informar"}</span></p>
        <p className="mt-2 text-xl">Etapa atual: <b>{unit.current_step || "Fabricação concluída"}</b></p>
      </header>
      {cfg ? <section className="rounded-3xl bg-slate-900 p-5 text-xl"><p className="font-bold">Configuração vendida</p><p className="mt-1">{cfg.summary}</p><p className="mt-1 text-slate-300">Revisão {cfg.revision || "sem revisão validada"}{cfg.homologated ? "" : " · desenho ilustrativo"}</p></section> : null}
      <section className="rounded-3xl bg-slate-900 p-5">
        <p className="mb-3 text-2xl font-bold">Etapas</p>
        <ul className="space-y-2 text-xl">{unit.tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-800 p-3"><span>{task.step}</span><span className="font-semibold">{statusLabel[task.status] || task.status}{task.finished_at ? ` · ${when(task.finished_at)}` : ""}</span></li>)}</ul>
      </section>
      <section className="rounded-3xl bg-slate-900 p-5">
        <p className="mb-3 text-2xl font-bold">Histórico de fabricação</p>
        {unit.history.length === 0 ? <p className="text-lg text-slate-400">Nenhum registro ainda.</p> : <ul className="space-y-1 text-lg">{unit.history.map((item, index) => <li key={index}>{when(item.at)} · {item.event} · {item.step}{item.worker ? ` · ${item.worker}` : ""}</li>)}</ul>}
      </section>
    </div>
  )
}
