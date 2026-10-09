"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { FormSheet, SaveButton, SearchableSelectField, SelectField, TextAreaField, TextField } from "@/components/operations/shared"
import { useToast } from "@/hooks/use-toast"
import type { Material } from "@/lib/operational-storage"
import { billingUnits, serviceMargin, validateService, type CatalogService } from "@/lib/service-catalog"

export const emptyService: CatalogService = {
  code: "", name: "", description: "", category: "", billingUnit: "Servico", defaultPrice: 0, estimatedCost: 0, estimatedMinutes: 0,
  nfseNationalCode: "", lc116Item: "", municipalTaxCode: "", nbsCode: "", issRate: 0, issRetained: false,
  retentions: { ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 }, responsibleProviderId: "", warrantyDays: 0, status: "Ativo", materials: [], tasks: [],
}

type Form = Omit<CatalogService, "defaultPrice" | "estimatedCost" | "estimatedMinutes" | "issRate" | "warrantyDays" | "retentions" | "materials" | "tasks"> & {
  defaultPrice: string; estimatedCost: string; estimatedHours: string; issRate: string; warrantyDays: string
  retentions: Record<string, string>; materials: Array<{ materialId: string; quantity: string; unit: string }>; tasks: string
}

const num = (value: string | number) => Number(String(value ?? "").replace(",", ".")) || 0

function toForm(service: CatalogService): Form {
  return {
    ...service,
    defaultPrice: String(service.defaultPrice || ""), estimatedCost: String(service.estimatedCost || ""), estimatedHours: service.estimatedMinutes ? String(Math.round((service.estimatedMinutes / 60) * 100) / 100) : "",
    issRate: String(service.issRate || ""), warrantyDays: String(service.warrantyDays || ""),
    retentions: Object.fromEntries(Object.entries(service.retentions).map(([key, value]) => [key, value ? String(value) : ""])),
    materials: service.materials.map((item) => ({ ...item, quantity: String(item.quantity) })),
    tasks: service.tasks.join("\n"),
  }
}

function fromForm(form: Form): CatalogService {
  return {
    ...form,
    defaultPrice: num(form.defaultPrice), estimatedCost: num(form.estimatedCost), estimatedMinutes: Math.round(num(form.estimatedHours) * 60),
    issRate: num(form.issRate), warrantyDays: Math.round(num(form.warrantyDays)),
    retentions: { ir: num(form.retentions.ir), pis: num(form.retentions.pis), cofins: num(form.retentions.cofins), csll: num(form.retentions.csll), inss: num(form.retentions.inss) },
    materials: form.materials.filter((item) => item.materialId).map((item) => ({ ...item, quantity: num(item.quantity) })),
    tasks: form.tasks.split("\n").map((task) => task.trim()).filter(Boolean),
  }
}

