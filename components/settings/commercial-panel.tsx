"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SearchableSelectField, SectionCard, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { quoteTypes } from "@/lib/quotes"
import { api, brl, day, none, Opts, post, type Row } from "@/components/settings/common"

type Catalog = { products: Array<{ id: string; name: string; code: string; price: number }>; services: Array<{ id: string; name: string; code: string; price: number }>; clients: Array<{ id: string; name: string }>; paymentConditions: Array<{ id: string; name: string }> }

const emptyTable = (): Row => ({ id: "", name: "", clientId: "", validFrom: new Date().toISOString().slice(0, 10), validUntil: "", notes: "", active: true, items: [] })
const emptyTemplate = (): Row => ({ id: "", name: "", quoteType: "", validityDays: "15", paymentConditionId: "", deliveryText: "", warrantyDays: "0", notes: "", active: true })

/** Tabelas de preço (por cliente ou gerais) e modelos de orçamento; são aplicados na tela de Orçamentos. */
export function CommercialPanel() {
  const { toast } = useCrudFeedback()
  const [tables, setTables] = useState<Row[]>([])
  const [templates, setTemplates] = useState<Row[]>([])
  const [catalog, setCatalog] = useState<Catalog>({ products: [], services: [], clients: [], paymentConditions: [] })
  const [table, setTable] = useState<Row | null>(null)
  const [template, setTemplate] = useState<Row | null>(null)
  const [adding, setAdding] = useState({ kind: "Produto", id: "", price: "" })

  const load = useCallback(async () => {
    const [t, m, c] = await Promise.all([api<{ items: Row[] }>("/api/configuracoes/tabelas-preco"), api<{ items: Row[] }>("/api/configuracoes/modelos"), api<Catalog>("/api/orcamentos/options")])
    setTables(t.items)
    setTemplates(m.items)
    setCatalog({ products: c.products, services: c.services, clients: c.clients, paymentConditions: c.paymentConditions })
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function saveTable() {
    try {
      await post("tabelas-preco", { item: table })
      setTable(null)
      toast({ title: "Tabela de preços salva" })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function saveTemplate() {
    try {
      await post("modelos", { item: template })
      setTemplate(null)
      toast({ title: "Modelo salvo" })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  function addItem() {
    if (!table || !adding.id || adding.price === "") return
    const source = adding.kind === "Produto" ? catalog.products.find((item) => item.id === adding.id) : catalog.services.find((item) => item.id === adding.id)
    if (!source) return
    setTable({ ...table, items: [...table.items.filter((item: Row) => (item.materialId || item.serviceTypeId) !== adding.id), { materialId: adding.kind === "Produto" ? adding.id : "", serviceTypeId: adding.kind === "Serviço" ? adding.id : "", name: `${source.code ? `${source.code} · ` : ""}${source.name}`, price: Number(adding.price) }] })
    setAdding({ ...adding, id: "", price: "" })
  }

  const list = adding.kind === "Produto" ? catalog.products : catalog.services

  return (
    <div className="space-y-4">
      <SectionCard title="Tabelas de preço" description="A tabela vigente do cliente (ou a geral) define o preço sugerido ao adicionar itens no orçamento. Vigência e itens por produto/serviço.">
        <Button className="mb-3" onClick={() => setTable(emptyTable())}><Plus className="h-4 w-4" />Nova tabela</Button>
        <DataTable headers={["Tabela", "Cliente", "Vigência", "Itens", "Status", "Ações"]} empty={!tables.length}>
          {tables.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.name}</TableCell><TableCell>{item.clientName}</TableCell><TableCell>{day(item.validFrom)} a {item.validUntil ? day(item.validUntil) : "indeterminada"}</TableCell><TableCell>{item.items.length}</TableCell><TableCell><StatusBadge status={item.active ? "Ativo" : "Inativo"} /></TableCell>
              <TableCell><Button size="sm" variant="outline" onClick={() => setTable({ ...item })}>Editar</Button></TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Modelos de orçamento" description="Pré-preenchem tipo, validade, condição de pagamento, prazo, garantia e condições comerciais.">
        <Button className="mb-3" onClick={() => setTemplate(emptyTemplate())}><Plus className="h-4 w-4" />Novo modelo</Button>
        <DataTable headers={["Modelo", "Tipo", "Validade (dias)", "Condição de pagamento", "Garantia (dias)", "Status", "Ações"]} empty={!templates.length}>
          {templates.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.name}</TableCell><TableCell>{item.quoteType || "-"}</TableCell><TableCell>{item.validityDays}</TableCell><TableCell>{catalog.paymentConditions.find((condition) => condition.id === item.paymentConditionId)?.name || "-"}</TableCell>
              <TableCell>{item.warrantyDays}</TableCell><TableCell><StatusBadge status={item.active ? "Ativo" : "Inativo"} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setTemplate({ ...item, validityDays: String(item.validityDays), warrantyDays: String(item.warrantyDays) })}>Editar</Button></TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <Sheet open={Boolean(table)} onOpenChange={(value) => !value && setTable(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>{table?.id ? "Editar tabela de preços" : "Nova tabela de preços"}</SheetTitle><SheetDescription>Sem cliente = vale para todos. A tabela do cliente tem prioridade.</SheetDescription></SheetHeader>
          {table && (
            <div className="space-y-4 px-4 pb-6">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="Nome *" value={table.name} onChange={(value) => setTable({ ...table, name: value })} />
                <SearchableSelectField label="Cliente (opcional)" value={table.clientId || none} onChange={(value) => setTable({ ...table, clientId: value === none ? "" : value })} options={[{ value: none, label: "Todos os clientes" }, ...catalog.clients.map((client) => ({ value: client.id, label: client.name }))]} />
                <TextField label="Vigência a partir de *" type="date" value={table.validFrom} onChange={(value) => setTable({ ...table, validFrom: value })} />
                <TextField label="Vigência até" type="date" value={table.validUntil} onChange={(value) => setTable({ ...table, validUntil: value })} />
              </div>
              <TextAreaField label="Observações" rows={2} value={table.notes} onChange={(value) => setTable({ ...table, notes: value })} />
              <div className="grid items-end gap-2 md:grid-cols-[9rem_1fr_9rem_auto]">
                <Opts label="Tipo de item" value={adding.kind} onChange={(value) => setAdding({ kind: value || "Produto", id: "", price: "" })} items={[{ value: "Produto", label: "Produto" }, { value: "Serviço", label: "Serviço" }]} />
                <SearchableSelectField label="Item" value={adding.id || none} onChange={(value) => { const source = list.find((item) => item.id === value); setAdding({ ...adding, id: value === none ? "" : value, price: source ? String(source.price) : "" }) }} options={[{ value: none, label: "Pesquisar no catálogo" }, ...list.map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name} — catálogo ${brl(item.price)}` }))]} />
                <TextField label="Preço da tabela" type="number" value={adding.price} onChange={(value) => setAdding({ ...adding, price: value })} />
                <Button variant="outline" onClick={addItem} disabled={!adding.id}><Plus className="h-4 w-4" />Adicionar</Button>
              </div>
              <DataTable headers={["Item", "Preço", ""]} empty={!table.items.length}>
                {table.items.map((item: Row) => (
                  <TableRow key={item.materialId || item.serviceTypeId}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell><input className="w-28 rounded border bg-background px-2 py-1 text-sm" type="number" value={item.price} onChange={(event) => setTable({ ...table, items: table.items.map((entry: Row) => (entry === item ? { ...entry, price: event.target.value } : entry)) })} /></TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => setTable({ ...table, items: table.items.filter((entry: Row) => entry !== item) })}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </DataTable>
              <div className="flex items-center gap-2"><Checkbox id="table-active" checked={table.active} onCheckedChange={(value) => setTable({ ...table, active: value === true })} /><Label htmlFor="table-active">Tabela ativa</Label></div>
              <Button onClick={() => void saveTable()}>Salvar tabela</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(template)} onOpenChange={(value) => !value && setTemplate(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{template?.id ? "Editar modelo" : "Novo modelo de orçamento"}</SheetTitle><SheetDescription>Aplicado com um clique na tela de Orçamentos.</SheetDescription></SheetHeader>
          {template && (
            <div className="space-y-4 px-4 pb-6">
              <TextField label="Nome *" value={template.name} onChange={(value) => setTemplate({ ...template, name: value })} />
              <div className="grid gap-3 md:grid-cols-2">
                <Opts label="Tipo" value={template.quoteType} onChange={(value) => setTemplate({ ...template, quoteType: value })} items={quoteTypes.map((value) => ({ value, label: value }))} placeholder="Qualquer" />
                <TextField label="Validade (dias) *" type="number" value={template.validityDays} onChange={(value) => setTemplate({ ...template, validityDays: value })} />
                <Opts label="Condição de pagamento" value={template.paymentConditionId} onChange={(value) => setTemplate({ ...template, paymentConditionId: value })} items={catalog.paymentConditions.map((condition) => ({ value: condition.id, label: condition.name }))} placeholder="Nenhuma" />
                <TextField label="Garantia (dias)" type="number" value={template.warrantyDays} onChange={(value) => setTemplate({ ...template, warrantyDays: value })} />
              </div>
              <TextField label="Prazo de entrega / execução" value={template.deliveryText} onChange={(value) => setTemplate({ ...template, deliveryText: value })} />
              <TextAreaField label="Observações e condições comerciais" value={template.notes} onChange={(value) => setTemplate({ ...template, notes: value })} />
              <div className="flex items-center gap-2"><Checkbox id="tpl-active" checked={template.active} onCheckedChange={(value) => setTemplate({ ...template, active: value === true })} /><Label htmlFor="tpl-active">Modelo ativo</Label></div>
              <Button onClick={() => void saveTemplate()}>Salvar modelo</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
