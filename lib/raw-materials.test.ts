import assert from "node:assert/strict"
import test from "node:test"
import { emptyRawMaterialForm, formFromMaterial, materialRowFromPayload, parseNumber, rawMaterialPayload, stockSituation, validateRawMaterial, type RawMaterialForm } from "./raw-materials.ts"

const valid = (patch: Partial<RawMaterialForm> = {}): RawMaterialForm => ({ ...emptyRawMaterialForm(), name: "Perfil U 6mm", unit: "M", ...patch })

test("formulário mínimo é válido: SKU automático, consumo interno e sem preço de venda", () => {
  assert.deepEqual(validateRawMaterial(valid()), {})
  const body = rawMaterialPayload(valid())
  assert.equal(body.autoSku, true)
  assert.equal(body.sku, "")
  assert.equal(body.allowsSale, false)
  assert.equal(materialRowFromPayload(body).sale_price, 0)
})

test("nome, unidade e SKU manual são exigidos; SKU com espaço é recusado", () => {
  assert.ok(validateRawMaterial(valid({ name: "ab" })).name)
  assert.ok(validateRawMaterial(valid({ unit: "" })).unit)
  assert.ok(validateRawMaterial(valid({ autoSku: false, sku: "" })).sku)
  assert.ok(validateRawMaterial(valid({ autoSku: false, sku: "COM ESPAÇO" })).sku)
  assert.deepEqual(validateRawMaterial(valid({ autoSku: false, sku: "MP-000123" })), {})
})

test("números: vírgula decimal, negativos e inconsistências de estoque", () => {
  assert.equal(parseNumber("1.234,56"), 1234.56)
  assert.equal(parseNumber("12,5"), 12.5)
  assert.equal(parseNumber(""), null)
  assert.ok(Number.isNaN(parseNumber("abc") as number))
  assert.ok(validateRawMaterial(valid({ costPrice: "-1" })).costPrice)
  assert.ok(validateRawMaterial(valid({ minimumStock: "10", maximumStock: "5" })).maximumStock)
  assert.ok(validateRawMaterial(valid({ maximumStock: "50", reorderPoint: "60" })).reorderPoint)
  assert.ok(validateRawMaterial(valid({ leadTimeDays: "2,5" })).leadTimeDays)
  assert.deepEqual(validateRawMaterial(valid({ minimumStock: "10", reorderPoint: "15", maximumStock: "100", costPrice: "12,90", leadTimeDays: "7" })), {})
})

test("NCM tem 8 dígitos e na criação precisa estar confirmado por uma pessoa", () => {
  assert.ok(validateRawMaterial(valid({ ncm: "1234", ncmConfirmed: true })).ncm)
  assert.ok(validateRawMaterial(valid({ ncm: "7216.21.00", ncmConfirmed: false })).ncm) // sugerido, mas não confirmado
  assert.deepEqual(validateRawMaterial(valid({ ncm: "7216.21.00", ncmConfirmed: true })), {})
})

test("Disponível para venda exige preço e NCM; desligado, o preço vai zerado", () => {
  const errors = validateRawMaterial(valid({ allowsSale: true }))
  assert.ok(errors.salePrice)
  assert.ok(errors.ncm)
  assert.deepEqual(validateRawMaterial(valid({ allowsSale: true, salePrice: "25,00", ncm: "7216.21.00", ncmConfirmed: true })), {})
  assert.equal(rawMaterialPayload(valid({ allowsSale: false, salePrice: "99" })).salePrice, 0)
})

test("fornecedores: um principal, sem repetir e sem linha vazia", () => {
  const link = (supplierId: string, isPrimary = false) => ({ supplierId, supplierCode: "", isPrimary, lastCost: "", leadTimeDays: "", minPurchaseQty: "", notes: "" })
  assert.ok(validateRawMaterial(valid({ suppliers: [link("a", true), link("b", true)] })).suppliers)
  assert.ok(validateRawMaterial(valid({ suppliers: [link("a"), link("a")] })).suppliers)
  assert.ok(validateRawMaterial(valid({ suppliers: [link("")] })).suppliers)
  assert.deepEqual(validateRawMaterial(valid({ suppliers: [link("a", true), link("b")] })), {})
  assert.equal(rawMaterialPayload(valid({ suppliers: [link("a", true), link("")] })).suppliers.length, 1)
})

test("troca de SKU em item com histórico exige motivo", () => {
  const form = valid({ autoSku: false, sku: "NOVO-1" })
  assert.ok(validateRawMaterial(form, { editing: true, hasHistory: true, originalSku: "ANTIGO-1" }).skuChangeReason)
  assert.deepEqual(validateRawMaterial({ ...form, skuChangeReason: "Padronização" }, { editing: true, hasHistory: true, originalSku: "ANTIGO-1" }), {})
  assert.deepEqual(validateRawMaterial(form, { editing: true, hasHistory: false, originalSku: "ANTIGO-1" }), {})
})

test("da linha do banco para o formulário e de volta, sem perder dados", () => {
  const row = { name: "Chapa 3mm", internal_code: "MP-000007", unit: "UN", category: "Aço", thickness: 3, minimum_stock: 10, reorder_point: 20, ncm: "72162100", ncm_confirmed_at: "2026-10-22T10:00:00Z",
    technical_attributes: { Norma: "NBR 6650", Acabamento: "Laminada a frio" }, allows_sale: false, status: "Ativo" }
  const form = formFromMaterial(row, [{ supplier_id: "s1", supplier_name: "Aços do Sul", is_primary: true, last_cost: 11.5, lead_time_days: 5 }])
  assert.equal(form.ncm, "7216.21.00")
  assert.equal(form.ncmConfirmed, true)
  assert.deepEqual(form.attributes, [{ key: "Norma", value: "NBR 6650" }, { key: "Acabamento", value: "Laminada a frio" }])
  assert.equal(form.suppliers[0].supplierName, "Aços do Sul")
  const body = rawMaterialPayload(form)
  assert.deepEqual(body.attributes, { Norma: "NBR 6650", Acabamento: "Laminada a frio" })
  assert.equal(body.suppliers[0].last_cost, 11.5)
  assert.equal(materialRowFromPayload(body).item_type, "Materia-prima")
})

test("situação do estoque: abaixo do mínimo, repor, sem saldo e normal", () => {
  assert.equal(stockSituation({ physical: 5, available: 5, incoming: 0, minimumStock: 10, reorderPoint: 20 }).key, "abaixo-minimo")
  assert.equal(stockSituation({ physical: 15, available: 15, incoming: 0, minimumStock: 10, reorderPoint: 20 }).key, "repor")
  assert.equal(stockSituation({ physical: 15, available: 5, incoming: 30, minimumStock: 0, reorderPoint: 20 }).key, "ok")
  assert.equal(stockSituation({ physical: 0, available: 0, incoming: 0, minimumStock: 0, reorderPoint: 0 }).key, "sem-saldo")
})
