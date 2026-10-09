"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Pencil, Plus, RefreshCw, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "./shared"
import type { Material, Supplier } from "@/lib/operational-storage"
import { materialAvailable, needsReplenishment, suggestedPurchaseQuantity } from "@/lib/stock-rules"

export { materialAvailable, needsReplenishment }

export type Warehouse = { id: string; code: string; name: string; address: string; responsible: string; isDefault: boolean; status: string; notes: string }
export type StockMovement = {
  id: string; materialId: string; materialName: string; materialCode: string; unit: string; movementType: string; quantity: number
  fromWarehouseId: string; toWarehouseId: string; unitCost: number; totalCost: number; balanceAfter: number | null; occurredAt: string
  responsible: string; documentReference: string; reason: string; notes: string; serviceOrderId: string; lotNumber: string; serialNumber: string; expiryDate: string
}
type Reservation = { id: string; materialId: string; materialName: string; unit: string; warehouseId: string; serviceOrderId: string; orderNumber: string; quantity: number; status: string; responsible: string; notes: string; createdAt: string }

// Tipos que o usuário lança manualmente ("Consumo em OS" e "Consumo em kit" também são automáticos).
export const manualMovementTypes = ["Entrada por compra", "Saida por venda", "Consumo em OS", "Transferencia", "Devolucao", "Ajuste de inventario", "Perda"] as const
const movementLabels: Record<string, string> = {
  "Entrada por compra": "Entrada por compra", "Saida por venda": "Saída por venda", "Consumo em OS": "Consumo em OS", "Consumo em kit": "Consumo em kit",
  Transferencia: "Transferência", Devolucao: "Devolução", "Ajuste de inventario": "Ajuste de inventário", Perda: "Perda", "Saldo inicial": "Saldo inicial",
}
const incomingTypes = new Set(["Entrada por compra", "Devolucao", "Saldo inicial"])
const outgoingTypes = new Set(["Saida por venda", "Consumo em OS", "Consumo em kit", "Perda"])

const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dateTime = (value: string) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

/** Depósitos cadastrados (lista compartilhada pelas telas de estoque e pelo cadastro do item). */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [error, setError] = useState("")
  const reload = useCallback(() => api<{ warehouses: Warehouse[] }>("/api/estoque/warehouses")
    .then((payload) => { setWarehouses(payload.warehouses); setError("") })
    .catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar depósitos.")), [])
  useEffect(() => { void reload() }, [reload])
  return { warehouses, error, reload }
}

export function StockAlertBanner({ materials }: { materials: Material[] }) {
  const low = materials.filter(needsReplenishment)
  if (!low.length) return null
  return (
    <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />{low.length} item(ns) no ponto de reposição ou abaixo do estoque mínimo</div>
      <p className="mt-1">{low.slice(0, 8).map((item) => `${item.name} (disp. ${qty(materialAvailable(item))} ${item.unit})`).join(" · ")}{low.length > 8 ? ` · +${low.length - 8}` : ""}</p>
    </div>
  )
}

const emptyMovement = { materialId: "", movementType: "Entrada por compra", quantity: "", fromWarehouseId: "", toWarehouseId: "", unitCost: "", documentReference: "", reason: "", notes: "", lotNumber: "", serialNumber: "", expiryDate: "", occurredAt: "" }

