"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Ban, CheckCircle2, FileText, PackageCheck, Pencil, Plus, Printer, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, MetricCard, PageShell, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { useWarehouses } from "@/components/operations/stock-erp"
import { useAuth } from "@/lib/auth-context"
import { paymentMethodOptions } from "@/lib/finance-erp"
import type { Material, Supplier } from "@/lib/operational-storage"
import { purchaseActionAllowed, purchaseItemTotal, purchaseOrderTotals, purchaseStatuses, validatePurchaseOrder, type PurchaseOrderInput, type PurchaseStatus } from "@/lib/purchases"

type OrderItem = { id: string; materialId: string; description: string; unit: string; quantity: number; unitCost: number; discountPercent: number; total: number; receivedQuantity: number; notes: string }
type Receipt = { id: string; invoiceNumber: string; invoiceDate: string; receivedAt: string; itemsAmount: number; extraCostsAmount: number; totalAmount: number; payablesGenerated: number; responsible: string; notes: string }
type PurchaseOrder = {
  id: string; orderNumber: string; supplierId: string; supplierName: string; status: PurchaseStatus; orderDate: string; expectedDate: string
  warehouseId: string; paymentConditionId: string; paymentMethod: string; financialCategoryId: string; costCenterId: string; supplierReference: string
  itemsTotal: number; freightAmount: number; otherCosts: number; discountAmount: number; totalAmount: number; notes: string
  createdBy: string; approvedBy: string; approvedAt: string; closedReason: string; items: OrderItem[]; receipts: Receipt[]
}
type Options = { paymentConditions: Array<{ id: string; name: string; installments: number; firstDueDays: number; intervalDays: number; paymentMethod: string }>; categories: Array<{ id: string; name: string }>; costCenters: Array<{ id: string; name: string }> }
type FormItem = { key: string; materialId: string; description: string; unit: string; quantity: string; unitCost: string; discountPercent: string }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
const day = (value: string) => value ? value.slice(0, 10).split("-").reverse().join("/") : "-"
const today = () => new Date().toISOString().slice(0, 10)
const num = (value: string | number) => Number(String(value ?? "").replace(",", ".")) || 0
const newKey = () => Math.random().toString(36).slice(2)
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyForm = { id: "", supplierId: "", orderDate: today(), expectedDate: "", warehouseId: "", paymentConditionId: "", paymentMethod: "Boleto", financialCategoryId: "", costCenterId: "", supplierReference: "", freightAmount: "0", otherCosts: "0", discountAmount: "0", notes: "" }

function receivedPercent(order: PurchaseOrder) {
  const ordered = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const received = order.items.reduce((sum, item) => sum + Math.min(item.receivedQuantity, item.quantity), 0)
  return ordered ? Math.round((received / ordered) * 100) : 0
}

