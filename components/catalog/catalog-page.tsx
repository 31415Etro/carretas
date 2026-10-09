"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Boxes, Layers, Package, RefreshCw, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, FormSheet, PageShell, SaveButton, SectionCard, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { CompositionSheet } from "@/components/catalog/composition-sheet"
import { MaterialFormFields, emptyMaterialForm, itemTypeOptions, materialFormFromItem, materialRecordFromForm, profitMargin, validateMaterialForm } from "@/components/catalog/product-form"
import { ServiceSheet } from "@/components/catalog/service-sheet"
import { makeId, type Material, type Supplier } from "@/lib/operational-storage"
import { billingUnits, serviceMargin, type CatalogService } from "@/lib/service-catalog"

type Filter = "todos" | "Produto" | "Materia-prima" | "Kit" | "Servico"
type CatalogRow = { kind: "item"; item: Material } | { kind: "service"; service: CatalogService }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const typeLabel = (value?: string) => itemTypeOptions.find((option) => option.value === value)?.label || "Produto"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

/** Catálogo único: produtos, matérias-primas, kits/composições e serviços. */
export function CatalogPage() {
  const { toast } = useCrudFeedback()
  const [materials, setMaterials] = useState<Material[]>([])
  const [services, setServices] = useState<CatalogService[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<Filter>("todos")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"Ativo" | "Inativo" | "todos">("Ativo")
  const [productSheet, setProductSheet] = useState<{ open: boolean; existing?: Material }>({ open: false })
  const [productForm, setProductForm] = useState<Record<string, any>>(emptyMaterialForm)
  const [savingProduct, setSavingProduct] = useState(false)
  const [serviceSheet, setServiceSheet] = useState<{ open: boolean; service: CatalogService | null }>({ open: false, service: null })
  const [composition, setComposition] = useState<Material | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [materialsPayload, servicesPayload] = await Promise.all([
        api<{ materials: Material[] }>("/api/estoque/materials"),
        api<{ services: CatalogService[]; providers: Array<{ id: string; name: string }> }>("/api/catalog/services"),
      ])
      setMaterials(materialsPayload.materials)
      setServices(servicesPayload.services)
      setProviders(servicesPayload.providers)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar o catálogo.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    api<{ suppliers: Supplier[] }>("/api/suppliers").then((payload) => setSuppliers(payload.suppliers)).catch(() => undefined)
  }, [load])

  const rows = useMemo<CatalogRow[]>(() => {
    const text = query.toLowerCase()
    const items = materials
      .filter((item) => filter === "todos" || (item.itemType || "Produto") === filter)
      .filter((item) => statusFilter === "todos" || item.status === statusFilter)
      .filter((item) => [item.name, item.internalCode, item.category, item.subcategory, item.brand, item.ncm, item.barcode].join(" ").toLowerCase().includes(text))
      .map((item) => ({ kind: "item" as const, item }))
    const serviceRows = (filter === "todos" || filter === "Servico" ? services : [])
      .filter((service) => statusFilter === "todos" || service.status === statusFilter)
      .filter((service) => [service.name, service.code, service.category, service.lc116Item].join(" ").toLowerCase().includes(text))
      .map((service) => ({ kind: "service" as const, service }))
    return [...items, ...serviceRows].sort((a, b) => (a.kind === "item" ? a.item.name : a.service.name).localeCompare(b.kind === "item" ? b.item.name : b.service.name, "pt-BR"))
  }, [materials, services, filter, query, statusFilter])

  const counts = useMemo(() => ({
    Produto: materials.filter((item) => (item.itemType || "Produto") === "Produto").length,
    "Materia-prima": materials.filter((item) => item.itemType === "Materia-prima").length,
    Kit: materials.filter((item) => item.itemType === "Kit").length,
    Servico: services.length,
  }), [materials, services])

  function openProduct(existing?: Material, itemType = "Produto") {
    setProductForm(existing ? { ...materialFormFromItem(existing), id: existing.id } : { ...emptyMaterialForm, itemType, ...(itemType === "Materia-prima" ? { allowsSale: false, spedItemType: "01" } : {}), ...(itemType === "Kit" ? { spedItemType: "04" } : {}) })
    setProductSheet({ open: true, existing })
  }

  async function saveProduct() {
    const existing = productSheet.existing
    const invalid = validateMaterialForm(productForm, materials, existing?.id)
    if (invalid) return toast({ title: "Revise o cadastro", description: invalid, variant: "destructive" })
    setSavingProduct(true)
    try {
      const record = materialRecordFromForm(productForm, existing, existing?.id || makeId("mat"))
      const payload = await api<{ material: Material }>("/api/estoque/materials", { method: "POST", body: JSON.stringify({ material: record }) })
      toast({ title: existing ? "Item atualizado" : "Item cadastrado", description: payload.material.name })
      setProductSheet({ open: false })
      await load()
      if (!existing && payload.material.itemType === "Kit") setComposition(payload.material)
    } catch (reason) {
      toast({ title: "Item não salvo", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSavingProduct(false)
    }
  }

  return (
    <PageShell
      title="Produtos / Serviços"
      description="Catálogo único de produtos, matérias-primas, kits/composições e serviços, usado em orçamentos, vendas, compras, estoque e ordens de serviço."
      actions={<>
        <Button onClick={() => openProduct(undefined, "Produto")}><Package className="h-4 w-4" />Novo produto</Button>
        <Button variant="secondary" onClick={() => openProduct(undefined, "Materia-prima")}><Boxes className="h-4 w-4" />Matéria-prima</Button>
        <Button variant="secondary" onClick={() => openProduct(undefined, "Kit")}><Layers className="h-4 w-4" />Kit / composição</Button>
        <Button variant="secondary" onClick={() => setServiceSheet({ open: true, service: null })}><Wrench className="h-4 w-4" />Serviço</Button>
      </>}
    >
      <SectionCard title="Catálogo">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="todos">Todos</TabsTrigger>
              <TabsTrigger value="Produto">Produtos ({counts.Produto})</TabsTrigger>
              <TabsTrigger value="Materia-prima">Matérias-primas ({counts["Materia-prima"]})</TabsTrigger>
              <TabsTrigger value="Kit">Kits / composições ({counts.Kit})</TabsTrigger>
              <TabsTrigger value="Servico">Serviços ({counts.Servico})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input className="max-w-sm" placeholder="Buscar por nome, código, categoria, marca, NCM..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <TabsList><TabsTrigger value="Ativo">Ativos</TabsTrigger><TabsTrigger value="Inativo">Inativos</TabsTrigger><TabsTrigger value="todos">Todos</TabsTrigger></TabsList>
          </Tabs>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Código", "Nome", "Tipo", "Categoria", "Unidade", "Preço / valor", "Custo", "Margem", "Estoque", "Status", "Ações"]} empty={!rows.length} stickyHeader viewportClassName="max-h-[40rem] overflow-auto overscroll-contain" tableClassName="min-w-[1300px]">
          {rows.map((row) => {
            if (row.kind === "service") {
              const service = row.service
              const margin = serviceMargin(service)
              return <TableRow key={`s-${service.id}`}>
                <TableCell className="font-mono">{service.code || "-"}</TableCell>
                <TableCell>{service.name}</TableCell>
                <TableCell>Serviço</TableCell>
                <TableCell>{service.category || "-"}</TableCell>
                <TableCell>{billingUnits.find((unit) => unit.value === service.billingUnit)?.label || service.billingUnit}</TableCell>
                <TableCell>{brl(service.defaultPrice)}</TableCell>
                <TableCell>{brl(service.estimatedCost)}</TableCell>
                <TableCell>{margin === null ? "-" : `${margin.toLocaleString("pt-BR")}%`}</TableCell>
                <TableCell>-</TableCell>
                <TableCell><StatusBadge status={service.status} /></TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setServiceSheet({ open: true, service })}>Editar</Button></TableCell>
              </TableRow>
            }
            const item = row.item
            const cost = Number(item.averageCost || item.costPrice || 0)
            const margin = profitMargin(cost, Number(item.salePrice || 0))
            return <TableRow key={`m-${item.id}`}>
              <TableCell className="font-mono">{item.internalCode || "-"}</TableCell>
              <TableCell><div className="flex items-center gap-2">{item.photoUrl ? <img src={item.photoUrl} alt="" className="h-8 w-8 rounded object-cover" /> : null}<span>{item.name}</span></div></TableCell>
              <TableCell>{typeLabel(item.itemType)}</TableCell>
              <TableCell>{[item.category, item.subcategory].filter(Boolean).join(" / ") || "-"}</TableCell>
              <TableCell>{item.unit}</TableCell>
              <TableCell>{item.allowsSale === false ? "Não vende" : brl(item.salePrice || 0)}</TableCell>
              <TableCell>{brl(cost)}</TableCell>
              <TableCell>{margin === null || item.allowsSale === false ? "-" : `${margin.toLocaleString("pt-BR")}%`}</TableCell>
              <TableCell>{item.controlsStock === false ? "Não controla" : `${Number(item.currentStock || 0).toLocaleString("pt-BR")} ${item.unit}`}</TableCell>
              <TableCell><StatusBadge status={item.status} /></TableCell>
              <TableCell className="space-x-1 whitespace-nowrap">
                <Button size="sm" variant="outline" onClick={() => openProduct(item)}>Editar</Button>
                {item.itemType === "Kit" ? <Button size="sm" variant="outline" onClick={() => setComposition(item)}><Layers className="h-4 w-4" />Composição</Button> : null}
              </TableCell>
            </TableRow>
          })}
        </DataTable>
      </SectionCard>

      <FormSheet open={productSheet.open} onOpenChange={(open) => !open && setProductSheet({ open: false })} title={productSheet.existing ? `${typeLabel(productSheet.existing.itemType)} — ${productSheet.existing.name}` : `Novo ${typeLabel(productForm.itemType).toLowerCase()}`}>
        <MaterialFormFields material={productForm} setMaterial={setProductForm} suppliers={suppliers} existing={productSheet.existing} showStatus />
        <SaveButton disabled={savingProduct} onClick={saveProduct}>{savingProduct ? "Salvando..." : productForm.itemType === "Kit" && !productSheet.existing ? "Salvar e montar composição" : "Salvar"}</SaveButton>
      </FormSheet>
      <ServiceSheet open={serviceSheet.open} service={serviceSheet.service} onOpenChange={(open) => !open && setServiceSheet({ open: false, service: null })} services={services} materials={materials} providers={providers} onSaved={() => void load()} />
      <CompositionSheet product={composition} materials={materials} onOpenChange={(open) => !open && setComposition(null)} onChanged={() => void load()} />
    </PageShell>
  )
}

