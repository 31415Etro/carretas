// Cadastro de matéria-prima: formulário, validação (usada na tela E no servidor) e conversões. Funções puras (testáveis).
// Regras: matéria-prima é de consumo interno por padrão; "Disponível para venda" liga os campos comerciais e a validação os exige.

export const RAW_MATERIAL_UNITS = ["UN", "M", "M2", "M3", "KG", "L", "PC", "CX", "KIT", "PAR", "JG", "ROLO", "BARRA", "CHAPA"] as const
export const RAW_MATERIAL_KINDS = ["Aço", "Alumínio", "Madeira", "Elétrica", "Fixação", "Pneumático", "Tinta e acabamento", "Borracha e plástico", "Iluminação", "Embalagem", "Outro"] as const
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/
export const GENERATED_SKU_PATTERN = /^MP-\d{6}$/

export type SupplierLinkForm = { supplierId: string; supplierName?: string; supplierCode: string; isPrimary: boolean; lastCost: string; leadTimeDays: string; minPurchaseQty: string; notes: string }
export type RawMaterialForm = {
  name: string; description: string
  sku: string; autoSku: boolean
  category: string; subcategory: string; materialKind: string; status: "Ativo" | "Inativo"
  unit: string
  length: string; width: string; height: string; thickness: string; diameter: string; netWeight: string; grossWeight: string
  attributes: Array<{ key: string; value: string }>
  suppliers: SupplierLinkForm[]
  costPrice: string
  minimumStock: string; maximumStock: string; reorderPoint: string; warehouseId: string; leadTimeDays: string; minPurchaseQty: string
  controlsLot: boolean; controlsSerial: boolean; controlsExpiry: boolean
  ncm: string; ncmDescription: string; ncmSource: string; ncmValidFrom: string; ncmConfirmed: boolean
  allowsSale: boolean; salePrice: string
  photoUrl: string; technicalSheetUrl: string
  notes: string
  skuChangeReason: string
}

export const emptyRawMaterialForm = (): RawMaterialForm => ({
  name: "", description: "", sku: "", autoSku: true, category: "", subcategory: "", materialKind: "", status: "Ativo", unit: "UN",
  length: "", width: "", height: "", thickness: "", diameter: "", netWeight: "", grossWeight: "", attributes: [], suppliers: [],
  costPrice: "", minimumStock: "", maximumStock: "", reorderPoint: "", warehouseId: "", leadTimeDays: "", minPurchaseQty: "",
  controlsLot: false, controlsSerial: false, controlsExpiry: false,
  ncm: "", ncmDescription: "", ncmSource: "", ncmValidFrom: "", ncmConfirmed: false, allowsSale: false, salePrice: "",
  photoUrl: "", technicalSheetUrl: "", notes: "", skuChangeReason: "",
})

/** "1.234,56" ou "12,5" ou "12.5" -> número; vazio -> null; inválido -> NaN. */
export function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN
  const text = value.trim()
  if (!text) return null
  const normalized = /,/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export const digitsOnly = (value: string) => String(value || "").replace(/\D/g, "")
