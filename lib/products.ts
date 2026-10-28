// Produtos finais: formulário, perfis de especificação por categoria, validação (tela e servidor), margem e montagem do corpo de product_save. Funções puras (testáveis).
import { parseNumber } from "./raw-materials.ts"

export type SpecField = { key: string; label: string; unit?: string; kind?: "number" | "integer" | "text" }
export type SpecProfile = { id: string; label: string; fields: SpecField[] }

const dimensions: SpecField[] = [
  { key: "length", label: "Comprimento", unit: "cm" }, { key: "width", label: "Largura", unit: "cm" }, { key: "height", label: "Altura", unit: "cm" },
  { key: "net_weight", label: "Peso vazio", unit: "kg" }, { key: "gross_weight", label: "Peso bruto total", unit: "kg" },
]
const trailer: SpecField[] = [
  ...dimensions, { key: "payload_capacity", label: "Capacidade de carga", unit: "kg" }, { key: "axle_count", label: "Eixos", kind: "integer" },
  { key: "finish_type", label: "Acabamento", kind: "text" }, { key: "structural_notes", label: "Características estruturais", kind: "text" },
]
/** Cada categoria mostra só os campos que fazem sentido: nada de especificação de carreta em produto que não é carreta. */
export const specProfiles: SpecProfile[] = [
  { id: "carreta", label: "Carretas e reboques", fields: trailer },
  { id: "implemento", label: "Implementos e acessórios", fields: [...dimensions, { key: "finish_type", label: "Acabamento", kind: "text" }] },
  { id: "geral", label: "Outros produtos", fields: [{ key: "net_weight", label: "Peso", unit: "kg" }, { key: "finish_type", label: "Acabamento", kind: "text" }] },
]
export function specProfileFor(category: string) {
  const name = category.trim().toLowerCase()
  if (/carret|reboque|trailer|jet|n[aá]utic|semirreboque/.test(name)) return specProfiles[0]
  if (/implement|acess|equip|plataforma|carroceria/.test(name)) return specProfiles[1]
  return specProfiles[2]
}

export type KitLinkForm = {
  key: string; kitId: string; sku: string; name: string; quantity: string; pinVersion: boolean
  activeVersion: number | null; cost: number; componentsCount: number
}
export type StructureForm = { kits: KitLinkForm[]; laborCost: string; laborMinutes: string; overheadCost: string; otherCost: string; estimatedDays: string; notes: string; changeReason: string; versionId: string; activate: boolean }
export type ProductForm = {
  name: string; sku: string; autoSku: boolean; internalRef: string; model: string; category: string; productLine: string; description: string; status: "Ativo" | "Inativo"
  photoUrl: string; technicalSheetUrl: string; documents: Array<{ name: string; url: string; kind: string }>
  specs: Record<string, string>; engineeringNotes: string
  salePrice: string; unit: string; leadTimeDays: string; warrantyMonths: string; availableForQuote: boolean; allowsSale: boolean; makeToOrder: boolean
  ncm: string; ncmConfirmed: boolean; ncmDescription: string; ncmSource: string
  structure: StructureForm
}

export const emptyStructure = (): StructureForm => ({ kits: [], laborCost: "", laborMinutes: "", overheadCost: "", otherCost: "", estimatedDays: "", notes: "", changeReason: "", versionId: "", activate: false })
export const emptyProductForm = (): ProductForm => ({
  name: "", sku: "", autoSku: true, internalRef: "", model: "", category: "", productLine: "", description: "", status: "Ativo", photoUrl: "", technicalSheetUrl: "", documents: [],
  specs: {}, engineeringNotes: "", salePrice: "", unit: "UN", leadTimeDays: "", warrantyMonths: "", availableForQuote: true, allowsSale: true, makeToOrder: false,
  ncm: "", ncmConfirmed: false, ncmDescription: "", ncmSource: "", structure: emptyStructure(),
})