export function PurchasesPage() {
  const { toast } = useCrudFeedback()
  const { user } = useAuth()
  const canApprove = user?.role === "admin" || user?.role === "manager"
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState("abertos")
  const [query, setQuery] = useState("")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [options, setOptions] = useState<Options>({ paymentConditions: [], categories: [], costCenters: [] })
  const { warehouses } = useWarehouses()
  const [editing, setEditing] = useState<PurchaseOrder | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await api<{ orders: PurchaseOrder[] }>("/api/compras/orders")
      setOrders(payload.orders)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar pedidos.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api<{ suppliers: Supplier[] }>("/api/suppliers").then((payload) => setSuppliers(payload.suppliers)).catch(() => undefined)
    api<{ materials: Material[] }>("/api/estoque/materials").then((payload) => setMaterials(payload.materials)).catch(() => undefined)
    api<Options>("/api/compras/options").then(setOptions).catch(() => undefined)
  }, [load])

  const visible = useMemo(() => orders.filter((order) => {
    const statusMatch = statusFilter === "todos" || (statusFilter === "abertos" ? ["Rascunho", "Aprovado", "Parcialmente recebido"].includes(order.status) : order.status === statusFilter)
    const text = [order.orderNumber, order.supplierName, order.supplierReference, ...order.items.map((item) => item.description)].join(" ").toLowerCase()
    return statusMatch && text.includes(query.toLowerCase())
  }), [orders, statusFilter, query])

  const metrics = useMemo(() => ({
    drafts: orders.filter((order) => order.status === "Rascunho").length,
    awaiting: orders.filter((order) => ["Aprovado", "Parcialmente recebido"].includes(order.status)),
    late: orders.filter((order) => ["Aprovado", "Parcialmente recebido"].includes(order.status) && order.expectedDate && order.expectedDate < today()).length,
  }), [orders])

  async function act(order: PurchaseOrder, action: "approve" | "reopen" | "cancel" | "close") {
    const labels = { approve: "Aprovar", reopen: "Reabrir para edição", cancel: "Cancelar", close: "Encerrar o saldo pendente de" }
    let reason = ""
    if (action === "cancel" || action === "close") {
      reason = window.prompt(`${labels[action]} o pedido ${order.orderNumber}. Informe o motivo:`) || ""
      if (!reason.trim()) return
    } else if (!window.confirm(`${labels[action]} o pedido ${order.orderNumber}?`)) return
    try {
      await api(`/api/compras/orders/${order.id}`, { method: "POST", body: JSON.stringify({ action, reason }) })
      toast({ title: "Pedido atualizado", description: order.orderNumber })
      void load()
    } catch (reason) {
      toast({ title: "Não foi possível atualizar", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  function printOrder(order: PurchaseOrder) {
    const supplier = suppliers.find((item) => item.id === order.supplierId)
    const condition = options.paymentConditions.find((item) => item.id === order.paymentConditionId)?.name || "-"
    const rows = order.items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(materials.find((row) => row.id === item.materialId)?.internalCode || "")}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.unit)}</td><td class="n">${qty(item.quantity)}</td><td class="n">${brl(item.unitCost)}</td><td class="n">${qty(item.discountPercent)}%</td><td class="n">${brl(item.total)}</td></tr>`).join("")
    const win = window.open("", "_blank")
    if (!win) return toast({ title: "Pop-up bloqueado", description: "Libere pop-ups para imprimir o pedido.", variant: "destructive" })
    win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${escapeHtml(order.orderNumber)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;color:#172033;margin:24px}h1{font-size:20px;margin:0 0 4px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:12px 0}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #d8e0ec;padding:6px;text-align:left}th{background:#eef3f9}.n{text-align:right;white-space:nowrap}.tot{margin-top:12px;float:right;min-width:260px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.tot strong{font-size:14px}</style></head><body><h1>Pedido de compra ${escapeHtml(order.orderNumber)}</h1><div>Situação: ${escapeHtml(order.status)}</div><div class="grid"><div><b>Fornecedor:</b> ${escapeHtml(order.supplierName)}</div><div><b>CNPJ/CPF:</b> ${escapeHtml(supplier?.document || "-")}</div><div><b>Data:</b> ${day(order.orderDate)}</div><div><b>Entrega prevista:</b> ${day(order.expectedDate)}</div><div><b>Condição de pagamento:</b> ${escapeHtml(condition)}</div><div><b>Forma de pagamento:</b> ${escapeHtml(order.paymentMethod || "-")}</div><div><b>Referência do fornecedor:</b> ${escapeHtml(order.supplierReference || "-")}</div><div><b>Aprovado por:</b> ${escapeHtml(order.approvedBy || "-")}</div></div><table><thead><tr><th>#</th><th>SKU</th><th>Descrição</th><th>Un.</th><th class="n">Qtd.</th><th class="n">Custo unit.</th><th class="n">Desc.</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody></table><div class="tot"><div><span>Itens</span><span>${brl(order.itemsTotal)}</span></div><div><span>Frete</span><span>${brl(order.freightAmount)}</span></div><div><span>Outros custos</span><span>${brl(order.otherCosts)}</span></div><div><span>Desconto</span><span>- ${brl(order.discountAmount)}</span></div><div><strong>Total</strong><strong>${brl(order.totalAmount)}</strong></div></div>${order.notes ? `<p style="clear:both;padding-top:12px"><b>Observações:</b> ${escapeHtml(order.notes)}</p>` : ""}<script>window.addEventListener('load',()=>window.print())</script></body></html>`)
    win.document.close()
  }

  return (
    <PageShell title="Compras" description="Pedidos de compra, aprovação e recebimento. O recebimento dá entrada no estoque (com custo médio) e gera as contas a pagar." actions={<Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="h-4 w-4" />Novo pedido</Button>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Rascunhos" value={metrics.drafts} note="Aguardando aprovação" icon={FileText} />
        <MetricCard title="Aguardando entrega" value={metrics.awaiting.length} note="Aprovados ou parciais" icon={PackageCheck} />
        <MetricCard title="Valor a receber" value={brl(metrics.awaiting.reduce((sum, order) => sum + order.totalAmount * (1 - receivedPercent(order) / 100), 0))} note="Saldo dos pedidos em aberto" icon={PackageCheck} />
        <MetricCard title="Entregas atrasadas" value={metrics.late} note="Previsão de entrega vencida" icon={Ban} />
      </div>
      <SectionCard title="Pedidos de compra">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]"><SelectField label="Situação" value={statusFilter} onChange={setStatusFilter} options={[{ value: "abertos", label: "Em aberto" }, { value: "todos", label: "Todos" }, ...purchaseStatuses.map((value) => ({ value, label: value }))]} /></div>
          <div className="min-w-[280px] flex-1"><TextField label="Buscar" value={query} onChange={setQuery} placeholder="Número, fornecedor ou item" /></div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Número", "Data", "Fornecedor", "Entrega prevista", "Itens", "Recebido", "Total", "Situação", "Ações"]} empty={!visible.length} stickyHeader viewportClassName="max-h-[40rem] overflow-auto overscroll-contain" tableClassName="min-w-[1300px]">
          {visible.map((order) => {
            const late = ["Aprovado", "Parcialmente recebido"].includes(order.status) && order.expectedDate && order.expectedDate < today()
            const hasReceipts = order.receipts.length > 0
            return <TableRow key={order.id}>
              <TableCell className="font-mono">{order.orderNumber}</TableCell>
              <TableCell>{day(order.orderDate)}</TableCell>
              <TableCell>{order.supplierName}</TableCell>
              <TableCell className={late ? "font-semibold text-destructive" : ""}>{day(order.expectedDate)}</TableCell>
              <TableCell>{order.items.length}</TableCell>
              <TableCell>{receivedPercent(order)}%</TableCell>
              <TableCell>{brl(order.totalAmount)}</TableCell>
              <TableCell><StatusBadge status={order.status} /></TableCell>
              <TableCell className="space-x-1 whitespace-nowrap">
                <Button size="sm" variant="outline" onClick={() => { setEditing(order); setFormOpen(true) }}>{order.status === "Rascunho" ? <><Pencil className="h-4 w-4" />Editar</> : "Ver"}</Button>
                {canApprove && purchaseActionAllowed("approve", order.status, hasReceipts) ? <Button size="sm" onClick={() => void act(order, "approve")}><CheckCircle2 className="h-4 w-4" />Aprovar</Button> : null}
                {["Aprovado", "Parcialmente recebido"].includes(order.status) ? <Button size="sm" onClick={() => setReceiving(order)}><PackageCheck className="h-4 w-4" />Receber</Button> : null}
                {purchaseActionAllowed("reopen", order.status, hasReceipts) ? <Button size="sm" variant="outline" onClick={() => void act(order, "reopen")}><RotateCcw className="h-4 w-4" />Reabrir</Button> : null}
                {purchaseActionAllowed("close", order.status, hasReceipts) ? <Button size="sm" variant="outline" onClick={() => void act(order, "close")}>Encerrar saldo</Button> : null}
                {purchaseActionAllowed("cancel", order.status, hasReceipts) ? <Button size="sm" variant="destructive" onClick={() => void act(order, "cancel")}>Cancelar</Button> : null}
                <Button size="sm" variant="ghost" title="Imprimir pedido" onClick={() => printOrder(order)}><Printer className="h-4 w-4" /></Button>
              </TableCell>
            </TableRow>
          })}
        </DataTable>
        {!canApprove ? <p className="mt-3 text-xs text-muted-foreground">A aprovação de pedidos é feita por administradores e gestores.</p> : null}
      </SectionCard>
      <PurchaseOrderSheet open={formOpen} onOpenChange={setFormOpen} order={editing} suppliers={suppliers} materials={materials} warehouses={warehouses} options={options} onSaved={() => void load()} />
      <ReceiveSheet order={receiving} onOpenChange={(open) => !open && setReceiving(null)} materials={materials} warehouses={warehouses} options={options} onReceived={() => void load()} />
    </PageShell>
  )
}