export const formatNcm = (value: string) => {
  const digits = digitsOnly(value)
  return digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}` : value
}

export type FieldErrors = Partial<Record<string, string>>

/** Valida o formulário. A mesma função roda na tela (feedback) e na API (garantia), então as regras nunca divergem. */
export function validateRawMaterial(form: RawMaterialForm, options: { editing?: boolean; hasHistory?: boolean; originalSku?: string } = {}): FieldErrors {
  const errors: FieldErrors = {}
  // cadastro sem travas: só o nome identifica o item. Unidade vazia vira UN, SKU vazio vira automático, NCM/fiscal/venda/fornecedor são opcionais
  if (!form.name.trim()) errors.name = "Informe o nome da matéria-prima."
  const numeric: Array<[keyof RawMaterialForm, string]> = [
    ["length", "Comprimento"], ["width", "Largura"], ["height", "Altura"], ["thickness", "Espessura"], ["diameter", "Diâmetro"], ["netWeight", "Peso líquido"], ["grossWeight", "Peso bruto"],
    ["costPrice", "Custo de aquisição"], ["minimumStock", "Estoque mínimo"], ["maximumStock", "Estoque máximo"], ["reorderPoint", "Ponto de reposição"], ["minPurchaseQty", "Compra mínima"],
  ]
  for (const [key, label] of numeric) {
    const value = parseNumber(form[key] as string)
    if (value !== null && (Number.isNaN(value) || value < 0)) errors[key] = `${label} deve ser um número maior ou igual a zero.`
  }
  const lead = parseNumber(form.leadTimeDays)
  if (lead !== null && (Number.isNaN(lead) || lead < 0 || !Number.isInteger(lead))) errors.leadTimeDays = "Prazo de reposição deve ser um número inteiro de dias."
  for (const link of form.suppliers) {
    for (const [key, label] of [["lastCost", "custo"], ["leadTimeDays", "prazo"], ["minPurchaseQty", "compra mínima"]] as const) {
      const value = parseNumber(link[key])
      if (value !== null && (Number.isNaN(value) || value < 0)) errors.suppliers = `Fornecedor: ${label} deve ser um número maior ou igual a zero.`
    }
  }
  return errors
}

const numOrNull = (value: string) => {
  const parsed = parseNumber(value)
  return parsed === null || Number.isNaN(parsed) ? null : parsed
}
const numOrZero = (value: string) => numOrNull(value) ?? 0

/** Corpo enviado à API (e, no servidor, convertido na linha de `materials`). */
export function rawMaterialPayload(form: RawMaterialForm) {
  return {
    name: form.name.trim(), description: form.description.trim(), sku: form.autoSku ? "" : form.sku.trim(), autoSku: form.autoSku || !form.sku.trim(),
    category: form.category.trim(), subcategory: form.subcategory.trim(), materialKind: form.materialKind, status: form.status, unit: form.unit.trim().toUpperCase() || "UN",
    length: numOrZero(form.length), width: numOrZero(form.width), height: numOrZero(form.height), thickness: numOrNull(form.thickness), diameter: numOrNull(form.diameter),
    netWeight: numOrZero(form.netWeight), grossWeight: numOrZero(form.grossWeight),
    attributes: Object.fromEntries(form.attributes.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()])),
    suppliers: form.suppliers.filter((link, index, all) => link.supplierId && all.findIndex((other) => other.supplierId === link.supplierId) === index).map((link, index, list) => ({
      supplier_id: link.supplierId, supplier_code: link.supplierCode.trim(), is_primary: link.isPrimary && list.findIndex((other) => other.isPrimary) === index, last_cost: numOrNull(link.lastCost),
      lead_time_days: numOrNull(link.leadTimeDays), min_purchase_qty: numOrNull(link.minPurchaseQty), notes: link.notes.trim(),
    })),
    costPrice: numOrZero(form.costPrice), minimumStock: numOrZero(form.minimumStock), maximumStock: numOrZero(form.maximumStock), reorderPoint: numOrZero(form.reorderPoint),
    warehouseId: form.warehouseId, leadTimeDays: numOrNull(form.leadTimeDays), minPurchaseQty: numOrNull(form.minPurchaseQty),
    controlsLot: form.controlsLot, controlsSerial: form.controlsSerial, controlsExpiry: form.controlsExpiry,
    ncm: digitsOnly(form.ncm).length === 8 ? digitsOnly(form.ncm) : "", ncmDescription: form.ncmDescription, ncmSource: form.ncmSource, ncmValidFrom: form.ncmValidFrom, ncmConfirmed: form.ncmConfirmed,
    allowsSale: form.allowsSale && numOrZero(form.salePrice) > 0, salePrice: form.allowsSale ? numOrZero(form.salePrice) : 0,
    photoUrl: form.photoUrl, technicalSheetUrl: form.technicalSheetUrl, notes: form.notes.trim(), skuChangeReason: form.skuChangeReason.trim(),
  }
}
export type RawMaterialPayload = ReturnType<typeof rawMaterialPayload>

/** Linha de `materials` a partir do corpo validado. Não inclui o SKU nem o NCM confirmado (tratados à parte, com regras próprias). */
export function materialRowFromPayload(body: RawMaterialPayload) {
  return {
    item_type: "Materia-prima", name: body.name, description: body.description || null, category: body.category || null, subcategory: body.subcategory || null,
    material_kind: body.materialKind || null, status: body.status, unit: body.unit,
    length: body.length, width: body.width, height: body.height, thickness: body.thickness, diameter: body.diameter, net_weight: body.netWeight, gross_weight: body.grossWeight,
    technical_attributes: body.attributes, cost_price: body.costPrice, minimum_stock: body.minimumStock, maximum_stock: body.maximumStock, reorder_point: body.reorderPoint,
    warehouse_id: body.warehouseId || null, lead_time_days: body.leadTimeDays, min_purchase_qty: body.minPurchaseQty,
    controls_lot: body.controlsLot, controls_serial: body.controlsSerial, controls_expiry: body.controlsExpiry, controls_stock: true,
    allows_sale: body.allowsSale, sale_price: body.allowsSale ? body.salePrice : 0,
    photo_url: body.photoUrl || null, technical_sheet_url: body.technicalSheetUrl || null, notes: body.notes || null,
    ncm: body.ncm || null,
  }
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
const numText = (value: unknown) => (value === null || value === undefined || Number(value) === 0 ? "" : String(value))

/** Linha de `materials` (+ fornecedores) -> formulário de edição. */
export function formFromMaterial(material: Record<string, any>, suppliers: Array<Record<string, any>> = []): RawMaterialForm {
  return {
    ...emptyRawMaterialForm(),
    name: text(material.name), description: text(material.description), sku: text(material.internal_code), autoSku: false,
    category: text(material.category), subcategory: text(material.subcategory), materialKind: text(material.material_kind), status: material.status === "Inativo" ? "Inativo" : "Ativo",
    unit: text(material.unit) || "UN", length: numText(material.length), width: numText(material.width), height: numText(material.height), thickness: numText(material.thickness),
    diameter: numText(material.diameter), netWeight: numText(material.net_weight), grossWeight: numText(material.gross_weight),
    attributes: Object.entries((material.technical_attributes || {}) as Record<string, string>).map(([key, value]) => ({ key, value: text(value) })),
    suppliers: suppliers.map((link) => ({
      supplierId: text(link.supplier_id), supplierName: text(link.supplier_name), supplierCode: text(link.supplier_code), isPrimary: Boolean(link.is_primary),
      lastCost: numText(link.last_cost), leadTimeDays: numText(link.lead_time_days), minPurchaseQty: numText(link.min_purchase_qty), notes: text(link.notes),
    })),
    costPrice: numText(material.cost_price), minimumStock: numText(material.minimum_stock), maximumStock: numText(material.maximum_stock), reorderPoint: numText(material.reorder_point),
    warehouseId: text(material.warehouse_id), leadTimeDays: numText(material.lead_time_days), minPurchaseQty: numText(material.min_purchase_qty),
    controlsLot: Boolean(material.controls_lot), controlsSerial: Boolean(material.controls_serial), controlsExpiry: Boolean(material.controls_expiry),
    ncm: formatNcm(text(material.ncm)), ncmDescription: text(material.ncm_description), ncmSource: text(material.ncm_source), ncmValidFrom: text(material.ncm_valid_from),
    ncmConfirmed: Boolean(material.ncm_confirmed_at), allowsSale: Boolean(material.allows_sale), salePrice: numText(material.sale_price),
    photoUrl: text(material.photo_url), technicalSheetUrl: text(material.technical_sheet_url), notes: text(material.notes), skuChangeReason: "",
  }
}

/** Situação do estoque em palavras, para a lista e o cabeçalho da página de detalhes. */
export function stockSituation(row: { physical: number; available: number; incoming: number; minimumStock: number; reorderPoint: number }) {
  if (row.minimumStock > 0 && row.physical < row.minimumStock) return { key: "abaixo-minimo", label: "Abaixo do mínimo", tone: "danger" as const }
  if (row.reorderPoint > 0 && row.available + row.incoming <= row.reorderPoint) return { key: "repor", label: "Repor", tone: "warning" as const }
  if (row.physical <= 0) return { key: "sem-saldo", label: "Sem saldo", tone: "muted" as const }
  return { key: "ok", label: "Normal", tone: "ok" as const }
}

/** Mensagem amigável quando as funções/colunas das migrações 217-220 ainda não estão no banco. */
export const RAW_MATERIAL_MIGRATION_HINT = "A estrutura de matéria-prima ainda não está instalada no banco. Rode scripts/217, 218, 219 e 220 no SQL Editor do Supabase (primeiro no staging)."
export const isRawMaterialStructureMissing = (message: string) => /Could not find the function|does not exist|schema cache|raw_material_|next_item_sku|material_availability/i.test(message || "")