let counter = 0
export const newLinkKey = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`

export type KitOption = { id: string; sku: string; name: string; version: number | null; version_id: string | null; cost: number; components_count: number }
export const linkFromOption = (option: KitOption): KitLinkForm => ({ key: newLinkKey(), kitId: option.id, sku: option.sku, name: option.name, quantity: "1", pinVersion: false, activeVersion: option.version, cost: Number(option.cost || 0), componentsCount: Number(option.components_count || 0) })

const money = (value: string) => parseNumber(value) ?? 0
/** Custo dos kits (custo do kit x quantidade) + mão de obra + indiretos + outros. Espelha product_bom_cost. */
export function structureCost(structure: StructureForm) {
  const materials = structure.kits.reduce((sum, link) => { const quantity = parseNumber(link.quantity); return sum + (quantity && !Number.isNaN(quantity) && quantity > 0 ? quantity * link.cost : 0) }, 0)
  const labor = money(structure.laborCost), overhead = money(structure.overheadCost), other = money(structure.otherCost)
  const total = Math.round((materials + labor + overhead + other) * 100) / 100
  return { materials: Math.round(materials * 100) / 100, labor, overhead, other, total }
}
/** Margem bruta em reais e %, sobre o preço de venda informado (preço manual: nunca é forçado pelo custo). */
export function margin(price: number, cost: number) {
  if (!Number.isFinite(price) || price <= 0) return { value: 0, percent: null as number | null }
  return { value: Math.round((price - cost) * 100) / 100, percent: Math.round(((price - cost) / price) * 10_000) / 100 }
}

export type ProductErrors = Partial<Record<string, string>>

export function validateProduct(form: ProductForm, options: { requireStructure?: boolean } = {}): ProductErrors {
  const errors: ProductErrors = {}
  // cadastro sem travas: só o nome identifica o produto; SKU vazio vira automático; NCM, preço, kits e estrutura são opcionais
  if (!form.name.trim()) errors.name = "Informe o nome comercial."
  const price = parseNumber(form.salePrice)
  if (price !== null && (Number.isNaN(price) || price < 0)) errors.salePrice = "Preço inválido."
  for (const [field, label] of [["leadTimeDays", "Prazo"], ["warrantyMonths", "Garantia"]] as const) {
    const value = parseNumber(form[field])
    if (value !== null && (Number.isNaN(value) || value < 0 || !Number.isInteger(value))) errors[field] = `${label}: informe um número inteiro (0 ou mais).`
  }
  for (const [key, value] of Object.entries(form.specs)) {
    const field = specProfileFor(form.category).fields.find((entry) => entry.key === key)
    if (!field || field.kind === "text" || !value.trim()) continue
    const number = parseNumber(value)
    if (number === null || Number.isNaN(number) || number < 0 || (field.kind === "integer" && !Number.isInteger(number))) errors[`spec:${key}`] = `${field.label}: informe um número válido.`
  }
  if (options.requireStructure) {
    for (const [key, label] of [["laborCost", "Mão de obra"], ["overheadCost", "Custos indiretos"], ["otherCost", "Outros custos"]] as const) {
      const value = parseNumber(form.structure[key])
      if (value !== null && (Number.isNaN(value) || value < 0)) errors[key] = `${label}: valor inválido.`
    }
  }
  return errors
}

/** Corpo da função product_save. `structure` só vai quando a estrutura foi alterada (senão o cadastro salva sem criar versão). */
export function productPayload(form: ProductForm, options: { productId?: string; withStructure?: boolean; user?: string } = {}) {
  const specs: Record<string, number | string | null> = {}
  for (const field of specProfileFor(form.category).fields) {
    const raw = form.specs[field.key] ?? ""
    specs[field.key] = field.kind === "text" ? raw.trim() : raw.trim() ? parseNumber(raw) : null
  }
  specs.engineering_notes = form.engineeringNotes.trim()
  const structure = form.structure
  return {
    product_id: options.productId || null, name: form.name.trim(), sku: form.autoSku ? "" : form.sku.trim(), auto_sku: form.autoSku || !form.sku.trim(), internal_ref: form.internalRef, model: form.model, category: form.category, product_line: form.productLine,
    description: form.description, status: form.status, photo_url: form.photoUrl, technical_sheet_url: form.technicalSheetUrl, documents: form.documents.filter((document) => document.url.trim()),
    specs, sale_price: parseNumber(form.salePrice) ?? 0, unit: form.unit || "UN", lead_time_days: parseNumber(form.leadTimeDays), warranty_months: parseNumber(form.warrantyMonths) ?? 0,
    available_for_quote: form.availableForQuote, allows_sale: form.allowsSale && (parseNumber(form.salePrice) ?? 0) > 0, make_to_order: form.makeToOrder,
    ncm: form.ncm.replace(/\D/g, "").length === 8 ? form.ncm.replace(/\D/g, "") : "", ncm_confirmed: true, ncm_description: form.ncmDescription, ncm_source: form.ncmSource, user: options.user || undefined,
    ...(options.withStructure && structure.kits.some((link) => link.kitId) ? { structure: {
      kits: structure.kits.filter((link, index, all) => link.kitId && all.findIndex((other) => other.kitId === link.kitId) === index).map((link) => ({ kit_id: link.kitId, quantity: (parseNumber(link.quantity) ?? 0) > 0 ? parseNumber(link.quantity) : 1, pin_version: link.pinVersion })),
      labor_cost: money(structure.laborCost), labor_minutes: parseNumber(structure.laborMinutes) ?? 0, overhead_cost: money(structure.overheadCost), other_cost: money(structure.otherCost),
      estimated_days: parseNumber(structure.estimatedDays) ?? 0, notes: structure.notes.trim(), change_reason: structure.changeReason.trim(), version_id: structure.versionId || undefined, activate: structure.activate,
    } } : {}),
  }
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
const numberText = (value: unknown) => (value === null || value === undefined || Number(value) === 0 ? "" : String(Number(value)))

/** Detalhe do banco -> formulário de edição (estrutura da versão exibida). */
export function formFromProductDetail(detail: Record<string, any>): ProductForm {
  const product = detail.product || {}
  const version = (detail.versions || []).find((entry: Record<string, any>) => entry.id === detail.shown_version_id)
  return {
    ...emptyProductForm(),
    name: text(product.name), sku: text(product.internal_code), autoSku: false, internalRef: text(product.internal_ref), model: text(product.product_model), category: text(product.category), productLine: text(product.product_line),
    description: text(product.description), status: product.status === "Inativo" ? "Inativo" : "Ativo", photoUrl: text(product.photo_url), technicalSheetUrl: text(product.technical_sheet_url),
    documents: (detail.documents || []).map((document: Record<string, any>) => ({ name: text(document.name), url: text(document.url), kind: text(document.kind) || "Outro" })),
    specs: {
      length: numberText(product.length), width: numberText(product.width), height: numberText(product.height), net_weight: numberText(product.net_weight), gross_weight: numberText(product.gross_weight),
      payload_capacity: numberText(product.payload_capacity), axle_count: numberText(product.axle_count), finish_type: text(product.finish_type), structural_notes: text(product.structural_notes),
    },
    engineeringNotes: text(product.engineering_notes), salePrice: numberText(product.sale_price), unit: text(product.unit) || "UN", leadTimeDays: numberText(product.lead_time_days), warrantyMonths: numberText(product.warranty_months),
    availableForQuote: product.available_for_quote !== false, allowsSale: product.allows_sale !== false, makeToOrder: Boolean(product.make_to_order),
    ncm: text(product.ncm), ncmConfirmed: Boolean(product.ncm && product.ncm_confirmed_by), ncmDescription: text(product.ncm_description), ncmSource: text(product.ncm_source),
    structure: {
      ...emptyStructure(),
      kits: (detail.kits || []).map((kit: Record<string, any>) => ({ key: newLinkKey(), kitId: text(kit.kit_id), sku: text(kit.sku), name: text(kit.name), quantity: text(Number(kit.quantity)), pinVersion: Boolean(kit.pinned_version_id), activeVersion: kit.kit_version ?? null, cost: Number(kit.kit_cost || 0), componentsCount: Number(kit.components_count || 0) })),
      laborCost: numberText(version?.labor_cost), laborMinutes: numberText(version?.labor_minutes), overheadCost: numberText(version?.overhead_cost), otherCost: numberText(version?.other_cost), estimatedDays: numberText(version?.estimated_production_days), notes: text(version?.notes),
    },
  }
}

export const PRODUCT_MIGRATION_HINT = "A engenharia de produtos ainda não está instalada no banco. Rode o script 222 no SQL Editor do Supabase (primeiro no staging)."
export const isProductStructureMissing = (message: string) => /Could not find the function|does not exist|schema cache|product_(save|list|detail|explosion|capacity_detail|kit_options|compare_versions|quote_snapshot)/i.test(message || "")
