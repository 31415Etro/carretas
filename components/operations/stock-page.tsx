"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MaterialFormFields, emptyMaterialForm, materialFormFromItem, materialRecordFromForm, validateMaterialForm } from "@/components/catalog/product-form"
import { DataTable, FormSheet, PageShell, SaveButton, SectionCard, StatusBadge, useCrudFeedback } from "./shared"
import { InventoryTab, MovementSheet, MovementsTab, PurchaseSuggestionTab, ReservationsTab, StockAlertBanner, WarehousesTab, materialAvailable, needsReplenishment, useWarehouses } from "./stock-erp"
import type { Material, Supplier } from "@/lib/operational-storage"

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

export function StockPage() {
  const { toast } = useCrudFeedback()
  const { warehouses, error: warehousesError, reload: reloadWarehouses } = useWarehouses()
  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [tab, setTab] = useState("itens")
  const [query, setQuery] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [movementSheet, setMovementSheet] = useState<{ open: boolean; preset?: Record<string, string> }>({ open: false })
  const [editing, setEditing] = useState<{ open: boolean; existing?: Material }>({ open: false })
  const [form, setForm] = useState<Record<string, any>>(emptyMaterialForm)
  const [saving, setSaving] = useState(false)
  const warehouseName = (id?: string) => warehouses.find((item) => item.id === id)?.name || warehouses.find((item) => item.isDefault)?.name || "-"

  const refresh = useCallback(async () => {
    try {
      const payload = await api<{ materials: Material[] }>("/api/estoque/materials")
      setMaterials(payload.materials)
    } catch (error) {
      toast({ title: "Erro ao carregar o estoque", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    }
  }, [toast])

  useEffect(() => {
    void refresh()
    api<{ suppliers: Supplier[] }>("/api/suppliers").then((payload) => setSuppliers(payload.suppliers)).catch(() => undefined)
  }, [refresh])

  function changed() {
    setRefreshKey((current) => current + 1)
    void refresh()
  }

  function edit(item: Material) {
    setForm({ ...materialFormFromItem(item), id: item.id })
    setEditing({ open: true, existing: item })
  }

  async function save() {
    const existing = editing.existing
    const invalid = validateMaterialForm(form, materials, existing?.id)
    if (invalid) return toast({ title: "Revise o cadastro", description: invalid, variant: "destructive" })
    setSaving(true)
    try {
      const record = materialRecordFromForm(form, existing, existing!.id)
      await api("/api/estoque/materials", { method: "POST", body: JSON.stringify({ material: record }) })
      toast({ title: "Item atualizado", description: record.name })
      setEditing({ open: false })
      changed()
    } catch (error) {
      toast({ title: "Item não salvo", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const visible = materials.filter((item) => [item.name, item.internalCode, item.category, item.location].join(" ").toLowerCase().includes(query.toLowerCase()))

  return (
    <PageShell
      title="Estoque"
      description="Saldos por depósito, movimentações, reservas para OS, inventário e sugestão de compra."
      actions={<>
        <Button onClick={() => setMovementSheet({ open: true })}><Plus className="h-4 w-4" />Nova movimentação</Button>
        <Button variant="secondary" asChild><Link href="/servicos">Novo item (Produtos / Serviços)</Link></Button>
      </>}
    >
      {warehousesError ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{warehousesError}</p> : null}
      <StockAlertBanner materials={materials} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="itens">Itens e saldos</TabsTrigger>
          <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          <TabsTrigger value="reservas">Reservas</TabsTrigger>
          <TabsTrigger value="inventario">Inventário</TabsTrigger>
          <TabsTrigger value="compras">Sugestão de compra</TabsTrigger>
          <TabsTrigger value="depositos">Depósitos</TabsTrigger>
        </TabsList>
        <TabsContent value="itens" className="mt-4">
          <SectionCard title="Itens de estoque" description="Saldo físico, reservado e disponível por item. O saldo muda somente por movimentação.">
            <div className="mb-3"><Input className="max-w-sm" placeholder="Buscar por nome, SKU, categoria ou localização" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <DataTable headers={["SKU", "Item", "Categoria", "Un.", "Depósito", "Localização", "Físico", "Reservado", "Disponível", "Mín. / Máx.", "Ponto rep.", "Custo médio", "Último custo", "Status", "Ações"]} empty={!visible.length} stickyHeader viewportClassName="max-h-[35rem] overflow-auto overscroll-contain" tableClassName="min-w-[1320px]">
              {visible.map((item) => <TableRow key={item.id} className={needsReplenishment(item) ? "bg-amber-500/10" : undefined}>
                <TableCell className="font-mono">{item.internalCode || "-"}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.category || "-"}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell>{warehouseName(item.warehouseId)}</TableCell>
                <TableCell>{item.location || "-"}</TableCell>
                <TableCell>{item.currentStock ?? 0}</TableCell>
                <TableCell>{item.reservedStock || 0}</TableCell>
                <TableCell className={materialAvailable(item) < 0 ? "font-semibold text-destructive" : "font-semibold"}>{materialAvailable(item)}</TableCell>
                <TableCell>{item.minimumStock} / {item.maximumStock || "-"}</TableCell>
                <TableCell>{item.reorderPoint || "-"}</TableCell>
                <TableCell>{brl(item.averageCost || 0)}</TableCell>
                <TableCell>{brl(item.lastPurchaseCost || 0)}</TableCell>
                <TableCell><StatusBadge status={item.status} /></TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => edit(item)}>Editar</Button>
                  <Button size="sm" variant="outline" onClick={() => setMovementSheet({ open: true, preset: { materialId: item.id } })}>Movimentar</Button>
                </TableCell>
              </TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="movimentacoes" className="mt-4"><MovementsTab materials={materials} warehouses={warehouses} refreshKey={refreshKey} onChanged={changed} /></TabsContent>
        <TabsContent value="reservas" className="mt-4"><ReservationsTab materials={materials} warehouses={warehouses} refreshKey={refreshKey} onChanged={changed} /></TabsContent>
        <TabsContent value="inventario" className="mt-4"><InventoryTab materials={materials} warehouses={warehouses} onChanged={changed} /></TabsContent>
        <TabsContent value="compras" className="mt-4"><PurchaseSuggestionTab materials={materials} suppliers={suppliers} /></TabsContent>
        <TabsContent value="depositos" className="mt-4"><WarehousesTab warehouses={warehouses} reload={reloadWarehouses} /></TabsContent>
      </Tabs>

      <MovementSheet open={movementSheet.open} onOpenChange={(open) => setMovementSheet((current) => ({ ...current, open }))} materials={materials} warehouses={warehouses} preset={movementSheet.preset} onSaved={changed} />
      <FormSheet open={editing.open} onOpenChange={(open) => !open && setEditing({ open: false })} title={editing.existing ? `Item — ${editing.existing.name}` : "Item"}>
        <MaterialFormFields material={form} setMaterial={setForm} suppliers={suppliers} existing={editing.existing} showStatus />
        <SaveButton disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar"}</SaveButton>
      </FormSheet>
    </PageShell>
  )
}