function PurchaseOrderSheet({ open, onOpenChange, order, suppliers, materials, warehouses, options, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; order: PurchaseOrder | null; suppliers: Supplier[]; materials: Material[]; warehouses: Array<{ id: string; name: string; status: string; isDefault: boolean }>; options: Options; onSaved: () => void }) {
  const { toast } = useCrudFeedback()
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState<FormItem[]>([])
  const [saving, setSaving] = useState(false)
  const readOnly = Boolean(order && order.status !== "Rascunho")

  useEffect(() => {
    if (!open) return
    if (order) {
      setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map((key) => [key, String((order as any)[key] ?? "")])) })
      setItems(order.items.map((item) => ({ key: item.id, materialId: item.materialId, description: item.description, unit: item.unit, quantity: String(item.quantity), unitCost: String(item.unitCost), discountPercent: String(item.discountPercent) })))
    } else {
      setForm({ ...emptyForm, orderDate: today(), warehouseId: warehouses.find((item) => item.isDefault)?.id || "" })
      setItems([])
    }
  }, [open, order, warehouses])

  const input: PurchaseOrderInput = {
    id: form.id || undefined,
    supplierId: form.supplierId,
    supplierName: suppliers.find((item) => item.id === form.supplierId)?.name || order?.supplierName || "",
    orderDate: form.orderDate,
    expectedDate: form.expectedDate,
    warehouseId: form.warehouseId,
    paymentConditionId: form.paymentConditionId,
    paymentMethod: form.paymentMethod,
    financialCategoryId: form.financialCategoryId,
    costCenterId: form.costCenterId,
    supplierReference: form.supplierReference,
    freightAmount: num(form.freightAmount),
    otherCosts: num(form.otherCosts),
    discountAmount: num(form.discountAmount),
    notes: form.notes,
    items: items.map((item) => ({ materialId: item.materialId, description: item.description, unit: item.unit, quantity: num(item.quantity), unitCost: num(item.unitCost), discountPercent: num(item.discountPercent) })),
  }
  const totals = purchaseOrderTotals(input)

  function setItem(key: string, patch: Partial<FormItem>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item))
  }

  function pickMaterial(key: string, materialId: string) {
    const material = materials.find((item) => item.id === materialId)
    setItem(key, { materialId, description: material?.name || "", unit: material?.unit || "UN", unitCost: String(material?.lastPurchaseCost || material?.averageCost || material?.costPrice || 0) })
    if (material?.supplierId && !form.supplierId) setForm((current) => ({ ...current, supplierId: material.supplierId || "" }))
  }

  async function save() {
    const invalid = validatePurchaseOrder(input)
    if (invalid) return toast({ title: "Revise o pedido", description: invalid, variant: "destructive" })
    setSaving(true)
    try {
      const payload = await api<{ order: PurchaseOrder }>("/api/compras/orders", { method: "POST", body: JSON.stringify({ order: input }) })
      toast({ title: order ? "Pedido atualizado" : "Pedido criado", description: `${payload.order.orderNumber} salvo como rascunho.` })
      onOpenChange(false)
      onSaved()
    } catch (reason) {
      toast({ title: "Pedido não salvo", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const materialOptions = [{ value: "nenhum", label: "Selecione o produto" }, ...materials.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.internalCode ? `${item.internalCode} - ` : ""}${item.name}` }))]
  const preferred = form.supplierId ? materials.filter((item) => item.supplierId === form.supplierId && item.status === "Ativo") : []

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={order ? `Pedido ${order.orderNumber} — ${order.status}` : "Novo pedido de compra"} description={readOnly ? "Pedido aprovado ou finalizado: somente leitura. Para editar um pedido aprovado sem recebimentos, use Reabrir." : undefined}>
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <SearchableSelectField label="Fornecedor" value={form.supplierId || "nenhum"} onChange={(value) => setForm({ ...form, supplierId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...suppliers.filter((item) => item.status !== "Inativo" || item.id === form.supplierId).map((item) => ({ value: item.id, label: item.document ? `${item.name} - ${item.document}` : item.name }))]} />
          <TextField label="Referência / cotação do fornecedor" value={form.supplierReference} onChange={(value) => setForm({ ...form, supplierReference: value })} />
          <TextField label="Data do pedido" type="date" value={form.orderDate} onChange={(value) => setForm({ ...form, orderDate: value })} />
          <TextField label="Entrega prevista" type="date" value={form.expectedDate} onChange={(value) => setForm({ ...form, expectedDate: value })} />
          <SelectField label="Depósito de entrega" value={form.warehouseId || "nenhum"} onChange={(value) => setForm({ ...form, warehouseId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Padrão de cada item" }, ...warehouses.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} />
          <SelectField label="Condição de pagamento" value={form.paymentConditionId || "nenhuma"} onChange={(value) => {
            const condition = options.paymentConditions.find((item) => item.id === value)
            setForm({ ...form, paymentConditionId: value === "nenhuma" ? "" : value, paymentMethod: condition?.paymentMethod || form.paymentMethod })
          }} options={[{ value: "nenhuma", label: "À vista (vencimento no recebimento)" }, ...options.paymentConditions.map((item) => ({ value: item.id, label: item.name }))]} />
          <SelectField label="Forma de pagamento" value={form.paymentMethod || "Boleto"} onChange={(value) => setForm({ ...form, paymentMethod: value })} options={paymentMethodOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Categoria financeira" value={form.financialCategoryId || "nenhuma"} onChange={(value) => setForm({ ...form, financialCategoryId: value === "nenhuma" ? "" : value })} options={[{ value: "nenhuma", label: "Sem categoria" }, ...options.categories.map((item) => ({ value: item.id, label: item.name }))]} />
          <SelectField label="Centro de custo" value={form.costCenterId || "nenhum"} onChange={(value) => setForm({ ...form, costCenterId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem centro" }, ...options.costCenters.map((item) => ({ value: item.id, label: item.name }))]} />
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Itens</h3>
            <div className="flex gap-2">
              {preferred.length && !readOnly ? <Button type="button" size="sm" variant="outline" onClick={() => setItems((current) => [...current, ...preferred.filter((item) => !current.some((row) => row.materialId === item.id)).map((item) => ({ key: newKey(), materialId: item.id, description: item.name, unit: item.unit, quantity: "1", unitCost: String(item.lastPurchaseCost || item.averageCost || item.costPrice || 0), discountPercent: "0" }))])}>Itens deste fornecedor ({preferred.length})</Button> : null}
              {!readOnly ? <Button type="button" size="sm" onClick={() => setItems((current) => [...current, { key: newKey(), materialId: "", description: "", unit: "UN", quantity: "1", unitCost: "0", discountPercent: "0" }])}><Plus className="h-4 w-4" />Item</Button> : null}
            </div>
          </div>
          {items.length ? items.map((item, index) => (
            <div key={item.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,2fr)_90px_120px_90px_120px_auto] md:items-end">
              <SearchableSelectField label={`Produto ${index + 1}`} value={item.materialId || "nenhum"} onChange={(value) => pickMaterial(item.key, value === "nenhum" ? "" : value)} options={materialOptions} />
              <TextField label={`Qtd. (${item.unit})`} type="number" value={item.quantity} onChange={(value) => setItem(item.key, { quantity: value })} />
              <TextField label="Custo unit." type="number" value={item.unitCost} onChange={(value) => setItem(item.key, { unitCost: value })} />
              <TextField label="Desc. %" type="number" value={item.discountPercent} onChange={(value) => setItem(item.key, { discountPercent: value })} />
              <div className="space-y-2"><Label>Total</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{brl(purchaseItemTotal({ quantity: num(item.quantity), unitCost: num(item.unitCost), discountPercent: num(item.discountPercent) }))}</div></div>
              {!readOnly ? <Button type="button" size="icon" variant="ghost" title="Remover item" onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}><Trash2 className="h-4 w-4" /></Button> : <span />}
              {order && order.status !== "Rascunho" ? <p className="text-xs text-muted-foreground md:col-span-6">Recebido: {qty(order.items[index]?.receivedQuantity || 0)} de {qty(order.items[index]?.quantity || 0)} {item.unit}</p> : null}
            </div>
          )) : <p className="text-sm text-muted-foreground">Nenhum item. Adicione os produtos do catálogo que serão comprados.</p>}
        </section>

        <div className="grid gap-4 md:grid-cols-4">
          <TextField label="Frete (R$)" type="number" value={form.freightAmount} onChange={(value) => setForm({ ...form, freightAmount: value })} />
          <TextField label="Outros custos (R$)" type="number" value={form.otherCosts} onChange={(value) => setForm({ ...form, otherCosts: value })} />
          <TextField label="Desconto (R$)" type="number" value={form.discountAmount} onChange={(value) => setForm({ ...form, discountAmount: value })} />
          <div className="space-y-2"><Label>Total do pedido</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">{brl(totals.total)}</div></div>
        </div>
        <p className="text-xs text-muted-foreground">Itens {brl(totals.itemsTotal)}. Frete, outros custos e desconto são rateados no custo dos itens ao receber.</p>
        <TextAreaField label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
      </fieldset>

      {order?.receipts.length ? <div className="space-y-2"><h3 className="text-sm font-semibold">Recebimentos</h3>{order.receipts.map((receipt) => <p key={receipt.id} className="rounded-md border p-2 text-sm">{day(receipt.receivedAt)} · NF {receipt.invoiceNumber} · {brl(receipt.totalAmount)} · {receipt.payablesGenerated} conta(s) a pagar · {receipt.responsible}</p>)}</div> : null}
      {order?.closedReason ? <p className="text-sm text-muted-foreground">Motivo ({order.status.toLowerCase()}): {order.closedReason}</p> : null}
      {order ? <p className="text-xs text-muted-foreground">Criado por {order.createdBy || "-"}{order.approvedBy ? ` · aprovado por ${order.approvedBy} em ${day(order.approvedAt)}` : ""}</p> : null}
      {!readOnly ? <SaveButton disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar rascunho"}</SaveButton> : null}
    </FormSheet>
  )
}

function ReceiveSheet({ order, onOpenChange, materials, warehouses, options, onReceived }: { order: PurchaseOrder | null; onOpenChange: (open: boolean) => void; materials: Material[]; warehouses: Array<{ id: string; name: string; status: string }>; options: Options; onReceived: () => void }) {
  const { toast } = useCrudFeedback()
  const [header, setHeader] = useState({ invoiceNumber: "", invoiceDate: "", receivedAt: today(), firstDueDate: "", generatePayables: true, notes: "" })
  const [lines, setLines] = useState<Record<string, { quantity: string; lotNumber: string; serialNumber: string; expiryDate: string }>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!order) return
    setHeader({ invoiceNumber: "", invoiceDate: "", receivedAt: today(), firstDueDate: "", generatePayables: true, notes: "" })
    setLines(Object.fromEntries(order.items.map((item) => [item.id, { quantity: String(Math.max(item.quantity - item.receivedQuantity, 0)), lotNumber: "", serialNumber: "", expiryDate: "" }])))
  }, [order])

  if (!order) return null
  const condition = options.paymentConditions.find((item) => item.id === order.paymentConditionId)
  const value = order.items.reduce((sum, item) => sum + num(lines[item.id]?.quantity || 0) * item.unitCost * (1 - item.discountPercent / 100), 0)
  const extra = order.itemsTotal > 0 ? (order.freightAmount + order.otherCosts - order.discountAmount) * value / order.itemsTotal : 0

  async function receive() {
    if (!header.invoiceNumber.trim()) return toast({ title: "Informe a NF", description: "O número da nota fiscal é obrigatório.", variant: "destructive" })
    for (const item of order!.items) {
      const line = lines[item.id]
      const quantity = num(line?.quantity || 0)
      if (quantity < 0 || quantity > item.quantity - item.receivedQuantity + 0.0005) return toast({ title: "Quantidade inválida", description: `${item.description}: pendente ${qty(item.quantity - item.receivedQuantity)}.`, variant: "destructive" })
      const material = materials.find((row) => row.id === item.materialId)
      if (quantity > 0 && material?.controlsLot && !line.lotNumber.trim()) return toast({ title: "Lote obrigatório", description: item.description, variant: "destructive" })
      if (quantity > 0 && material?.controlsSerial && !line.serialNumber.trim()) return toast({ title: "Número de série obrigatório", description: item.description, variant: "destructive" })
      if (quantity > 0 && material?.controlsExpiry && !line.expiryDate) return toast({ title: "Validade obrigatória", description: item.description, variant: "destructive" })
    }
    if (value <= 0) return toast({ title: "Nada a receber", description: "Informe a quantidade recebida de ao menos um item.", variant: "destructive" })
    setSaving(true)
    try {
      const payload = await api<{ result: { total_amount: number; payables: number } }>(`/api/compras/orders/${order!.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ ...header, lines: order!.items.map((item) => ({ orderItemId: item.id, quantity: num(lines[item.id]?.quantity || 0), lotNumber: lines[item.id]?.lotNumber, serialNumber: lines[item.id]?.serialNumber, expiryDate: lines[item.id]?.expiryDate })) }),
      })
      toast({ title: "Recebimento registrado", description: `${brl(payload.result.total_amount)} em estoque · ${payload.result.payables} conta(s) a pagar gerada(s).` })
      onOpenChange(false)
      onReceived()
    } catch (reason) {
      toast({ title: "Recebimento não registrado", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet open onOpenChange={onOpenChange} title={`Receber pedido ${order.orderNumber}`} description={`${order.supplierName} · depósito ${warehouses.find((item) => item.id === order.warehouseId)?.name || "padrão de cada item"}`}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Número da NF" value={header.invoiceNumber} onChange={(value) => setHeader({ ...header, invoiceNumber: value })} />
        <TextField label="Data de emissão da NF" type="date" value={header.invoiceDate} onChange={(value) => setHeader({ ...header, invoiceDate: value })} />
        <TextField label="Data do recebimento" type="date" value={header.receivedAt} onChange={(value) => setHeader({ ...header, receivedAt: value })} />
        <TextField label="1º vencimento (opcional)" type="date" value={header.firstDueDate} onChange={(value) => setHeader({ ...header, firstDueDate: value })} />
      </div>
      <div className="space-y-3">
        {order.items.map((item) => {
          const pending = Math.max(item.quantity - item.receivedQuantity, 0)
          const material = materials.find((row) => row.id === item.materialId)
          const line = lines[item.id] || { quantity: "0", lotNumber: "", serialNumber: "", expiryDate: "" }
          const update = (patch: Partial<typeof line>) => setLines((current) => ({ ...current, [item.id]: { ...line, ...patch } }))
          return <div key={item.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-4 md:items-end">
            <div className="md:col-span-2"><p className="text-sm font-medium">{item.description}</p><p className="text-xs text-muted-foreground">Pedido {qty(item.quantity)} · recebido {qty(item.receivedQuantity)} · pendente {qty(pending)} {item.unit} · {brl(item.unitCost)}</p></div>
            <div className="space-y-2"><Label>Recebendo agora</Label><Input type="number" min="0" max={pending} value={line.quantity} disabled={!pending} onChange={(event) => update({ quantity: event.target.value })} /></div>
            <div />
            {material?.controlsLot ? <TextField label="Lote" value={line.lotNumber} onChange={(value) => update({ lotNumber: value })} /> : null}
            {material?.controlsSerial ? <TextField label="Número de série" value={line.serialNumber} onChange={(value) => update({ serialNumber: value })} /> : null}
            {material?.controlsExpiry ? <TextField label="Validade" type="date" value={line.expiryDate} onChange={(value) => update({ expiryDate: value })} /> : null}
          </div>
        })}
      </div>
      <div className="rounded-md border bg-muted/20 p-3 text-sm">
        <p>Itens recebidos: <b>{brl(value)}</b> · frete/outros/desconto rateados: <b>{brl(extra)}</b> · total: <b>{brl(value + extra)}</b></p>
        <p className="text-muted-foreground">Contas a pagar: {condition ? `${condition.name} (${condition.installments}x)` : "à vista, vencendo no recebimento"}{header.firstDueDate ? `, 1º vencimento em ${day(header.firstDueDate)}` : ""}.</p>
      </div>
      <div className="flex items-center gap-3 rounded-md border px-3 py-2"><Checkbox checked={header.generatePayables} onCheckedChange={(checked) => setHeader({ ...header, generatePayables: checked === true })} /><Label>Gerar contas a pagar deste recebimento</Label></div>
      <TextAreaField label="Observações" value={header.notes} onChange={(value) => setHeader({ ...header, notes: value })} />
      <SaveButton disabled={saving} onClick={receive}>{saving ? "Registrando..." : "Confirmar recebimento"}</SaveButton>
    </FormSheet>
  )
}
