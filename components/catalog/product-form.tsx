"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SearchableSelectField, SelectField, TextAreaField, TextField } from "@/components/operations/shared"
import { materialAvailable, useWarehouses } from "@/components/operations/stock-erp"
import { FiscalRulesEditor } from "@/components/catalog/fiscal-rules-editor"
import { UploadField } from "@/components/catalog/upload-field"
import { materialOriginOptions, materialSpedItemTypeOptions } from "@/lib/material-fields"
import { nowIso, type Material, type Supplier } from "@/lib/operational-storage"

export const itemTypeOptions = [
  { value: "Produto", label: "Produto" },
  { value: "Materia-prima", label: "Matéria-prima" },
  { value: "Kit", label: "Kit / composição" },
]

const materialNumberFields = ["minimumStock", "maximumStock", "reorderPoint", "currentStock", "grossWeight", "netWeight", "height", "width", "length", "costPrice", "salePrice", "warrantyMonths"] as const
const materialBooleanFields = ["controlsLot", "controlsSerial", "controlsExpiry", "controlsStock", "allowsSale"] as const

export const emptyMaterialForm: Record<string, any> = {
  itemType: "Produto", name: "", description: "", category: "", subcategory: "", brand: "", manufacturer: "", unit: "UN", internalCode: "", barcode: "",
  ncm: "", cest: "", origin: "0", spedItemType: "00",
  minimumStock: "0", maximumStock: "0", currentStock: "0", grossWeight: "0", netWeight: "0", height: "0", width: "0", length: "0", location: "",
  costPrice: "0", salePrice: "0", supplierId: "", supplierCode: "", warrantyMonths: "0", photoUrl: "", technicalSheetUrl: "",
  warehouseId: "", reorderPoint: "0", controlsLot: false, controlsSerial: false, controlsExpiry: false, controlsStock: true, allowsSale: true,
  status: "Ativo", notes: "",
}

function stockOf(material: Material) {
  return (material as any).currentStock ?? material.minimumStock ?? 0
}

export function materialFormFromItem(item: Material): Record<string, any> {
  const form: Record<string, any> = { ...emptyMaterialForm }
  for (const key of Object.keys(emptyMaterialForm)) {
    const value = (item as any)[key]
    if (value !== undefined && value !== null) form[key] = typeof value === "number" ? String(value) : value
  }
  form.currentStock = String(stockOf(item))
  return form
}

export function materialRecordFromForm(form: Record<string, any>, existing: Material | undefined, id: string): Material {
  const now = nowIso()
  const record: Record<string, any> = { ...form, id, createdAt: existing?.createdAt || now, updatedAt: now }
  for (const key of materialBooleanFields) record[key] = Boolean(form[key])
  for (const key of materialNumberFields) record[key] = Number(String(form[key] ?? 0).replace(",", ".")) || 0
  if (existing) {
    // Saldo, reservado e custos vêm das movimentações: o cadastro não altera.
    record.currentStock = stockOf(existing)
    record.reservedStock = existing.reservedStock || 0
    record.averageCost = existing.averageCost || 0
    record.lastPurchaseCost = existing.lastPurchaseCost || 0
  }
  return record as Material
}

/** Margem de lucro sobre o preço de venda: (venda - custo) / venda. */
export function profitMargin(cost: number, sale: number) {
  return sale > 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null
}

export function validateMaterialForm(form: Record<string, any>, materials: Material[], currentId?: string) {
  if (!String(form.itemType || "").trim()) return "Informe o tipo do item."
  if (!String(form.name || "").trim()) return "Informe o nome do produto."
  if (!String(form.internalCode || "").trim()) return "Informe o SKU / código interno."
  if (!String(form.category || "").trim()) return "Informe a categoria do item."
  if (!String(form.unit || "").trim()) return "Informe a unidade comercial."
  if (form.allowsSale && !(Number(String(form.salePrice || 0).replace(",", ".")) > 0)) return "Item que permite venda precisa de preço de venda."
  if (form.allowsSale && !String(form.ncm || "").trim()) return "Item vendido com nota fiscal precisa de NCM."
  if (Number(form.reorderPoint || 0) < 0 || Number(form.minimumStock || 0) < 0) return "Estoque mínimo e ponto de reposição não podem ser negativos."
  if (!currentId && Number(form.currentStock || 0) < 0) return "O saldo inicial não pode ser negativo."
  if (!currentId && Number(form.currentStock || 0) > 0 && !form.controlsStock) return "Item que não controla estoque não tem saldo inicial."
  if (Number(form.warrantyMonths || 0) < 0) return "A garantia não pode ser negativa."
  const sku = String(form.internalCode || "").trim().toLowerCase()
  if (sku && materials.some((item) => item.id !== currentId && String(item.internalCode || "").trim().toLowerCase() === sku)) return `O SKU "${form.internalCode}" já está em uso por outro item.`
  const ncm = String(form.ncm || "").replace(/\D/g, "")
  if (ncm && ncm.length !== 8) return "O NCM deve ter 8 dígitos."
  const cest = String(form.cest || "").replace(/\D/g, "")
  if (cest && cest.length !== 7) return "O CEST deve ter 7 dígitos."
  const barcode = String(form.barcode || "").replace(/\D/g, "")
  if (barcode && ![8, 12, 13, 14].includes(barcode.length)) return "O código de barras (GTIN) deve ter 8, 12, 13 ou 14 dígitos."
  if (Number(form.maximumStock || 0) > 0 && Number(form.maximumStock) < Number(form.minimumStock || 0)) return "O estoque máximo não pode ser menor que o mínimo."
  if (Number(form.grossWeight || 0) > 0 && Number(form.netWeight || 0) > Number(form.grossWeight)) return "O peso líquido não pode ser maior que o peso bruto."
  return ""
}

