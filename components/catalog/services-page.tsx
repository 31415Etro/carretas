"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, PageShell, SectionCard, StatusBadge } from "@/components/operations/shared"
import { ServiceSheet } from "@/components/catalog/service-sheet"
import type { Material } from "@/lib/operational-storage"
import { billingUnits, serviceMargin, type CatalogService } from "@/lib/service-catalog"

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

/** Catálogo de serviços (usado em orçamentos e ordens de serviço). Produtos, matérias-primas e kits têm tela própria. */
export function ServicesPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [services, setServices] = useState<CatalogService[]>([])
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"Ativo" | "Inativo" | "todos">("Ativo")
  const [sheet, setSheet] = useState<{ open: boolean; service: CatalogService | null }>({ open: false, service: null })

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
      setError(reason instanceof Error ? reason.message : "Erro ao carregar os serviços.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    const text = query.toLowerCase()
    return services
      .filter((service) => statusFilter === "todos" || service.status === statusFilter)
      .filter((service) => [service.name, service.code, service.category, service.lc116Item].join(" ").toLowerCase().includes(text))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [services, query, statusFilter])

  return (
    <PageShell title="Serviços" description="Catálogo de serviços usado em orçamentos e ordens de serviço. Produtos finais, matérias-primas e kits têm cadastro próprio no menu."
      actions={<Button onClick={() => setSheet({ open: true, service: null })}><Plus className="h-4 w-4" />Novo serviço</Button>}>
      <SectionCard title="Catálogo de serviços">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Input className="max-w-sm" placeholder="Buscar por nome, código, categoria..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <TabsList><TabsTrigger value="Ativo">Ativos</TabsTrigger><TabsTrigger value="Inativo">Inativos</TabsTrigger><TabsTrigger value="todos">Todos</TabsTrigger></TabsList>
          </Tabs>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <DataTable headers={["Código", "Nome", "Categoria", "Unidade", "Preço", "Custo", "Margem", "Status", "Ações"]} empty={!rows.length && !loading}>
          {rows.map((service) => {
            const margin = serviceMargin(service)
            return (
              <TableRow key={service.id}>
                <TableCell className="font-mono">{service.code || "-"}</TableCell>
                <TableCell>{service.name}</TableCell>
                <TableCell>{service.category || "-"}</TableCell>
                <TableCell>{billingUnits.find((unit) => unit.value === service.billingUnit)?.label || service.billingUnit}</TableCell>
                <TableCell>{brl(service.defaultPrice)}</TableCell>
                <TableCell>{brl(service.estimatedCost)}</TableCell>
                <TableCell>{margin === null ? "-" : `${margin.toLocaleString("pt-BR")}%`}</TableCell>
                <TableCell><StatusBadge status={service.status} /></TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setSheet({ open: true, service })}>Editar</Button></TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>
      <ServiceSheet open={sheet.open} service={sheet.service} onOpenChange={(open) => !open && setSheet({ open: false, service: null })} services={services} materials={materials} providers={providers} onSaved={() => void load()} />
    </PageShell>
  )
}
