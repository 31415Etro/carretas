"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, dateBr } from "@/components/catalog/catalog-fields"
import { canRequestEntry, situationLabel, situationTone, type RenaverSituation } from "@/lib/renaver"

export type RenaverItem = { vin: string; tab: string | null; renaver_status: string | null; kind: string | null; situation: RenaverSituation; entry_state: string | null; entry_message: string | null; entry_requested_by: string | null; entry_requested_at: string | null; last_seen_at: string; last_changed_at: string }
export type RenaverRun = { finished_at: string; ok: boolean; error: string | null; total: number; pending: number; success: number; failure: number } | null

/** Situação no Renaver dos chassis informados + última verificação do robô. */
export function useRenaver(vins: string[]) {
  const key = Array.from(new Set(vins.filter(Boolean))).sort().join(",")
  const [items, setItems] = useState<Record<string, RenaverItem>>({})
  const [run, setRun] = useState<RenaverRun>(null)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    try {
      const data = await api<{ items: RenaverItem[]; run: RenaverRun }>(`/api/documentacao/renaver?vins=${encodeURIComponent(key)}`)
      setItems(Object.fromEntries(data.items.map((item) => [item.vin, item]))); setRun(data.run); setError("")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao consultar o Renaver.") }
  }, [key])
  useEffect(() => { void load() }, [load])
  return { items, run, error, reload: load }
}

export function RenaverBadge({ item }: { item?: RenaverItem }) {
  if (!item) return <span className="text-xs text-muted-foreground">não consta</span>
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${situationTone[item.situation]}`} title={`${item.tab || "-"} · ${item.renaver_status || "-"}`}>{situationLabel[item.situation]}</span>
}

export function RenaverRunLine({ run, canOperate, onChanged }: { run: RenaverRun; canOperate: boolean; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  async function verify() {
    setBusy(true); setNote("")
    try {
      const data = await api<{ started: boolean }>("/api/documentacao/renaver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verificar" }) })
      setNote(data.started ? "Verificação iniciada: leva alguns minutos. Atualize a página depois." : "Já há uma verificação em andamento (ou o robô não está neste servidor).")
      setTimeout(() => onChanged?.(), 60_000)
    } catch (reason) { setNote(reason instanceof Error ? reason.message : "Não foi possível iniciar.") } finally { setBusy(false) }
  }
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${run && !run.ok ? "border-red-300 bg-red-50" : "bg-muted/30"}`}>
      <span className="flex items-center gap-2"><Truck className="h-4 w-4 shrink-0" />
        {!run ? "Renaver: nenhuma verificação feita ainda (o robô confere todo dia de manhã)."
          : run.ok ? `Renaver conferido em ${dateBr(run.finished_at)}: ${run.pending} pendente(s), ${run.success} com sucesso, ${run.failure} com falha.`
          : `A última verificação do Renaver FALHOU em ${dateBr(run.finished_at)}: ${run.error || "sem detalhe"}.`}
        {note ? <span className="text-muted-foreground"> {note}</span> : null}
      </span>
      {canOperate ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void verify()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Verificar agora</Button> : null}
    </div>
  )
}

/** Bloco do chassi na folha da unidade: situação no Renaver e o pedido de Entrada de Zero KM. */
export function RenaverPanel({ vin, canOperate }: { vin: string; canOperate: boolean }) {
  const { items, run, error, reload } = useRenaver(vin ? [vin] : [])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const item = vin ? items[vin.toUpperCase()] : undefined
  async function requestEntry() {
    if (!window.confirm(`Dar a Entrada de Zero KM do chassi ${vin} no Renaver?\n\nIsso é uma operação oficial no portal. O robô executa na hora e a situação é conferida na leitura seguinte.`)) return
    setBusy(true); setNote("")
    try {
      await api("/api/documentacao/renaver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "entrada", vin }) })
      setNote("Pedido enviado ao robô. Atualize em alguns minutos.")
      await reload()
    } catch (reason) { setNote(reason instanceof Error ? reason.message : "Não foi possível pedir a entrada.") } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><h4 className="font-medium">Renaver (montadora)</h4><RenaverBadge item={item} />{item ? <span className="text-xs text-muted-foreground">{item.tab} · {item.renaver_status}</span> : null}</div>
      {!vin ? <p className="text-xs text-muted-foreground">Informe o chassi para acompanhar o Renaver.</p> : null}
      {vin && !item ? <p className="text-xs text-muted-foreground">Esse chassi ainda não apareceu no Renaver (a leitura roda todo dia de manhã).</p> : null}
      {item?.entry_message ? <p className={`text-xs ${item.entry_state === "erro" ? "text-destructive" : "text-muted-foreground"}`}>Entrada de Zero KM: {item.entry_message}{item.entry_requested_by ? ` (pedida por ${item.entry_requested_by})` : ""}</p> : null}
      {item ? <p className="text-xs text-muted-foreground">Visto pela última vez em {dateBr(item.last_seen_at)} · mudou em {dateBr(item.last_changed_at)}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {note ? <p className="text-xs">{note}</p> : null}
      {canOperate && item && canRequestEntry(item) ? <Button size="sm" disabled={busy} onClick={() => void requestEntry()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}Dar entrada de Zero KM no Renaver</Button> : null}
      <p className="text-[11px] text-muted-foreground">{run ? (run.ok ? `Última verificação do robô: ${dateBr(run.finished_at)}.` : `A última verificação falhou em ${dateBr(run.finished_at)}: ${run.error}`) : "O robô ainda não verificou o Renaver."}</p>
    </div>
  )
}
