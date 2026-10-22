import assert from "node:assert/strict"
import test from "node:test"
import { componentFromOption, emptyKitForm, formFromKitDetail, kitCost, kitPayload, lineCost, requiredWithLoss, validateKit, type KitForm, type MaterialOption } from "./kits.ts"

const perfil: MaterialOption = { id: "m1", sku: "MP-000001", name: "Perfil U", category: "Aço", unit: "M", unit_cost: 10, available: 50, units: [{ unit: "BARRA", factor: 6 }, { unit: "CM", factor: 0.01 }, { unit: "M", factor: 1 }, { unit: "MM", factor: 0.001 }] }
const parafuso: MaterialOption = { id: "m2", sku: "MP-000002", name: "Parafuso", category: "Fixação", unit: "UN", unit_cost: 0.5, available: 0, units: [{ unit: "UN", factor: 1 }] }
const withQty = (option: MaterialOption, quantity: string, unit?: string, lossPercent = "") => ({ ...componentFromOption(option), quantity, unit: unit || option.unit, lossPercent })
const kit = (patch: Partial<KitForm> = {}): KitForm => ({ ...emptyKitForm(), name: "Kit Chassi", components: [withQty(perfil, "6", "M", "5"), withQty(parafuso, "16")], ...patch })

test("custo em tempo real: quantidade x perda x custo, com conversão de unidade", () => {
  assert.equal(lineCost(withQty(perfil, "6", "M", "5")), 6 * 1.05 * 10) // 63
  assert.equal(lineCost(withQty(perfil, "150", "CM")), 1.5 * 10) // 150 cm = 1,5 m
  assert.equal(lineCost(withQty(perfil, "2", "BARRA")), 2 * 6 * 10) // barra de 6 m do cadastro do material
  assert.equal(kitCost(kit().components), 63 + 8)
  assert.equal(kitCost([withQty(perfil, "1,5", "M")]), 15) // vírgula decimal
  assert.ok(Number.isNaN(lineCost(withQty(perfil, "", "M")))) // sem quantidade: não entra na soma
  assert.equal(kitCost([withQty(perfil, "", "M"), withQty(parafuso, "10")]), 5)
})

test("recalcula na hora quando a quantidade ou a unidade mudam", () => {
  const components = kit().components
  const before = kitCost(components)
  components[0] = { ...components[0], quantity: "12" }
  assert.equal(kitCost(components), before + 63)
  components[0] = { ...components[0], unit: "CM" } // 12 cm
  assert.ok(kitCost(components) < before)
})

test("quantidade necessária com perda, na unidade do material", () => {
  assert.equal(requiredWithLoss(withQty(perfil, "2", "BARRA", "10")), 2 * 6 * 1.1)
})

test("validação: nome, composição, quantidade, perda, conversão e repetição", () => {
  assert.deepEqual(validateKit(kit()), {})
  assert.ok(validateKit(kit({ name: "ab" })).name)
  assert.ok(validateKit(kit({ components: [] })).components)
  assert.equal(validateKit(kit({ components: [] }), { requireComponents: false }).components, undefined)
  const a = withQty(perfil, "0", "M")
  assert.ok(validateKit(kit({ components: [a] }))[`c:${a.key}`])
  const b = withQty(perfil, "1", "KG") // KG não converte para M
  assert.match(validateKit(kit({ components: [b] }))[`c:${b.key}`] || "", /Não há conversão de KG para M/)
  const c = withQty(parafuso, "1", "UN", "100")
  assert.ok(validateKit(kit({ components: [c] }))[`c:${c.key}`])
  const d1 = withQty(perfil, "1", "M"); const d2 = withQty(perfil, "2", "M")
  assert.match(validateKit(kit({ components: [d1, d2] }))[`c:${d2.key}`] || "", /já está na composição/)
  assert.ok(validateKit(kit({ autoSku: false, sku: "COM ESPAÇO" })).sku)
})

test("payload: IDs reais, unidade em maiúsculas, perda numérica e SKU automático vazio", () => {
  const body = kitPayload(kit(), { activate: true })
  assert.equal(body.auto_sku, true)
  assert.equal(body.sku, "")
  assert.equal(body.activate, true)
  assert.deepEqual(body.components?.map((c) => [c.component_id, c.quantity, c.unit, c.loss_percent]), [["m1", 6, "M", 5], ["m2", 16, "UN", 0]])
  assert.equal("components" in kitPayload(kit(), { withComponents: false }), false) // só o cadastro
  assert.equal(kitPayload(kit(), { kitId: "k1", versionId: "v1" }).version_id, "v1")
})

test("do detalhe do banco para o formulário, preservando unidade e perda", () => {
  const form = formFromKitDetail({
    kit: { name: "Kit Chassi", internal_code: "KIT-000007", category: "Chassi", status: "Ativo" },
    components: [{ component_id: "m1", sku: "MP-1", name: "Perfil U", material_unit: "M", unit: "CM", quantity: 150, quantity_in_material_unit: 1.5, loss_percent: 5, unit_cost: 10, available: 30 }],
  })
  assert.equal(form.sku, "KIT-000007")
  assert.equal(form.autoSku, false)
  assert.deepEqual([form.components[0].unit, form.components[0].lossPercent, form.components[0].quantity], ["CM", "5", "150"])
  assert.equal(lineCost(form.components[0]), 1.5 * 1.05 * 10)
})
