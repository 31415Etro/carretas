"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormSheet } from "@/components/operations/shared"
import { api, Field, qty } from "@/components/catalog/catalog-fields"

export type StockAdjustTarget = { id: string; name: string; unit: string; physical: number } | null

/** Corrige a quantidade em estoque de uma matéria-prima (lança o ajuste da diferença, com motivo, no histórico de movimentações). */
export function StockAdjustSheet({ target, onClose, onSaved }: { target: StockAdjustTarget; onClose: () => void; onSaved: () => void }) {
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { if (target) { setQuantity(String(Number(target.physical || 0))); setReason(""); setError("") } }, [target])
  const next = Number(String(quantity).replace(",", "."))
  const difference = target && Number.isFinite(next) ? Math.round((next - Number(target.physical || 0)) * 1000) / 1000 : 0

  async function save() {
    if (!target) return
    setSaving(true); setError("")
    try {
      await api(`/api/materias-primas/${target.id}/saldo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: next, reason }) })
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível ajustar a quantidade.") } finally { setSaving(false) }
  }

  return (
    <FormSheet open={!!target} onOpenChange={(open) => { if (!open) onClose() }} title="Ajustar quantidade em estoque" description={target ? `${target.name} · hoje ${qty(target.physical)} ${target.unit} na empresa em uso` : ""}
      footer={<div className="flex gap-2"><Button type="button" onClick={() => void save()} disabled={saving || !Number.isFinite(next) || next < 0 || !reason.trim() || !difference}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar quantidade</Button><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button></div>}>
      <Field label={`Nova quantidade em estoque (${target?.unit || ""})`} hint="É a quantidade que deve existir agora; o sistema lança a diferença como ajuste.">
        <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus />
      </Field>
      <Field label="Motivo do ajuste" hint="Fica registrado no histórico (ex.: contagem física, correção da carga das notas).">
        <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: contagem física" />
      </Field>
      {difference ? <p className="text-sm text-muted-foreground">Diferença: <strong className={difference > 0 ? "text-emerald-700" : "text-red-700"}>{difference > 0 ? "+" : ""}{qty(difference)} {target?.unit}</strong></p> : null}
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
    </FormSheet>
  )
}
