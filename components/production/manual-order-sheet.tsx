"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet, SaveButton, SearchableSelectField } from "@/components/operations/shared"
import { api, Field } from "@/components/catalog/catalog-fields"

type Options = { clients: Array<{ id: string; name: string; document: string }>; products: Array<{ id: string; name: string; code: string; bomVersion?: number | null }> }

/** Abre uma ordem de produção direto na produção, sem passar por pedido de venda (ex.: carreta de demonstração, reposição interna). */
export function ManualOrderSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (result: { code: string; documentation_created: number }) => void }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [form, setForm] = useState({ productId: "", quantity: "1", plannedEnd: "", priority: "3", clientId: "", responsible: "", notes: "", createDocumentation: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open || options) return
    api<Options>("/api/orcamentos/options").then(setOptions).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os produtos."))
  }, [open, options])

  const products = (options?.products || []).filter((product) => product.bomVersion)
  async function save() {
    setSaving(true); setError("")
    try {
      const data = await api<{ result: { code: string; documentation_created: number } }>("/api/producao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quantity: Number(form.quantity), priority: Number(form.priority), clientId: form.clientId || undefined }) })
      onOpenChange(false)
      setForm({ productId: "", quantity: "1", plannedEnd: "", priority: "3", clientId: "", responsible: "", notes: "", createDocumentation: false })
      onCreated(data.result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A ordem não foi criada.") } finally { setSaving(false) }
  }
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nova ordem de produção" description="Abre a fabricação direto na produção, sem pedido de venda. Usa a estrutura de fabricação ativa do produto, reserva os materiais e gera as tarefas da esteira."
      footer={<SaveButton onClick={() => void save()} disabled={saving || !form.productId || !(Number(form.quantity) > 0)}>{saving ? "Criando..." : "Criar ordem"}</SaveButton>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {!options && !error ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando produtos...</p> : null}
      <SearchableSelectField label="Produto (com estrutura de fabricação ativa) *" value={form.productId} onChange={(value) => setForm({ ...form, productId: value })} options={products.map((product) => ({ value: product.id, label: `${product.code} · ${product.name} (estrutura v${product.bomVersion})` }))} placeholder="Escolha o produto" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Quantidade *" hint="Inteiro: cada carreta é uma unidade."><Input type="number" min={1} step={1} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
        <Field label="Prazo previsto"><Input type="date" value={form.plannedEnd} onChange={(event) => setForm({ ...form, plannedEnd: event.target.value })} /></Field>
        <Field label="Prioridade"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{[["1", "1 · Urgente"], ["2", "2 · Alta"], ["3", "3 · Normal"], ["4", "4 · Baixa"], ["5", "5 · Mínima"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <Field label="Responsável"><Input value={form.responsible} onChange={(event) => setForm({ ...form, responsible: event.target.value })} placeholder="Opcional" /></Field>
      <SearchableSelectField label="Cliente / proprietário (opcional)" value={form.clientId} onChange={(value) => setForm({ ...form, clientId: value })} options={[{ value: "", label: "Sem cliente (fabricação interna)" }, ...(options?.clients || []).map((client) => ({ value: client.id, label: `${client.name}${client.document ? ` · ${client.document}` : ""}` }))]} placeholder="Sem cliente" />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.createDocumentation} onChange={(event) => setForm({ ...form, createDocumentation: event.target.checked })} /><span>Criar a documentação veicular de cada unidade (exige cliente). Ela corre em paralelo à fabricação.</span></label>
      <Field label="Observações"><Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: carreta de demonstração para feira" /></Field>
    </FormSheet>
  )
}