export function MovementSheet({ open, onOpenChange, materials, warehouses, preset, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; materials: Material[]; warehouses: Warehouse[]; preset?: Partial<typeof emptyMovement>; onSaved: () => void }) {
  const { requireFields, toast } = useCrudFeedback()
  const [form, setForm] = useState(emptyMovement)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm({ ...emptyMovement, ...(preset || {}) }) }, [open, preset])
  const material = materials.find((item) => item.id === form.materialId)
  const type = form.movementType
  const needsFrom = outgoingTypes.has(type) || type === "Transferencia" || (type === "Ajuste de inventario" && !form.toWarehouseId)
  const needsTo = incomingTypes.has(type) || type === "Transferencia" || (type === "Ajuste de inventario" && !form.fromWarehouseId)
  const isIncoming = incomingTypes.has(type) || (type === "Ajuste de inventario" && Boolean(form.toWarehouseId))
  const warehouseOptions = [{ value: "nenhum", label: "Depósito padrão do item" }, ...warehouses.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]

  async function save() {
    if (!requireFields([["Item", form.materialId], ["Tipo", form.movementType], ["Quantidade", form.quantity]])) return
    if (type === "Transferencia" && (!form.fromWarehouseId || !form.toWarehouseId)) {
      toast({ title: "Informe os depósitos", description: "Transferência exige origem e destino.", variant: "destructive" })
      return
    }
    if (type === "Ajuste de inventario" && Boolean(form.fromWarehouseId) === Boolean(form.toWarehouseId)) {
      toast({ title: "Ajuste de inventário", description: "Informe só o depósito de origem (baixa) ou só o de destino (acréscimo).", variant: "destructive" })
      return
    }
    if (["Perda", "Ajuste de inventario"].includes(type) && !form.reason.trim()) {
      toast({ title: "Informe o motivo", description: "Perdas e ajustes exigem motivo.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      await api("/api/estoque/movements", {
        method: "POST",
        body: JSON.stringify({ movement: { ...form, quantity: Number(String(form.quantity).replace(",", ".")), unitCost: form.unitCost === "" ? null : Number(String(form.unitCost).replace(",", ".")), occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : "" } }),
      })
      toast({ title: "Movimentação registrada", description: `${movementLabels[type]} de ${form.quantity} ${material?.unit || ""} - ${material?.name || ""}` })
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast({ title: "Movimentação não registrada", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nova movimentação de estoque">
      <div className="grid gap-4 md:grid-cols-2">
        <SearchableSelectField label="Item" value={form.materialId || "nenhum"} onChange={(value) => setForm({ ...form, materialId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione o item" }, ...materials.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.internalCode ? `${item.internalCode} - ` : ""}${item.name}` }))]} />
        <SelectField label="Tipo de movimentação" value={form.movementType} onChange={(value) => setForm({ ...form, movementType: value, fromWarehouseId: "", toWarehouseId: "" })} options={manualMovementTypes.map((value) => ({ value, label: movementLabels[value] }))} />
        <TextField label={`Quantidade${material ? ` (${material.unit})` : ""}`} type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
        <TextField label="Data e hora" type="datetime-local" value={form.occurredAt} onChange={(value) => setForm({ ...form, occurredAt: value })} />
        {needsFrom ? <SelectField label="Depósito de origem" value={form.fromWarehouseId || "nenhum"} onChange={(value) => setForm({ ...form, fromWarehouseId: value === "nenhum" ? "" : value })} options={type === "Transferencia" || type === "Ajuste de inventario" ? warehouseOptions.slice(1) : warehouseOptions} /> : null}
        {needsTo ? <SelectField label="Depósito de destino" value={form.toWarehouseId || "nenhum"} onChange={(value) => setForm({ ...form, toWarehouseId: value === "nenhum" ? "" : value })} options={type === "Transferencia" || type === "Ajuste de inventario" ? warehouseOptions.slice(1) : warehouseOptions} /> : null}
        {type === "Entrada por compra" || type === "Devolucao" ? <TextField label="Custo unitário (R$)" type="number" value={form.unitCost} onChange={(value) => setForm({ ...form, unitCost: value })} /> : null}
        <TextField label="Documento de referência" value={form.documentReference} onChange={(value) => setForm({ ...form, documentReference: value })} placeholder="NF, pedido, OS, venda..." />
        <TextField label="Motivo" value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} />
        {material?.controlsLot || form.lotNumber ? <TextField label={`Número do lote${material?.controlsLot && isIncoming ? " (obrigatório)" : ""}`} value={form.lotNumber} onChange={(value) => setForm({ ...form, lotNumber: value })} /> : null}
        {material?.controlsSerial || form.serialNumber ? <TextField label={`Número de série${material?.controlsSerial ? " (obrigatório)" : ""}`} value={form.serialNumber} onChange={(value) => setForm({ ...form, serialNumber: value })} /> : null}
        {material?.controlsExpiry || form.expiryDate ? <TextField label={`Data de validade${material?.controlsExpiry && isIncoming ? " (obrigatória)" : ""}`} type="date" value={form.expiryDate} onChange={(value) => setForm({ ...form, expiryDate: value })} /> : null}
      </div>
      {material ? <p className="text-sm text-muted-foreground">Saldo físico {qty(Number(material.currentStock || 0))} · reservado {qty(Number(material.reservedStock || 0))} · disponível {qty(materialAvailable(material))} {material.unit} · custo médio {brl(Number(material.averageCost || 0))}</p> : null}
      <TextAreaField label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
      <SaveButton disabled={saving} onClick={save}>{saving ? "Registrando..." : "Registrar movimentação"}</SaveButton>
    </FormSheet>
  )
}

export function MovementsTab({ materials, warehouses, refreshKey, onChanged }: { materials: Material[]; warehouses: Warehouse[]; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<StockMovement[]>([])
  const [count, setCount] = useState(0)
  const [filters, setFilters] = useState({ materialId: "", type: "", warehouseId: "", from: "", to: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const warehouseName = (id: string) => warehouses.find((item) => item.id === id)?.name || "-"

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50", offset: String(offset) })
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const payload = await api<{ movements: StockMovement[]; count: number }>(`/api/estoque/movements?${params}`)
      setRows((current) => offset ? [...current, ...payload.movements] : payload.movements)
      setCount(payload.count)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar movimentações.")
    } finally {
      setLoading(false)
    }
  }, [filters])
  useEffect(() => { void load() }, [load, refreshKey])

  return (
    <SectionCard title="Histórico de movimentações" description="Toda alteração de saldo fica registrada aqui: entradas, saídas, consumo em OS, transferências, devoluções, ajustes e perdas.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nova movimentação</Button>
        <div className="min-w-[220px]"><SearchableSelectField label="Item" value={filters.materialId || "todos"} onChange={(value) => setFilters({ ...filters, materialId: value === "todos" ? "" : value })} options={[{ value: "todos", label: "Todos os itens" }, ...materials.map((item) => ({ value: item.id, label: item.name }))]} /></div>
        <div className="min-w-[200px]"><SelectField label="Tipo" value={filters.type || "todos"} onChange={(value) => setFilters({ ...filters, type: value === "todos" ? "" : value })} options={[{ value: "todos", label: "Todos os tipos" }, ...Object.entries(movementLabels).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="min-w-[180px]"><SelectField label="Depósito" value={filters.warehouseId || "todos"} onChange={(value) => setFilters({ ...filters, warehouseId: value === "todos" ? "" : value })} options={[{ value: "todos", label: "Todos" }, ...warehouses.map((item) => ({ value: item.id, label: item.name }))]} /></div>
        <div className="space-y-2"><Label>De</Label><Input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></div>
        <div className="space-y-2"><Label>Até</Label><Input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>
      {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <DataTable headers={["Data/hora", "Item", "Tipo", "Quantidade", "Origem", "Destino", "Custo unit.", "Custo total", "Saldo após", "Documento", "Lote / Série / Validade", "Responsável", "Motivo"]} empty={!rows.length} stickyHeader viewportClassName="max-h-[35rem] overflow-auto overscroll-contain" tableClassName="min-w-[1700px]">
        {rows.map((row) => {
          const sign = incomingTypes.has(row.movementType) || (row.movementType === "Ajuste de inventario" && row.toWarehouseId) ? "+" : row.movementType === "Transferencia" ? "" : "-"
          return <TableRow key={row.id}><TableCell>{dateTime(row.occurredAt)}</TableCell><TableCell>{row.materialCode ? `${row.materialCode} - ` : ""}{row.materialName}</TableCell><TableCell>{movementLabels[row.movementType] || row.movementType}</TableCell><TableCell className={sign === "+" ? "text-emerald-600" : sign === "-" ? "text-destructive" : ""}>{sign}{qty(row.quantity)} {row.unit}</TableCell><TableCell>{row.fromWarehouseId ? warehouseName(row.fromWarehouseId) : "-"}</TableCell><TableCell>{row.toWarehouseId ? warehouseName(row.toWarehouseId) : "-"}</TableCell><TableCell>{brl(row.unitCost)}</TableCell><TableCell>{brl(row.totalCost)}</TableCell><TableCell>{row.balanceAfter === null ? "-" : qty(row.balanceAfter)}</TableCell><TableCell>{row.documentReference || "-"}</TableCell><TableCell>{[row.lotNumber, row.serialNumber, row.expiryDate ? row.expiryDate.split("-").reverse().join("/") : ""].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell>{row.responsible || "-"}</TableCell><TableCell>{row.reason || "-"}</TableCell></TableRow>
        })}
      </DataTable>
      {rows.length < count ? <div className="mt-4 flex justify-center"><Button variant="outline" disabled={loading} onClick={() => void load(rows.length)}>Carregar mais ({count - rows.length})</Button></div> : null}
      <MovementSheet open={open} onOpenChange={setOpen} materials={materials} warehouses={warehouses} onSaved={() => { void load(); onChanged() }} />
    </SectionCard>
  )
}

export function ReservationsTab({ materials, warehouses, refreshKey, onChanged }: { materials: Material[]; warehouses: Warehouse[]; refreshKey: number; onChanged: () => void }) {
  const { requireFields, toast } = useCrudFeedback()
  const [rows, setRows] = useState<Reservation[]>([])
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ materialId: "", warehouseId: "", quantity: "", notes: "" })
  const load = useCallback(() => api<{ reservations: Reservation[] }>("/api/estoque/reservations?status=Ativa")
    .then((payload) => { setRows(payload.reservations); setError("") })
    .catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar reservas.")), [])
  useEffect(() => { void load() }, [load, refreshKey])

  async function reserve() {
    if (!requireFields([["Item", form.materialId], ["Quantidade", form.quantity]])) return
    try {
      await api("/api/estoque/reservations", { method: "POST", body: JSON.stringify({ action: "reserve", ...form, quantity: Number(form.quantity) }) })
      setOpen(false)
      setForm({ materialId: "", warehouseId: "", quantity: "", notes: "" })
      void load()
      onChanged()
    } catch (reason) {
      toast({ title: "Reserva não registrada", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  async function cancel(id: string) {
    if (!window.confirm("Liberar esta reserva?")) return
    try {
      await api("/api/estoque/reservations", { method: "POST", body: JSON.stringify({ action: "cancel", id }) })
      void load()
      onChanged()
    } catch (reason) {
      toast({ title: "Não foi possível liberar", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  return (
    <SectionCard title="Reservas de peças" description="As OS reservam automaticamente os materiais previstos; a reserva vira baixa quando a OS é finalizada e é liberada se a OS for cancelada.">
      <Button className="mb-3" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Reserva manual</Button>
      {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <DataTable headers={["Data", "Item", "Quantidade", "OS", "Depósito", "Responsável", "Observações", "Ações"]} empty={!rows.length}>
        {rows.map((row) => <TableRow key={row.id}><TableCell>{dateTime(row.createdAt)}</TableCell><TableCell>{row.materialName}</TableCell><TableCell>{qty(row.quantity)} {row.unit}</TableCell><TableCell>{row.orderNumber || "-"}</TableCell><TableCell>{warehouses.find((item) => item.id === row.warehouseId)?.name || "Padrão do item"}</TableCell><TableCell>{row.responsible || "-"}</TableCell><TableCell>{row.notes || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void cancel(row.id)}>Liberar</Button></TableCell></TableRow>)}
      </DataTable>
      <FormSheet open={open} onOpenChange={setOpen} title="Reserva manual de peças">
        <div className="grid gap-4 md:grid-cols-2">
          <SearchableSelectField label="Item" value={form.materialId || "nenhum"} onChange={(value) => setForm({ ...form, materialId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...materials.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.name} (disp. ${qty(materialAvailable(item))})` }))]} />
          <TextField label="Quantidade" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
          <SelectField label="Depósito" value={form.warehouseId || "nenhum"} onChange={(value) => setForm({ ...form, warehouseId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Padrão do item" }, ...warehouses.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} />
        </div>
        <TextAreaField label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        <SaveButton onClick={reserve}>Reservar</SaveButton>
      </FormSheet>
    </SectionCard>
  )
}

export function InventoryTab({ materials, warehouses, onChanged }: { materials: Material[]; warehouses: Warehouse[]; onChanged: () => void }) {
  const { toast } = useCrudFeedback()
  const [warehouseId, setWarehouseId] = useState("")
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [reference, setReference] = useState("")
  const [query, setQuery] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!warehouseId) return
    setCounts({})
    api<{ balances: Array<{ materialId: string; quantity: number }> }>(`/api/estoque/balances?warehouseId=${warehouseId}`)
      .then((payload) => setBalances(Object.fromEntries(payload.balances.map((row) => [row.materialId, row.quantity]))))
      .catch((reason) => toast({ title: "Erro ao carregar saldos", description: reason instanceof Error ? reason.message : "", variant: "destructive" }))
  }, [warehouseId])

  const visible = useMemo(() => materials.filter((item) => item.status === "Ativo" && [item.name, item.internalCode, item.location].join(" ").toLowerCase().includes(query.toLowerCase())), [materials, query])
  const counted = Object.entries(counts).filter(([, value]) => value !== "")
  const differences = counted.filter(([materialId, value]) => Number(value) !== (balances[materialId] || 0))

  async function close() {
    if (!counted.length) return
    if (!window.confirm(`Fechar o inventário? ${differences.length} item(ns) com diferença receberão ajuste de inventário.`)) return
    setSaving(true)
    try {
      const payload = await api<{ adjustments: unknown[] }>("/api/estoque/inventory", { method: "POST", body: JSON.stringify({ warehouseId, reference, counts: counted.map(([materialId, value]) => ({ materialId, counted: Number(value) })) }) })
      toast({ title: "Inventário fechado", description: `${payload.adjustments.length} ajuste(s) lançado(s).` })
      setCounts({})
      setWarehouseId("")
      onChanged()
    } catch (reason) {
      toast({ title: "Inventário não fechado", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="Inventário" description="Escolha o depósito, informe a quantidade contada de cada item e feche o inventário: o sistema lança ajuste só das diferenças.">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <SelectField label="Depósito" value={warehouseId || "nenhum"} onChange={(value) => setWarehouseId(value === "nenhum" ? "" : value)} options={[{ value: "nenhum", label: "Selecione" }, ...warehouses.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} />
        <TextField label="Referência da contagem" value={reference} onChange={setReference} placeholder="Ex.: Inventário mensal outubro" />
        <TextField label="Buscar item" value={query} onChange={setQuery} />
      </div>
      {warehouseId ? <>
        <DataTable headers={["SKU", "Item", "Localização", "Saldo no sistema", "Quantidade contada", "Diferença"]} empty={!visible.length} stickyHeader viewportClassName="max-h-[35rem] overflow-auto overscroll-contain">
          {visible.map((item) => {
            const system = balances[item.id] || 0
            const value = counts[item.id] ?? ""
            const difference = value === "" ? null : Number(value) - system
            return <TableRow key={item.id}><TableCell className="font-mono">{item.internalCode || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.location || "-"}</TableCell><TableCell>{qty(system)} {item.unit}</TableCell><TableCell><Input className="w-32" type="number" min="0" value={value} onChange={(event) => setCounts({ ...counts, [item.id]: event.target.value })} /></TableCell><TableCell className={difference ? difference > 0 ? "text-emerald-600" : "text-destructive" : ""}>{difference === null ? "-" : `${difference > 0 ? "+" : ""}${qty(difference)}`}</TableCell></TableRow>
          })}
        </DataTable>
        <div className="mt-4 flex items-center gap-3"><SaveButton disabled={saving || !counted.length} onClick={close}>{saving ? "Fechando..." : `Fechar inventário (${counted.length} contado(s), ${differences.length} diferença(s))`}</SaveButton></div>
      </> : <p className="text-sm text-muted-foreground">Selecione um depósito para iniciar a contagem.</p>}
    </SectionCard>
  )
}

export function PurchaseSuggestionTab({ materials, suppliers }: { materials: Material[]; suppliers: Supplier[] }) {
  const rows = materials.filter(needsReplenishment).map((item) => ({ item, quantity: suggestedPurchaseQuantity(item) })).filter((row) => row.quantity > 0)
  const supplierName = (id?: string) => suppliers.find((item) => item.id === id)?.name || "-"
  const total = rows.reduce((sum, row) => sum + row.quantity * Number(row.item.lastPurchaseCost || row.item.averageCost || row.item.costPrice || 0), 0)
  function exportCsv() {
    const header = ["SKU", "Item", "Unidade", "Disponivel", "Ponto de reposicao", "Estoque minimo", "Estoque maximo", "Sugestao de compra", "Ultimo custo", "Fornecedor", "Codigo no fornecedor"]
    const lines = rows.map(({ item, quantity }) => [item.internalCode, item.name, item.unit, materialAvailable(item), item.reorderPoint || 0, item.minimumStock, item.maximumStock || 0, quantity, item.lastPurchaseCost || item.averageCost || item.costPrice || 0, supplierName(item.supplierId), item.supplierCode || ""])
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n")
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `sugestao-compra-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <SectionCard title="Sugestão de compra" description="Itens com disponível (físico - reservado) no ponto de reposição ou abaixo do mínimo. A quantidade sugerida repõe até o estoque máximo.">
      <div className="mb-3 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!rows.length} onClick={exportCsv}><ShoppingCart className="h-4 w-4" />Exportar lista (CSV)</Button><span className="text-sm text-muted-foreground">{rows.length} item(ns) · estimativa {brl(total)}</span></div>
      <DataTable headers={["SKU", "Item", "Disponível", "Ponto de reposição", "Mínimo", "Máximo", "Comprar", "Último custo", "Estimativa", "Fornecedor preferencial"]} empty={!rows.length}>
        {rows.map(({ item, quantity }) => {
          const cost = Number(item.lastPurchaseCost || item.averageCost || item.costPrice || 0)
          return <TableRow key={item.id}><TableCell className="font-mono">{item.internalCode || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell className="text-destructive">{qty(materialAvailable(item))} {item.unit}</TableCell><TableCell>{qty(Number(item.reorderPoint || 0))}</TableCell><TableCell>{qty(item.minimumStock)}</TableCell><TableCell>{item.maximumStock ? qty(item.maximumStock) : "-"}</TableCell><TableCell className="font-semibold">{qty(quantity)} {item.unit}</TableCell><TableCell>{brl(cost)}</TableCell><TableCell>{brl(cost * quantity)}</TableCell><TableCell>{supplierName(item.supplierId)}{item.supplierCode ? ` (${item.supplierCode})` : ""}</TableCell></TableRow>
        })}
      </DataTable>
    </SectionCard>
  )
}

const emptyWarehouse = { id: "", code: "", name: "", address: "", responsible: "", status: "Ativo", notes: "" }

export function WarehousesTab({ warehouses, reload }: { warehouses: Warehouse[]; reload: () => void }) {
  const { requireFields, toast } = useCrudFeedback()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyWarehouse)
  async function save() {
    if (!requireFields([["Nome", form.name]])) return
    try {
      await api("/api/estoque/warehouses", { method: "POST", body: JSON.stringify({ warehouse: form }) })
      setOpen(false)
      reload()
    } catch (reason) {
      toast({ title: "Depósito não salvo", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }
  return (
    <SectionCard title="Depósitos / almoxarifados">
      <Button className="mb-3" onClick={() => { setForm(emptyWarehouse); setOpen(true) }}><Plus className="h-4 w-4" />Novo depósito</Button>
      <DataTable headers={["Código", "Nome", "Endereço", "Responsável", "Padrão", "Status", "Ações"]} empty={!warehouses.length}>
        {warehouses.map((item) => <TableRow key={item.id}><TableCell className="font-mono">{item.code || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.address || "-"}</TableCell><TableCell>{item.responsible || "-"}</TableCell><TableCell>{item.isDefault ? "Sim" : "-"}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { setForm({ ...emptyWarehouse, ...item }); setOpen(true) }}><Pencil className="h-4 w-4" />Editar</Button></TableCell></TableRow>)}
      </DataTable>
      <FormSheet open={open} onOpenChange={setOpen} title={form.id ? "Editar depósito" : "Novo depósito"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Código" value={form.code} onChange={(value) => setForm({ ...form, code: value })} />
          <TextField label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <TextField label="Endereço" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
          <TextField label="Responsável" value={form.responsible} onChange={(value) => setForm({ ...form, responsible: value })} />
          <SelectField label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observações" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
        <SaveButton onClick={save}>Salvar depósito</SaveButton>
      </FormSheet>
    </SectionCard>
  )
}