export function MaterialFormFields({ material, setMaterial, suppliers, existing, showStatus = false }: { material: Record<string, any>; setMaterial: (value: Record<string, any>) => void; suppliers: Supplier[]; existing?: Material; showStatus?: boolean }) {
  const set = (key: string) => (value: string) => setMaterial({ ...material, [key]: value })
  const { warehouses } = useWarehouses()
  const defaultWarehouse = warehouses.find((item) => item.isDefault)
  const readOnlyBox = (label: string, value: string) => <div className="space-y-2"><Label>{label}</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{value}</div></div>
  const quantity = (value?: number) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${material.unit || ""}`.trim()
  const toggle = (key: string, label: string, hint: string) => (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <Checkbox checked={Boolean(material[key])} onCheckedChange={(checked) => setMaterial({ ...material, [key]: checked === true })} />
      <div><Label>{label}</Label><p className="text-xs text-muted-foreground">{hint}</p></div>
    </div>
  )
  const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const cost = Number(String(material.costPrice || 0).replace(",", ".")) || 0
  const sale = Number(String(material.salePrice || 0).replace(",", ".")) || 0
  const margin = profitMargin(cost, sale)
  const markup = cost > 0 && sale > 0 ? `${(((sale - cost) / cost) * 100).toFixed(1).replace(".", ",")}%` : "-"
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Identificação</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Tipo do item" value={material.itemType || "Produto"} onChange={(value) => setMaterial({ ...material, itemType: value, ...(value === "Materia-prima" && !existing ? { allowsSale: false, spedItemType: "01" } : {}), ...(value === "Kit" && !existing ? { spedItemType: "04" } : {}) })} options={itemTypeOptions} />
          <TextField label="SKU / código interno" value={material.internalCode} onChange={set("internalCode")} />
          <TextField label="Nome do produto" value={material.name} onChange={set("name")} />
          <TextField label="Unidade comercial" value={material.unit} onChange={set("unit")} placeholder="Ex.: UN, PC, M, KG, L, CJ" />
          <TextField label="Categoria" value={material.category} onChange={set("category")} placeholder="Ex.: Carrocerias, Eixos, Iluminação" />
          <TextField label="Subcategoria" value={material.subcategory} onChange={set("subcategory")} />
          <TextField label="Marca" value={material.brand} onChange={set("brand")} />
          <TextField label="Fabricante" value={material.manufacturer} onChange={set("manufacturer")} />
          <TextField label="Código de barras (GTIN/EAN)" value={material.barcode} onChange={set("barcode")} />
          {showStatus ? <SelectField label="Status" value={material.status} onChange={set("status")} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} /> : null}
        </div>
        <TextAreaField label="Descrição completa" value={material.description} onChange={set("description")} rows={3} />
        <div className="grid gap-3 md:grid-cols-2">
          {toggle("allowsSale", "Permite venda?", "Aparece em orçamentos e vendas; exige preço de venda e NCM.")}
          {toggle("controlsStock", "Controla estoque?", "Desmarque para itens sem saldo (ex.: itens sob encomenda).")}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Dados fiscais do produto</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="NCM" value={material.ncm} onChange={set("ncm")} placeholder="8 dígitos" />
          <TextField label="CEST" value={material.cest} onChange={set("cest")} placeholder="7 dígitos, quando houver ST" />
          <SelectField label="Origem da mercadoria" value={material.origin} onChange={set("origin")} options={materialOriginOptions} />
          <SelectField label="Tipo de item (SPED)" value={material.spedItemType} onChange={set("spedItemType")} options={materialSpedItemTypeOptions} />
        </div>
        {existing ? <FiscalRulesEditor materialId={existing.id} /> : <p className="text-xs text-muted-foreground">CFOP, CST/CSOSN e classificação IBS/CBS são definidos por operação, regime e vigência em "Regras fiscais por operação", disponíveis depois de salvar o item.</p>}
      </section>
      {material.controlsStock ? <section className="space-y-3">
        <h3 className="text-sm font-semibold">Estoque e logística</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField label="Depósito / almoxarifado" value={material.warehouseId || defaultWarehouse?.id || "nenhum"} onChange={(value) => setMaterial({ ...material, warehouseId: value === "nenhum" ? "" : value })} options={warehouses.length ? warehouses.filter((item) => item.status === "Ativo" || item.id === material.warehouseId).map((item) => ({ value: item.id, label: item.name })) : [{ value: "nenhum", label: "Depósito principal" }]} />
          {existing ? readOnlyBox("Quantidade física", quantity(stockOf(existing))) : <TextField label="Saldo inicial" type="number" value={material.currentStock} onChange={set("currentStock")} />}
          {existing ? readOnlyBox("Reservada / disponível", `${quantity(existing.reservedStock)} / ${quantity(materialAvailable(existing))}`) : null}
          <TextField label="Estoque mínimo" type="number" value={material.minimumStock} onChange={set("minimumStock")} />
          <TextField label="Estoque máximo" type="number" value={material.maximumStock} onChange={set("maximumStock")} />
          <TextField label="Ponto de reposição" type="number" value={material.reorderPoint} onChange={set("reorderPoint")} />
          <TextField label="Localização no depósito" value={material.location} onChange={set("location")} placeholder="Corredor / prateleira / posição" />
        </div>
        {existing ? <p className="text-xs text-muted-foreground">O saldo muda apenas por movimentação de estoque (entrada, saída, transferência, ajuste, produção...).</p> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {toggle("controlsLot", "Controla lote", "Exige número do lote nas entradas.")}
          {toggle("controlsSerial", "Controla número de série", "Exige número de série em toda movimentação.")}
          {toggle("controlsExpiry", "Controla validade", "Exige data de validade nas entradas.")}
        </div>
      </section> : null}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Pesos e dimensões</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="Peso bruto (kg)" type="number" value={material.grossWeight} onChange={set("grossWeight")} />
          <TextField label="Peso líquido (kg)" type="number" value={material.netWeight} onChange={set("netWeight")} />
          <TextField label="Altura (cm)" type="number" value={material.height} onChange={set("height")} />
          <TextField label="Largura (cm)" type="number" value={material.width} onChange={set("width")} />
          <TextField label="Comprimento (cm)" type="number" value={material.length} onChange={set("length")} />
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Preços, fornecedor e garantia</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="Preço de custo (R$)" type="number" value={material.costPrice} onChange={set("costPrice")} />
          <TextField label="Preço de venda (R$)" type="number" value={material.salePrice} onChange={set("salePrice")} />
          {readOnlyBox("Margem de lucro / markup", `${margin === null ? "-" : `${margin.toLocaleString("pt-BR")}%`} / ${markup}`)}
          {existing && material.controlsStock ? readOnlyBox("Custo médio", brl(existing.averageCost || 0)) : null}
          {existing && material.controlsStock ? readOnlyBox("Último custo de compra", brl(existing.lastPurchaseCost || 0)) : null}
          <TextField label="Garantia (meses)" type="number" value={material.warrantyMonths} onChange={set("warrantyMonths")} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SearchableSelectField label="Fornecedor principal" value={material.supplierId || "nenhum"} onChange={(value) => setMaterial({ ...material, supplierId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Nenhum" }, ...suppliers.filter((item) => item.status !== "Inativo").map((item) => ({ value: item.id, label: item.document ? `${item.name} - ${item.document}` : item.name }))]} />
          <TextField label="Código no fornecedor" value={material.supplierCode} onChange={set("supplierCode")} />
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Foto e ficha técnica</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <UploadField label="Foto" value={material.photoUrl || ""} onChange={(url) => setMaterial({ ...material, photoUrl: url })} accept="image/jpeg,image/png,image/webp" />
          <UploadField label="Ficha técnica (PDF ou imagem)" value={material.technicalSheetUrl || ""} onChange={(url) => setMaterial({ ...material, technicalSheetUrl: url })} />
        </div>
      </section>
      <TextAreaField label="Observações" value={material.notes} onChange={set("notes")} />
    </div>
  )
}
