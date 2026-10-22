// Kits e composições: formulário, validação (tela e servidor), custo em tempo real e conversões. Funções puras (testáveis).
// O custo daqui espelha o do banco (kit_version_cost): quantidade convertida para a unidade do material x (1 + perda) x custo vigente.
import { parseNumber } from "./raw-materials.ts"

export type UnitFactor = { unit: string; factor: number }
export type MaterialOption = { id: string; sku: string; name: string; category: string | null; unit: string; unit_cost: number; available: number; units: UnitFactor[] }

export type ComponentForm = {
  key: string
  componentId: string
  sku: string
  name: string
  baseUnit: string
  unitCost: number
  available: number
  units: UnitFactor[]
  quantity: string
  unit: string
  lossPercent: string
  notes: string
}
export type KitForm = {
  name: string; sku: string; autoSku: boolean; category: string; description: string; status: "Ativo" | "Inativo"; photoUrl: string; notes: string
  components: ComponentForm[]
}

export const emptyKitForm = (): KitForm => ({ name: "", sku: "", autoSku: true, category: "", description: "", status: "Ativo", photoUrl: "", notes: "", components: [] })

let counter = 0
export const newKey = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`

export function componentFromOption(option: MaterialOption): ComponentForm {
  return { key: newKey(), componentId: option.id, sku: option.sku, name: option.name, baseUnit: option.unit, unitCost: Number(option.unit_cost || 0), available: Number(option.available || 0), units: option.units?.length ? option.units : [{ unit: option.unit.toUpperCase(), factor: 1 }], quantity: "", unit: option.unit.toUpperCase(), lossPercent: "", notes: "" }
}

const factorOf = (component: Pick<ComponentForm, "units" | "unit">) => component.units.find((entry) => entry.unit === component.unit.toUpperCase())?.factor

/** Custo da linha: quantidade na unidade escolhida -> unidade do material, com perda técnica. NaN se a quantidade ou a conversão não forem válidas. */
export function lineCost(component: ComponentForm) {
  const quantity = parseNumber(component.quantity)
  const loss = parseNumber(component.lossPercent) ?? 0
  const factor = factorOf(component)
  if (quantity === null || Number.isNaN(quantity) || quantity <= 0 || factor === undefined || Number.isNaN(loss)) return Number.NaN
  return quantity * factor * (1 + loss / 100) * component.unitCost
}
export const kitCost = (components: ComponentForm[]) => Math.round(components.reduce((sum, component) => sum + (Number.isNaN(lineCost(component)) ? 0 : lineCost(component)), 0) * 10_000) / 10_000
export const requiredWithLoss = (component: ComponentForm) => {
  const quantity = parseNumber(component.quantity)
  const loss = parseNumber(component.lossPercent) ?? 0
  const factor = factorOf(component)
  return quantity === null || Number.isNaN(quantity) || factor === undefined ? Number.NaN : quantity * factor * (1 + loss / 100)
}

export type KitErrors = Partial<Record<string, string>>

/** Valida o formulário; a chave "components" é o erro geral da composição e "c:<key>" o erro de uma linha. */
export function validateKit(form: KitForm, options: { requireComponents?: boolean } = {}): KitErrors {
  const errors: KitErrors = {}
  if (form.name.trim().length < 3) errors.name = "Informe o nome do kit (mínimo 3 letras)."
  if (!form.autoSku && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(form.sku.trim())) errors.sku = "SKU inválido: use letras, números, ponto, hífen ou barra, sem espaços (até 40 caracteres)."
  if ((options.requireComponents ?? true) && form.components.length === 0) errors.components = "Adicione ao menos uma matéria-prima à composição."
  const seen = new Set<string>()
  for (const component of form.components) {
    const quantity = parseNumber(component.quantity)
    const loss = parseNumber(component.lossPercent)
    if (seen.has(component.componentId)) errors[`c:${component.key}`] = "Esta matéria-prima já está na composição."
    else if (quantity === null || Number.isNaN(quantity) || quantity <= 0) errors[`c:${component.key}`] = "Informe a quantidade (maior que zero)."
    else if (factorOf(component) === undefined) errors[`c:${component.key}`] = `Não há conversão de ${component.unit} para ${component.baseUnit}.`
    else if (loss !== null && (Number.isNaN(loss) || loss < 0 || loss >= 100)) errors[`c:${component.key}`] = "A perda deve estar entre 0% e menos de 100%."
    seen.add(component.componentId)
  }
  return errors
}

/** Corpo enviado à função kit_save. */
export function kitPayload(form: KitForm, options: { kitId?: string; versionId?: string; activate?: boolean; withComponents?: boolean } = {}) {
  const withComponents = options.withComponents ?? true
  return {
    kit_id: options.kitId || null, version_id: options.versionId || null, name: form.name.trim(), sku: form.autoSku ? "" : form.sku.trim(), auto_sku: form.autoSku,
    category: form.category.trim(), description: form.description.trim(), status: form.status, photo_url: form.photoUrl, notes: form.notes.trim(), activate: Boolean(options.activate),
    ...(withComponents ? { components: form.components.map((component) => ({
      component_id: component.componentId, quantity: parseNumber(component.quantity), unit: component.unit.toUpperCase(), loss_percent: parseNumber(component.lossPercent) ?? 0, notes: component.notes.trim() || null,
    })) } : {}),
  }
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))

/** Detalhe do banco -> formulário de edição (componentes da versão exibida). `options` traz as unidades aceitas por material, quando disponíveis. */
export function formFromKitDetail(detail: { kit: Record<string, any>; components: Array<Record<string, any>> }, unitsByMaterial: Record<string, UnitFactor[]> = {}): KitForm {
  return {
    name: text(detail.kit.name), sku: text(detail.kit.internal_code), autoSku: false, category: text(detail.kit.category), description: text(detail.kit.description),
    status: detail.kit.status === "Inativo" ? "Inativo" : "Ativo", photoUrl: text(detail.kit.photo_url), notes: "",
    components: detail.components.map((component) => ({
      key: newKey(), componentId: text(component.component_id), sku: text(component.sku), name: text(component.name), baseUnit: text(component.material_unit),
      unitCost: Number(component.unit_cost || 0), available: Number(component.available || 0),
      units: (Array.isArray(component.units) && component.units.length ? component.units.map((entry: Record<string, unknown>) => ({ unit: text(entry.unit).toUpperCase(), factor: Number(entry.factor) })) : null) || unitsByMaterial[component.component_id] || [{ unit: text(component.material_unit).toUpperCase(), factor: 1 }, ...(text(component.unit).toUpperCase() !== text(component.material_unit).toUpperCase() && Number(component.quantity) > 0 ? [{ unit: text(component.unit).toUpperCase(), factor: Number(component.quantity_in_material_unit) / Number(component.quantity) }] : [])],
      quantity: text(component.quantity), unit: text(component.unit).toUpperCase(), lossPercent: Number(component.loss_percent) ? text(component.loss_percent) : "", notes: text(component.notes),
    })),
  }
}

export const KIT_MIGRATION_HINT = "A estrutura de kits ainda não está instalada no banco. Rode os scripts 217 a 221 no SQL Editor do Supabase (primeiro no staging)."
export const isKitStructureMissing = (message: string) => /Could not find the function|does not exist|schema cache|kit_(save|list|detail|material_options|compare_versions)|convert_quantity/i.test(message || "")

export const versionStatusLabel = (status: string) => ({ Rascunho: "Rascunho", Ativa: "Vigente", Obsoleta: "Obsoleta" }[status] || status)
