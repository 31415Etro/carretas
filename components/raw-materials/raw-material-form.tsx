"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { SelectField } from "@/components/operations/shared"
import { UploadField } from "@/components/catalog/upload-field"
import { api, Field, FormSection, NcmField, Num, SkuField, SupplierLinksEditor } from "@/components/catalog/catalog-fields"
import { RAW_MATERIAL_KINDS, RAW_MATERIAL_UNITS, type FieldErrors, type RawMaterialForm } from "@/lib/raw-materials"

type Warehouse = { id: string; name: string; isDefault?: boolean }

/** Formulário EXCLUSIVO de matéria-prima: só os campos de um material de fabricação (sem preço de venda, a menos que "Disponível para venda" seja ligado). */
export function RawMaterialFormFields({ form, setForm, errors, editing = false, hasHistory = false, originalSku = "" }: {
  form: RawMaterialForm; setForm: (form: RawMaterialForm) => void; errors: FieldErrors; editing?: boolean; hasHistory?: boolean; originalSku?: string
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [trace, setTrace] = useState(form.controlsLot || form.controlsSerial || form.controlsExpiry)
  useEffect(() => { void api<{ warehouses: Warehouse[] }>("/api/estoque/warehouses").then((payload) => setWarehouses(payload.warehouses)).catch(() => setWarehouses([])) }, [])
  const set = (patch: Partial<RawMaterialForm>) => setForm({ ...form, ...patch })
  const text = (key: keyof RawMaterialForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [key]: event.target.value } as Partial<RawMaterialForm>)

  return (
    <div className="space-y-4">
      <FormSection title="Identificação">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nome da matéria-prima" error={errors.name} className="md:col-span-2"><Input value={form.name} onChange={text("name")} placeholder="Ex.: Perfil de aço U 6 m" aria-invalid={Boolean(errors.name)} /></Field>
          <SkuField form={form} set={set} error={errors.sku} reasonError={errors.skuChangeReason} editing={editing} hasHistory={hasHistory} originalSku={originalSku} />
          <SelectField label="Status" value={form.status} onChange={(value) => set({ status: value as RawMaterialForm["status"] })} options={[{ value: "Ativo", label: "Ativo" }, { value: "Inativo", label: "Inativo" }]} />
          <Field label="Categoria" error={errors.category}><Input value={form.category} onChange={text("category")} placeholder="Ex.: Perfis e barras" /></Field>
          <Field label="Subcategoria"><Input value={form.subcategory} onChange={text("subcategory")} /></Field>
          <SelectField label="Tipo de material" value={form.materialKind} onChange={(value) => set({ materialKind: value })} placeholder="Selecione" options={RAW_MATERIAL_KINDS.map((kind) => ({ value: kind, label: kind }))} />
          <SelectField label="Unidade de medida" value={form.unit} onChange={(value) => set({ unit: value })} options={RAW_MATERIAL_UNITS.map((unit) => ({ value: unit, label: unit }))} />
        </div>
        <Field label="Descrição técnica" hint="Composição, norma, acabamento e uso. Ajuda na busca e na sugestão de NCM."><Textarea rows={3} value={form.description} onChange={text("description")} /></Field>
      </FormSection>

      <FormSection title="Dimensões e características técnicas" description="Preencha apenas o que se aplica ao material.">
        <div className="grid gap-3 md:grid-cols-4">
          <Num label="Comprimento" value={form.length} onChange={(value) => set({ length: value })} suffix="mm" error={errors.length} />
          <Num label="Largura" value={form.width} onChange={(value) => set({ width: value })} suffix="mm" error={errors.width} />
          <Num label="Altura" value={form.height} onChange={(value) => set({ height: value })} suffix="mm" error={errors.height} />
          <Num label="Espessura" value={form.thickness} onChange={(value) => set({ thickness: value })} suffix="mm" error={errors.thickness} />
          <Num label="Diâmetro" value={form.diameter} onChange={(value) => set({ diameter: value })} suffix="mm" error={errors.diameter} />
          <Num label="Peso líquido" value={form.netWeight} onChange={(value) => set({ netWeight: value })} suffix="kg" error={errors.netWeight} />
          <Num label="Peso bruto" value={form.grossWeight} onChange={(value) => set({ grossWeight: value })} suffix="kg" error={errors.grossWeight} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Outras características</p>
          {form.attributes.map((attribute, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Característica (ex.: Norma)" value={attribute.key} onChange={(event) => set({ attributes: form.attributes.map((item, position) => (position === index ? { ...item, key: event.target.value } : item)) })} />
              <Input placeholder="Valor (ex.: NBR 6650)" value={attribute.value} onChange={(event) => set({ attributes: form.attributes.map((item, position) => (position === index ? { ...item, value: event.target.value } : item)) })} />
              <Button type="button" variant="ghost" size="icon" title="Remover" onClick={() => set({ attributes: form.attributes.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {errors.attributes ? <p className="text-xs text-destructive">{errors.attributes}</p> : null}
          <Button type="button" variant="outline" size="sm" onClick={() => set({ attributes: [...form.attributes, { key: "", value: "" }] })}><Plus className="h-4 w-4" />Adicionar característica</Button>
        </div>
      </FormSection>

      <FormSection title="Compras e fornecedores" description="O fornecedor principal é usado nas solicitações de compra geradas pela produção.">
        <SupplierLinksEditor links={form.suppliers} onChange={(suppliers) => set({ suppliers })} error={errors.suppliers} />
        <div className="grid gap-3 md:grid-cols-3">
          <Num label="Custo de aquisição" value={form.costPrice} onChange={(value) => set({ costPrice: value })} suffix="R$" error={errors.costPrice} hint="Referência de cadastro. O custo vigente vem das compras e das entradas em estoque." />
          <Num label="Prazo de reposição" value={form.leadTimeDays} onChange={(value) => set({ leadTimeDays: value })} suffix="dias" error={errors.leadTimeDays} />
          <Num label="Compra mínima" value={form.minPurchaseQty} onChange={(value) => set({ minPurchaseQty: value })} error={errors.minPurchaseQty} />
        </div>
      </FormSection>

      <FormSection title="Estoque">
        <div className="grid gap-3 md:grid-cols-4">
          <Num label="Estoque mínimo" value={form.minimumStock} onChange={(value) => set({ minimumStock: value })} error={errors.minimumStock} suffix={form.unit} />
          <Num label="Ponto de reposição" value={form.reorderPoint} onChange={(value) => set({ reorderPoint: value })} error={errors.reorderPoint} suffix={form.unit} />
          <Num label="Estoque máximo" value={form.maximumStock} onChange={(value) => set({ maximumStock: value })} error={errors.maximumStock} suffix={form.unit} />
          <SelectField label="Depósito padrão" value={form.warehouseId} onChange={(value) => set({ warehouseId: value })} placeholder="Depósito principal da empresa" options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
        </div>
        <div className="rounded-md border p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span><strong>Controlar lote, série ou validade</strong><span className="block text-xs text-muted-foreground">Ligue só quando a rastreabilidade for necessária para este material.</span></span>
            <Switch checked={trace} onCheckedChange={(checked) => { setTrace(checked); if (!checked) set({ controlsLot: false, controlsSerial: false, controlsExpiry: false }) }} />
          </label>
          {trace ? (
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.controlsLot} onChange={(event) => set({ controlsLot: event.target.checked })} />Lote</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.controlsSerial} onChange={(event) => set({ controlsSerial: event.target.checked })} />Número de série</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.controlsExpiry} onChange={(event) => set({ controlsExpiry: event.target.checked })} />Validade</label>
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection title="Classificação fiscal (NCM)" description="Sugestão da tabela oficial (Siscomex/Camex). A classificação só vale depois da sua confirmação.">
        <NcmField form={form} set={set} error={errors.ncm} context={{ name: form.name, description: [form.description, form.category, form.subcategory].filter(Boolean).join(" "), kind: form.materialKind }} />
      </FormSection>

      <FormSection title="Venda (opcional)" description="Matéria-prima é de consumo interno. Ligue apenas se esta empresa também vende este material.">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><strong>Disponível para venda</strong><span className="block text-xs text-muted-foreground">Desligado por padrão. Ligado, exige preço de venda e NCM (a regra também vale no servidor).</span></span>
          <Switch checked={form.allowsSale} onCheckedChange={(checked) => set({ allowsSale: checked })} />
        </label>
        {form.allowsSale ? <div className="grid gap-3 md:grid-cols-3"><Num label="Preço de venda" value={form.salePrice} onChange={(value) => set({ salePrice: value })} suffix="R$" error={errors.salePrice} /></div> : null}
      </FormSection>

      <FormSection title="Arquivos e observações">
        <div className="grid gap-3 md:grid-cols-2">
          <UploadField label="Foto" value={form.photoUrl} onChange={(url) => set({ photoUrl: url })} accept="image/jpeg,image/png,image/webp" />
          <UploadField label="Ficha técnica (PDF ou imagem)" value={form.technicalSheetUrl} onChange={(url) => set({ technicalSheetUrl: url })} />
        </div>
        <Field label="Observações"><Textarea rows={2} value={form.notes} onChange={text("notes")} /></Field>
      </FormSection>
    </div>
  )
}