export function ServiceSheet({ service, open, onOpenChange, services, materials, providers, onSaved }: { service: CatalogService | null; open: boolean; onOpenChange: (open: boolean) => void; services: CatalogService[]; materials: Material[]; providers: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const { toast } = useToast()
  const [form, setForm] = useState<Form>(toForm(emptyService))
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(toForm(service || emptyService)) }, [open, service])
  const set = (key: keyof Form) => (value: string) => setForm({ ...form, [key]: value })
  const margin = serviceMargin({ defaultPrice: num(form.defaultPrice), estimatedCost: num(form.estimatedCost) })
  const materialsCost = form.materials.reduce((sum, item) => sum + num(item.quantity) * Number(materials.find((row) => row.id === item.materialId)?.averageCost || materials.find((row) => row.id === item.materialId)?.costPrice || 0), 0)

  async function save() {
    const record = fromForm(form)
    const invalid = validateService(record, services.filter((item) => item.id !== record.id).map((item) => item.code).filter(Boolean))
    if (invalid) return toast({ title: "Revise o serviço", description: invalid, variant: "destructive" })
    setSaving(true)
    try {
      const response = await fetch("/api/catalog/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: record }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      toast({ title: service ? "Serviço atualizado" : "Serviço cadastrado", description: record.name })
      onOpenChange(false)
      onSaved()
    } catch (reason) {
      toast({ title: "Serviço não salvo", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={service ? `Serviço — ${service.name}` : "Novo serviço"}>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Identificação e preço</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Código interno" value={form.code} onChange={set("code")} placeholder="Ex.: SRV-001" />
          <TextField label="Nome do serviço" value={form.name} onChange={set("name")} />
          <TextField label="Categoria" value={form.category} onChange={set("category")} placeholder="Ex.: Manutenção, Montagem, Reforma" />
          <SelectField label="Unidade de cobrança" value={form.billingUnit} onChange={set("billingUnit")} options={billingUnits} />
          <TextField label="Valor padrão (R$)" type="number" value={form.defaultPrice} onChange={set("defaultPrice")} />
          <TextField label="Custo estimado (R$)" type="number" value={form.estimatedCost} onChange={set("estimatedCost")} />
          <TextField label="Tempo estimado de execução (horas)" type="number" value={form.estimatedHours} onChange={set("estimatedHours")} />
          <div className="space-y-2"><Label>Margem estimada</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{margin === null ? "-" : `${margin.toLocaleString("pt-BR")}%`}</div></div>
          <TextField label="Garantia do serviço (dias)" type="number" value={form.warrantyDays} onChange={set("warrantyDays")} />
          <SearchableSelectField label="Equipe / técnico responsável" value={form.responsibleProviderId || "nenhum"} onChange={(value) => setForm({ ...form, responsibleProviderId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Nenhum" }, ...providers.map((item) => ({ value: item.id, label: item.name }))]} />
          <SelectField label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value as Form["status"] })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Descrição" value={form.description} onChange={set("description")} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Tributação da NFS-e</h3>
        <p className="text-xs text-muted-foreground">Preencha conforme a operação e o município. A NBS é uma classificação própria de serviços e não substitui o código de tributação da NFS-e.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Código de tributação nacional (NFS-e)" value={form.nfseNationalCode} onChange={set("nfseNationalCode")} placeholder="6 dígitos" />
          <TextField label="Item da lista da LC 116" value={form.lc116Item} onChange={set("lc116Item")} placeholder="Ex.: 14.01" />
          <TextField label="Código tributário municipal" value={form.municipalTaxCode} onChange={set("municipalTaxCode")} />
          <TextField label="NBS" value={form.nbsCode} onChange={set("nbsCode")} placeholder="Ex.: 1.2001.10.00" />
          <TextField label="Alíquota ISS (%)" type="number" value={form.issRate} onChange={set("issRate")} />
          <div className="flex items-center gap-3 rounded-md border px-3 py-2"><Checkbox checked={form.issRetained} onCheckedChange={(checked) => setForm({ ...form, issRetained: checked === true })} /><Label>ISS retido pelo tomador</Label></div>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          {(["ir", "pis", "cofins", "csll", "inss"] as const).map((key) => <TextField key={key} label={`Retenção ${key.toUpperCase()} (%)`} type="number" value={form.retentions[key] || ""} onChange={(value) => setForm({ ...form, retentions: { ...form.retentions, [key]: value } })} />)}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Materiais necessários</h3><Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, materials: [...form.materials, { materialId: "", quantity: "1", unit: "UN" }] })}><Plus className="h-4 w-4" />Material</Button></div>
        {form.materials.map((item, index) => (
          <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,2fr)_110px_90px_auto] md:items-end">
            <SearchableSelectField label="Material" value={item.materialId || "nenhum"} onChange={(value) => setForm({ ...form, materials: form.materials.map((row, position) => position === index ? { ...row, materialId: value === "nenhum" ? "" : value, unit: materials.find((material) => material.id === value)?.unit || row.unit } : row) })} options={[{ value: "nenhum", label: "Selecione" }, ...materials.filter((material) => material.status === "Ativo" || material.id === item.materialId).map((material) => ({ value: material.id, label: `${material.internalCode ? `${material.internalCode} - ` : ""}${material.name}` }))]} />
            <TextField label="Quantidade" type="number" value={item.quantity} onChange={(value) => setForm({ ...form, materials: form.materials.map((row, position) => position === index ? { ...row, quantity: value } : row) })} />
            <TextField label="Unidade" value={item.unit} onChange={(value) => setForm({ ...form, materials: form.materials.map((row, position) => position === index ? { ...row, unit: value } : row) })} />
            <Button type="button" size="icon" variant="ghost" title="Remover" onClick={() => setForm({ ...form, materials: form.materials.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        {form.materials.length ? <p className="text-xs text-muted-foreground">Custo estimado dos materiais: {materialsCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (custo médio atual). Lista de referência do serviço; a inclusão automática na OS entra com o módulo de Ordem de Serviço.</p> : null}
      </section>

      <TextAreaField label="Checklist padrão da OS (uma tarefa por linha)" value={form.tasks} onChange={set("tasks")} rows={4} />
      <SaveButton disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar serviço"}</SaveButton>
    </FormSheet>
  )
}
