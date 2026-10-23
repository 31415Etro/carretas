"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet, SaveButton, SearchableSelectField } from "@/components/operations/shared"
import { api, Field } from "@/components/catalog/catalog-fields"
import { normalizeVin, vinProblem } from "@/lib/vehicle-documentation"

type Options = { clients: Array<{ id: string; name: string; document: string }>; products: Array<{ id: string; name: string; code: string }> }
type OrderRow = { id: string; code: string; product_name: string; quantity: number; client_name?: string }

/** Abre a documentação veicular de uma carreta sem pedido de venda: avulsa (escolhe o produto) ou ligada a uma ordem de produção aberta. */
export function ManualDocumentationSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [form, setForm] = useState({ clientId: "", productId: "", productionOrderId: "", vin: "", notes: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open || options) return
    Promise.all([api<Options>("/api/orcamentos/options"), api<{ items: OrderRow[] }>("/api/producao?status=abertas&tamanho=100")])
      .then(([opts, list]) => { setOptions(opts); setOrders(list.items) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados."))
  }, [open, options])

  const vin = normalizeVin(form.vin)
  const vinError = vin ? vinProblem(vin) : ""
  const byOrder = Boolean(form.productionOrderId)
  async function save() {
    setSaving(true); setError("")
    try {
      const data = await api<{ result: { documentation_id: string } }>("/api/documentacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: form.clientId, productId: byOrder ? undefined : form.productId, productionOrderId: form.productionOrderId || undefined, vin: vin || undefined, notes: form.notes }) })
      onOpenChange(false)
      setForm({ clientId: "", productId: "", productionOrderId: "", vin: "", notes: "" })
      onCreated(data.result.documentation_id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "A documentação não foi criada.") } finally { setSaving(false) }
  }
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nova documentação veicular" description="Abre o pré-cadastro de uma carreta sem pedido de venda. Escolha uma ordem de produção (usa a próxima unidade livre) ou apenas o produto."
      footer={<SaveButton onClick={() => void save()} disabled={saving || !form.clientId || (!byOrder && !form.productId) || Boolean(vinError)}>{saving ? "Criando..." : "Criar documentação"}</SaveButton>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {!options && !error ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</p> : null}
      <SearchableSelectField label="Cliente / proprietário *" value={form.clientId} onChange={(value) => setForm({ ...form, clientId: value })} options={(options?.clients || []).map((client) => ({ value: client.id, label: `${client.name}${client.document ? ` · ${client.document}` : ""}` }))} placeholder="Escolha o cliente" />
      <SearchableSelectField label="Ordem de produção (opcional)" value={form.productionOrderId} onChange={(value) => setForm({ ...form, productionOrderId: value })} options={[{ value: "", label: "Sem ordem de produção" }, ...orders.map((order) => ({ value: order.id, label: `${order.code} · ${order.product_name} (${order.quantity} un.)` }))]} placeholder="Sem ordem de produção" />
      {!byOrder ? <SearchableSelectField label="Produto (carreta) *" value={form.productId} onChange={(value) => setForm({ ...form, productId: value })} options={(options?.products || []).map((product) => ({ value: product.id, label: `${product.code} · ${product.name}` }))} placeholder="Escolha o produto" /> : null}
      <Field label="Chassi (VIN)" hint="Opcional agora; é exigido para enviar ao portal." error={vinError}><Input value={form.vin} onChange={(event) => setForm({ ...form, vin: event.target.value })} placeholder="17 caracteres" className="font-mono" /></Field>
      <Field label="Observações"><Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    </FormSheet>
  )
}
