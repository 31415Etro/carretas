"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TextAreaField, useCrudFeedback } from "@/components/operations/shared"
import { orderLabel } from "@/lib/machines"
import { mApi, type Caps, type Row } from "@/components/machines/machine-data"

const tones: Record<string, string> = {
  Aberta: "border-blue-200 bg-blue-50 text-blue-700", "Aguardando aprovacao": "border-violet-200 bg-violet-50 text-violet-700", "Em execucao": "border-amber-200 bg-amber-50 text-amber-800",
  "Aguardando pecas": "border-orange-200 bg-orange-50 text-orange-800", Suspensa: "border-slate-200 bg-slate-100 text-slate-600", Concluida: "border-emerald-200 bg-emerald-50 text-emerald-700", Cancelada: "border-slate-200 bg-slate-100 text-slate-500",
  Urgente: "border-red-200 bg-red-50 text-red-700", Alta: "border-orange-200 bg-orange-50 text-orange-800", Media: "border-blue-200 bg-blue-50 text-blue-700", Baixa: "border-slate-200 bg-slate-100 text-slate-600",
}
export function OrderBadge({ value }: { value: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tones[value] || tones.Baixa}`}>{orderLabel(value)}</span>
}

const nextSteps: Record<string, Array<{ to: string; label: string }>> = {
  Aberta: [{ to: "Em execucao", label: "Iniciar" }, { to: "Aguardando pecas", label: "Aguardar peças" }],
  "Aguardando aprovacao": [{ to: "Aberta", label: "Aprovar" }],
  "Em execucao": [{ to: "Aguardando pecas", label: "Aguardar peças" }, { to: "Suspensa", label: "Suspender" }],
  "Aguardando pecas": [{ to: "Em execucao", label: "Retomar" }],
  Suspensa: [{ to: "Em execucao", label: "Retomar" }],
}

/** Botões de andamento da ordem (só para quem pode: manutentor). Concluir abre o diálogo de conclusão; cancelar pede o motivo. */
export function OrderActions({ order, caps, onChanged, onComplete }: { order: Row; caps: Caps; onChanged: () => void; onComplete: (order: Row) => void }) {
  const { toast } = useCrudFeedback()
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  if (!caps.maintain || order.status === "Concluida" || order.status === "Cancelada" || order.origin === "Ocorrencia") return null
  const move = async (to: string) => {
    setBusy(true)
    try {
      await mApi("order-action", { body: { item: { id: order.id, toStatus: to } } })
      onChanged()
    } catch (caught) { toast({ title: "Não foi possível alterar a ordem", description: caught instanceof Error ? caught.message : "", variant: "destructive" }); onChanged() } finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); setError("")
    try {
      await mApi("order-action", { body: { item: { id: order.id, toStatus: "Cancelada", reason } } })
      setCancelling(false); setReason(""); onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Erro.") } finally { setBusy(false) }
  }
  const approvalOnly = order.status === "Aguardando aprovacao" && !(caps.admin || caps.patrimony)
  return (
    <div className="flex flex-wrap gap-1.5">
      {approvalOnly ? <span className="text-xs text-muted-foreground">Aguardando quem aprova</span> : (nextSteps[order.status] || []).map((step) => <Button key={step.to} size="sm" variant="outline" disabled={busy} onClick={() => move(step.to)}>{step.label}</Button>)}
      {order.status !== "Aguardando aprovacao" ? <Button size="sm" disabled={busy} onClick={() => onComplete(order)}>Concluir</Button> : null}
      <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => setCancelling(true)}>Cancelar</Button>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancelar {order.orderNumber}</DialogTitle><DialogDescription>A ordem fica no histórico como cancelada; não conta como manutenção realizada.</DialogDescription></DialogHeader>
          <TextAreaField label="Motivo do cancelamento" value={reason} onChange={setReason} rows={2} />
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <DialogFooter><Button variant="outline" onClick={() => setCancelling(false)}>Voltar</Button><Button variant="destructive" disabled={busy || !reason.trim()} onClick={cancel}>Cancelar ordem</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
