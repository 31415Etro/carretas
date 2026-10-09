"use client"

import { useCallback, useEffect, useState } from "react"
import { Factory, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, SaveButton, SearchableSelectField, SelectField, StatusBadge, TextAreaField, TextField } from "@/components/operations/shared"
import { useWarehouses } from "@/components/operations/stock-erp"
import { useToast } from "@/hooks/use-toast"
import { compositionCost, quantityWithLoss, validateComposition } from "@/lib/compositions"
import type { Material } from "@/lib/operational-storage"

type VersionItem = { componentId: string; name: string; code: string; unit: string; quantity: number; lossPercent: number; unitCost: number }
type Version = { id: string; version: number; status: string; laborCost: number; assemblyMinutes: number; notes: string; createdBy: string; createdAt: string; items: VersionItem[] }
type Production = { id: string; quantity: number; materialsCost: number; laborCost: number; unitCost: number; documentReference: string; responsible: string; createdAt: string }
type Row = { key: string; componentId: string; quantity: string; unit: string; lossPercent: string }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const num = (value: string | number) => Number(String(value ?? "").replace(",", ".")) || 0
const newKey = () => Math.random().toString(36).slice(2)

/** Composição versionada do produto (lista de materiais) e montagem/fabricação. */
export function CompositionSheet({ product, materials, onOpenChange, onChanged }: { product: Material | null; materials: Material[]; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { toast } = useToast()
  const { warehouses } = useWarehouses()
  const [versions, setVersions] = useState<Version[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [error, setError] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [labor, setLabor] = useState({ laborCost: "0", assemblyMinutes: "0", notes: "" })
  const [saving, setSaving] = useState(false)
  const [produce, setProduce] = useState({ quantity: "1", fromWarehouseId: "", toWarehouseId: "", lotNumber: "", serialNumber: "", notes: "" })
  const [producing, setProducing] = useState(false)

  const load = useCallback(async () => {
    if (!product) return
    try {
      const response = await fetch(`/api/catalog/compositions?productId=${product.id}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setVersions(payload.versions)
      setProductions(payload.productions)
      const active = (payload.versions as Version[]).find((item) => item.status === "Ativa")
      setRows(active ? active.items.map((item) => ({ key: newKey(), componentId: item.componentId, quantity: String(item.quantity), unit: item.unit, lossPercent: String(item.lossPercent) })) : [])
      setLabor(active ? { laborCost: String(active.laborCost), assemblyMinutes: String(active.assemblyMinutes), notes: active.notes } : { laborCost: "0", assemblyMinutes: "0", notes: "" })
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar composição.")
    }
  }, [product])

  useEffect(() => { void load() }, [load])
  if (!product) return null

  const active = versions.find((item) => item.status === "Ativa")
  // Componentes ativos, mais os já usados na composição (mesmo que inativados depois).
  const components = materials.filter((item) => item.id !== product.id && (item.status === "Ativo" || rows.some((row) => row.componentId === item.id)))
  const items = rows.map((row) => ({ componentId: row.componentId, quantity: num(row.quantity), unit: row.unit, lossPercent: num(row.lossPercent), unitCost: Number(materials.find((item) => item.id === row.componentId)?.averageCost || materials.find((item) => item.id === row.componentId)?.costPrice || 0) }))
  const cost = compositionCost(items, num(labor.laborCost))
  const changed = !active || JSON.stringify(active.items.map((item) => [item.componentId, item.quantity, item.lossPercent])) !== JSON.stringify(items.map((item) => [item.componentId, item.quantity, item.lossPercent])) || active.laborCost !== num(labor.laborCost) || active.assemblyMinutes !== num(labor.assemblyMinutes)

  async function save() {
    const invalid = validateComposition(product!.id, items, num(labor.laborCost), num(labor.assemblyMinutes))
    if (invalid) return toast({ title: "Revise a composição", description: invalid, variant: "destructive" })
    setSaving(true)
    try {
      const response = await fetch("/api/catalog/compositions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product!.id, laborCost: num(labor.laborCost), assemblyMinutes: num(labor.assemblyMinutes), notes: labor.notes, items }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      toast({ title: `Composição versão ${payload.version} salva`, description: "A versão anterior ficou inativa." })
      void load()
      onChanged()
    } catch (reason) {
      toast({ title: "Composição não salva", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function activate(version: Version) {
    if (!window.confirm(`Voltar a usar a versão ${version.version}?`)) return
    const response = await fetch("/api/catalog/compositions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", compositionId: version.id }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) return toast({ title: "Não foi possível ativar", description: payload?.error || "Tente novamente.", variant: "destructive" })
    void load()
  }

  async function runProduction() {
    if (!active) return
    if (changed) return toast({ title: "Salve a composição antes", description: "Há alterações não salvas na lista de materiais.", variant: "destructive" })
    const quantity = num(produce.quantity)
    if (!(quantity > 0)) return toast({ title: "Quantidade inválida", description: "Informe quantas unidades montar.", variant: "destructive" })
    if (product!.controlsSerial && !produce.serialNumber.trim()) return toast({ title: "Número de série obrigatório", description: product!.name, variant: "destructive" })
    if (product!.controlsLot && !produce.lotNumber.trim()) return toast({ title: "Lote obrigatório", description: product!.name, variant: "destructive" })
    if (!window.confirm(`Montar ${quantity} ${product!.unit} de ${product!.name}? Os componentes serão baixados do estoque.`)) return
    setProducing(true)
    try {
      const response = await fetch("/api/catalog/compositions/produce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compositionId: active.id, ...produce, quantity }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      toast({ title: "Montagem registrada", description: `Custo unitário ${brl(payload.result.unit_cost)} (materiais ${brl(payload.result.materials_cost)} + mão de obra ${brl(payload.result.labor_cost)}).` })
      setProduce({ ...produce, quantity: "1", serialNumber: "", lotNumber: "" })
      void load()
      onChanged()
    } catch (reason) {
      toast({ title: "Montagem não registrada", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setProducing(false)
    }
  }

  const warehouseOptions = [{ value: "nenhum", label: "Padrão de cada item" }, ...warehouses.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]

  return (
    <FormSheet open onOpenChange={onOpenChange} title={`Composição — ${product.name}`} description={active ? `Versão ativa: ${active.version}` : "Sem composição cadastrada."}>
      {error ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Componentes</h3><Button type="button" size="sm" onClick={() => setRows((current) => [...current, { key: newKey(), componentId: "", quantity: "1", unit: "UN", lossPercent: "0" }])}><Plus className="h-4 w-4" />Componente</Button></div>
        {rows.map((row) => {
          const component = materials.find((item) => item.id === row.componentId)
          const unitCost = Number(component?.averageCost || component?.costPrice || 0)
          const line = quantityWithLoss({ quantity: num(row.quantity), lossPercent: num(row.lossPercent) }) * unitCost
          const update = (patch: Partial<Row>) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, ...patch } : item))
          return <div key={row.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,2fr)_90px_80px_90px_130px_auto] md:items-end">
            <SearchableSelectField label="Componente" value={row.componentId || "nenhum"} onChange={(value) => update({ componentId: value === "nenhum" ? "" : value, unit: materials.find((item) => item.id === value)?.unit || row.unit })} options={[{ value: "nenhum", label: "Selecione" }, ...components.map((item) => ({ value: item.id, label: `${item.internalCode ? `${item.internalCode} - ` : ""}${item.name}` }))]} />
            <TextField label="Quantidade" type="number" value={row.quantity} onChange={(value) => update({ quantity: value })} />
            <TextField label="Unidade" value={row.unit} onChange={(value) => update({ unit: value })} />
            <TextField label="Perda %" type="number" value={row.lossPercent} onChange={(value) => update({ lossPercent: value })} />
            <div className="space-y-2"><Label>Custo estimado</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{brl(line)}</div></div>
            <Button type="button" size="icon" variant="ghost" title="Remover" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        })}
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="Custo de mão de obra por unidade (R$)" type="number" value={labor.laborCost} onChange={(value) => setLabor({ ...labor, laborCost: value })} />
          <TextField label="Tempo de montagem (minutos)" type="number" value={labor.assemblyMinutes} onChange={(value) => setLabor({ ...labor, assemblyMinutes: value })} />
          <div className="space-y-2"><Label>Custo total calculado</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">{brl(cost.total)}</div></div>
        </div>
        <p className="text-xs text-muted-foreground">Materiais {brl(cost.materials)} (pelo custo médio atual, com perda) + mão de obra {brl(cost.labor)}. Salvar cria uma nova versão; as anteriores ficam no histórico.</p>
        <TextAreaField label="Observações da versão" value={labor.notes} onChange={(value) => setLabor({ ...labor, notes: value })} />
        {changed ? <SaveButton disabled={saving} onClick={save}>{saving ? "Salvando..." : active ? `Salvar como versão ${(versions[0]?.version || 0) + 1}` : "Salvar composição"}</SaveButton> : null}
      </section>

      {active ? <section className="space-y-3 rounded-md border p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Factory className="h-4 w-4" />Montar / fabricar</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label={`Quantidade (${product.unit})`} type="number" value={produce.quantity} onChange={(value) => setProduce({ ...produce, quantity: value })} />
          <SelectField label="Retirar componentes de" value={produce.fromWarehouseId || "nenhum"} onChange={(value) => setProduce({ ...produce, fromWarehouseId: value === "nenhum" ? "" : value })} options={warehouseOptions} />
          <SelectField label="Dar entrada do produto em" value={produce.toWarehouseId || "nenhum"} onChange={(value) => setProduce({ ...produce, toWarehouseId: value === "nenhum" ? "" : value })} options={warehouseOptions} />
          {product.controlsLot ? <TextField label="Lote do produto" value={produce.lotNumber} onChange={(value) => setProduce({ ...produce, lotNumber: value })} /> : null}
          {product.controlsSerial ? <TextField label="Número de série / chassi" value={produce.serialNumber} onChange={(value) => setProduce({ ...produce, serialNumber: value })} /> : null}
        </div>
        <p className="text-xs text-muted-foreground">Baixa {active.items.map((item) => `${quantityWithLoss(item) * num(produce.quantity)} ${item.unit} de ${item.name}`).join(", ")} e dá entrada de {num(produce.quantity)} {product.unit} de {product.name} com o custo real dos materiais + mão de obra.</p>
        <Button disabled={producing} onClick={runProduction}><Factory className="h-4 w-4" />{producing ? "Registrando..." : "Registrar montagem"}</Button>
      </section> : null}

      {versions.length ? <section className="space-y-2">
        <h3 className="text-sm font-semibold">Versões</h3>
        <DataTable headers={["Versão", "Situação", "Componentes", "Mão de obra", "Tempo", "Criada por", "Ações"]}>
          {versions.map((version) => <TableRow key={version.id}><TableCell>v{version.version}</TableCell><TableCell><StatusBadge status={version.status} /></TableCell><TableCell>{version.items.length}</TableCell><TableCell>{brl(version.laborCost)}</TableCell><TableCell>{version.assemblyMinutes} min</TableCell><TableCell>{version.createdBy || "-"} · {new Date(version.createdAt).toLocaleDateString("pt-BR")}</TableCell><TableCell>{version.status !== "Ativa" ? <Button size="sm" variant="outline" onClick={() => void activate(version)}>Ativar</Button> : null}</TableCell></TableRow>)}
        </DataTable>
      </section> : null}

      {productions.length ? <section className="space-y-2">
        <h3 className="text-sm font-semibold">Montagens recentes</h3>
        <DataTable headers={["Data", "Quantidade", "Materiais", "Mão de obra", "Custo unitário", "Documento", "Responsável"]}>
          {productions.map((item) => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString("pt-BR")}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{brl(item.materialsCost)}</TableCell><TableCell>{brl(item.laborCost)}</TableCell><TableCell>{brl(item.unitCost)}</TableCell><TableCell>{item.documentReference}</TableCell><TableCell>{item.responsible}</TableCell></TableRow>)}
        </DataTable>
      </section> : null}
    </FormSheet>
  )
}
